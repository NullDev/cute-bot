import path from "node:path";
import { EmbedBuilder } from "discord.js";
import { QuickDB } from "quick.db";
import defaults from "../util/defaults.js";
import { config } from "../../config/config.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

/**
 * @typedef {Object} Giveaway
 * @property {string} guildId
 * @property {string} channelId
 * @property {string} hostId
 * @property {string} hostName
 * @property {string} description
 * @property {string | null} image - attachment filename on the giveaway message
 * @property {string | null} requiredRoleId
 * @property {number} endsAt - unix ms
 * @property {string[]} participants
 * @property {boolean} ended
 * @property {string | null} [winnerId]
 */

export const TIMEZONE = "Europe/Vienna";
export const DRAW_HOUR = 13;
export const DRAW_MINUTE = 37;

export const giveawayDb = /** @type {QuickDB<Giveaway>} */ (new QuickDB({
    filePath: path.resolve("./data/guild_data.sqlite"),
    table: "giveaways",
}));

const guildDb = new QuickDB({
    filePath: path.resolve("./data/guild_data.sqlite"),
});

/**
 * Get the wall clock parts of a date in TIMEZONE
 *
 * @param {Date} date
 * @return {{ year: number, month: number, day: number, hour: number, minute: number, second: number }}
 */
const getZonedParts = function(date){
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
        timeZone: TIMEZONE,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    }).formatToParts(date).map(p => [p.type, p.value]));

    return {
        year: Number(parts.year),
        month: Number(parts.month),
        day: Number(parts.day),
        hour: Number(parts.hour),
        minute: Number(parts.minute),
        second: Number(parts.second),
    };
};

/**
 * Offset of TIMEZONE from UTC at the given instant, in ms
 *
 * @param {number} ts
 * @return {number}
 */
const getZoneOffset = function(ts){
    const p = getZonedParts(new Date(ts));
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - (ts - (ts % 1000));
};

/**
 * Get the draw time: DRAW_HOUR:DRAW_MINUTE (TIMEZONE) on the Nth day from now
 *
 * @param {number} days
 * @param {Date} [now=new Date()]
 * @return {number} unix ms
 */
export const computeDrawTime = function(days, now = new Date()){
    const { year, month, day } = getZonedParts(now);
    const wallClock = Date.UTC(year, month - 1, day + days, DRAW_HOUR, DRAW_MINUTE);
    // second pass corrects the offset when a DST switch lies between now and the draw
    const guess = wallClock - getZoneOffset(wallClock);
    return wallClock - getZoneOffset(guess);
};

/** @type {Map<string, Promise<any>>} */
const locks = new Map();

/**
 * Run fn exclusively per key, so concurrent joins / draws don't overwrite each other
 *
 * @template T
 * @param {string} key
 * @param {() => Promise<T>} fn
 * @return {Promise<T>}
 */
export const withLock = function(key, fn){
    const run = (locks.get(key) ?? Promise.resolve()).catch(() => null).then(fn);
    locks.set(key, run);
    run.finally(() => {
        if (locks.get(key) === run) locks.delete(key);
    }).catch(() => null);
    return run;
};

/**
 * Get the linked krunker username of a user
 *
 * @param {string} guildId
 * @param {string} userId
 * @return {Promise<string | null>}
 */
export const getIgn = async function(guildId, userId){
    return (await guildDb.get(`guild-${guildId}.user-${userId}.username`).catch(() => null)) || null;
};

/**
 * Check if a member has the verified role AND a linked krunker username
 *
 * @param {import("discord.js").GuildMember} member
 * @return {Promise<boolean>}
 */
export const isVerified = async function(member){
    if (!member.roles.cache.has(config.ids.verified_role)) return false;
    return !!(await getIgn(member.guild.id, member.id));
};

/**
 * Check if a member has the role required by the giveaway (if any)
 *
 * @param {import("discord.js").GuildMember} member
 * @param {Giveaway} gw
 * @return {boolean}
 */
export const hasRequiredRole = function(member, gw){
    return !gw.requiredRoleId || member.roles.cache.has(gw.requiredRoleId);
};

/**
 * Build the giveaway embed from its current state
 *
 * @param {Giveaway} gw
 * @return {EmbedBuilder}
 */
export const buildGiveawayEmbed = function(gw){
    const drawTs = Math.floor(gw.endsAt / 1000);

    const status = gw.ended
        ? `🏆┃Winner: ${gw.winnerId ? `<@${gw.winnerId}>` : "nobody :("}\n⏰┃Drawn: <t:${drawTs}:F>`
        : `⏰┃Draw: <t:${drawTs}:F>\n⏰┃Ends: <t:${drawTs}:R>`;

    const requirement = gw.requiredRoleId ? `\n🔒┃Required role: <@&${gw.requiredRoleId}>` : "";

    const embed = new EmbedBuilder()
        .setColor(defaults.embed_color)
        .setTitle("🎁┃Giveaway")
        .setDescription(`### Giveaway time, cuties!\n${gw.description}\n\n${status}${requirement}\n👥┃Participants: **${gw.participants.length}**`)
        .setFooter({
            text: `Hosted by ${gw.hostName}`,
            iconURL: "attachment://icon.png",
        });

    if (gw.image) embed.setImage(`attachment://${gw.image}`);

    return embed;
};

/**
 * Build the join + participants button row
 *
 * @param {boolean} ended
 * @return {any[]}
 */
export const buildGiveawayComponents = function(ended){
    return [
        {
            type: 1,
            components: [
                {
                    type: 2,
                    style: ended ? 2 : 3,
                    label: ended ? "Giveaway Ended" : "Join Giveaway",
                    custom_id: "giveaway_join",
                    disabled: ended,
                },
                {
                    type: 2,
                    style: 2,
                    label: "Participants",
                    custom_id: "giveaway_participants",
                },
            ],
        },
    ];
};
