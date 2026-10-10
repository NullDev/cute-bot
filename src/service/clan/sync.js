import { EmbedBuilder } from "discord.js";
import Log from "../../util/log.js";
import defaults from "../../util/defaults.js";
import { config } from "../../../config/config.js";
import { api } from "./krunkerApi.js";
import { getClanDb } from "./db.js";
import { listLinks, getLinkByDiscord } from "./identity.js";
import { fetchRoster, rosterByPlayerId, RANK } from "./roster.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

/**
 * Discord roles a rank must hold (cumulative)
 *
 * @param {number} rank
 * @param {{ recruit: string, soldier: string, captain: string }} roleIds
 * @return {string[]}
 */
export const rolesForRank = function(rank, roleIds){
    const roles = [roleIds.recruit];
    if (rank >= RANK.SOLDIER) roles.push(roleIds.soldier);
    if (rank >= RANK.CAPTAIN) roles.push(roleIds.captain);
    return roles;
};

/**
 * Pure role diff between Discord and the roster
 *
 * @param {{ members: Array<{ discordId: string, roleIds: string[] }>, links: Map<string, { playerId: number }>, roster: Map<number, { rank: number }>, exempt: Set<string>, roleIds: { recruit: string, soldier: string, captain: string } }} input
 * @return {{ add: Array<{ discordId: string, roleIds: string[] }>, remove: Array<{ discordId: string, roleIds: string[] }>, unlinkedWithRoles: string[] }}
 */
export const computeDiff = function({ members, links, roster, exempt, roleIds }){
    if (roster.size === 0) throw new Error("Refusing to sync against an empty roster");
    const clanRoles = [roleIds.recruit, roleIds.soldier, roleIds.captain];
    const add = [];
    const remove = [];
    const unlinkedWithRoles = [];

    for (const member of members){
        const have = member.roleIds.filter(r => clanRoles.includes(r));
        const link = links.get(member.discordId);
        const entry = link ? roster.get(link.playerId) : undefined;

        let want = [];
        if (entry) want = rolesForRank(entry.rank, roleIds);
        else if (exempt.has(member.discordId)) want = [roleIds.recruit];

        if (!link && have.length) unlinkedWithRoles.push(member.discordId);

        const toAdd = want.filter(r => !have.includes(r));
        const toRemove = have.filter(r => !want.includes(r));
        if (toAdd.length) add.push({ discordId: member.discordId, roleIds: toAdd });
        if (toRemove.length) remove.push({ discordId: member.discordId, roleIds: toRemove });
    }
    return { add, remove, unlinkedWithRoles };
};

/**
 * Apply a diff to a guild, collecting failures
 *
 * @param {import("discord.js").Guild} guild
 * @param {ReturnType<typeof computeDiff>} diff
 * @return {Promise<{ added: number, removed: number, failed: Array<{ discordId: string, error: string }> }>}
 */
export const applyDiff = async function(guild, diff){
    const failed = [];
    let added = 0;
    let removed = 0;
    for (const { discordId, roleIds } of diff.add){
        const member = await guild.members.fetch(discordId).catch(() => null);
        if (!member) continue;
        const ok = await member.roles.add(roleIds, "clan sync").then(() => true).catch(e => {
            failed.push({ discordId, error: String(e?.message ?? e) });
            return false;
        });
        if (ok) added++;
    }
    for (const { discordId, roleIds } of diff.remove){
        const member = await guild.members.fetch(discordId).catch(() => null);
        if (!member) continue;
        const ok = await member.roles.remove(roleIds, "clan sync").then(() => true).catch(e => {
            failed.push({ discordId, error: String(e?.message ?? e) });
            return false;
        });
        if (ok) removed++;
    }
    return { added, removed, failed };
};

/**
 * Summary embed for the log channel
 *
 * @param {{ diff: ReturnType<typeof computeDiff>, result: Awaited<ReturnType<typeof applyDiff>> | null, dryRun: boolean, roster: import("./roster.js").Roster }} input
 * @return {EmbedBuilder}
 */
export const buildSyncEmbed = function({ diff, result, dryRun, roster }){
    const fmt = (/** @type {Array<{ discordId: string, roleIds: string[] }>} */ list) => (list.length
        ? list.slice(0, 25).map(x => `<@${x.discordId}> ${x.roleIds.map(r => `<@&${r}>`).join(" ")}`).join("\n") + (list.length > 25 ? `\n... and ${list.length - 25} more` : "")
        : "none");
    const embed = new EmbedBuilder()
        .setTitle(`🛡️┃Clan Sync${dryRun ? " (dry run)" : ""}`)
        .setColor(defaults.embed_color)
        .setTimestamp()
        .setDescription(`Roster: ${roster.members.length} members, ${roster.unresolved.length} unresolved names.`)
        .addFields(
            { name: `Add (${diff.add.length})`, value: fmt(diff.add) },
            { name: `Remove (${diff.remove.length})`, value: fmt(diff.remove) },
        );
    if (diff.unlinkedWithRoles.length){
        embed.addFields({ name: `Had clan roles without a link (${diff.unlinkedWithRoles.length})`, value: diff.unlinkedWithRoles.slice(0, 40).map(id => `<@${id}>`).join(" ") });
    }
    if (roster.unresolved.length){
        embed.addFields({ name: "Unresolved roster names", value: roster.unresolved.map(n => `\`${n}\``).join(", ").slice(0, 1000) });
    }
    if (result){
        embed.addFields({ name: "Result", value: `added ${result.added}, removed ${result.removed}, failed ${result.failed.length}` + (result.failed.length ? "\n" + result.failed.slice(0, 10).map(f => `<@${f.discordId}>: ${f.error}`).join("\n") : "") });
    }
    return embed;
};

/**
 * Discord ids of accepted applicants who have not joined in game yet
 *
 * @param {import("better-sqlite3").Database} db
 * @param {string} guildId
 * @return {Set<string>}
 */
const exemptApplicants = function(db, guildId){
    const rows = db.prepare("select discord_id from applications where guild_id = ? and status = 'accepted'").all(guildId);
    return new Set(rows.map(r => r.discord_id));
};

/**
 * Run a full sync for a guild
 *
 * @param {import("../client.js").default} client
 * @param {string} guildId
 * @param {{ dryRun?: boolean, db?: import("better-sqlite3").Database, krunker?: import("./krunkerApi.js").KrunkerApi }} [options]
 * @return {Promise<{ diff: ReturnType<typeof computeDiff>, result: Awaited<ReturnType<typeof applyDiff>> | null, embed: EmbedBuilder }>}
 */
export const runClanSync = async function(client, guildId, { dryRun = false, db = getClanDb(), krunker = api } = {}){
    const guild = await client.guilds.fetch(guildId);
    const roster = await fetchRoster(db, krunker, { clanName: config.clan.name });
    const guildMembers = await guild.members.fetch();
    const members = guildMembers.filter(m => !m.user.bot).map(m => ({ discordId: m.id, roleIds: [...m.roles.cache.keys()] }));

    const diff = computeDiff({
        members,
        links: listLinks(db, guildId),
        roster: rosterByPlayerId(roster),
        exempt: exemptApplicants(db, guildId),
        roleIds: config.ids.clan,
    });

    const result = dryRun ? null : await applyDiff(guild, diff);
    const embed = buildSyncEmbed({ diff, result, dryRun, roster });

    Log.done(`[CLAN] Sync ${dryRun ? "dry run" : "applied"}: +${diff.add.length} -${diff.remove.length}`);

    const logChannel = config.ids.log_channel ? await guild.channels.fetch(config.ids.log_channel).catch(() => null) : null;
    if (logChannel?.isSendable()) await logChannel.send({ embeds: [embed] }).catch(() => null);

    return { diff, result, embed };
};

/**
 * Apply the roster rank roles to one member right now
 *
 * @param {import("discord.js").GuildMember} member
 * @param {{ db?: import("better-sqlite3").Database, krunker?: import("./krunkerApi.js").KrunkerApi }} [options]
 * @return {Promise<number | null>} the rank applied, or null when not on the roster
 */
export const syncOneMember = async function(member, { db = getClanDb(), krunker = api } = {}){
    const link = getLinkByDiscord(db, member.guild.id, member.id);
    if (!link) return null;
    const roster = await fetchRoster(db, krunker, { clanName: config.clan.name }).catch(() => null);
    const entry = roster ? rosterByPlayerId(roster).get(link.playerId) : null;
    if (!entry) return null;
    await member.roles.add(rolesForRank(entry.rank, config.ids.clan), "clan sync").catch(e => Log.error("[CLAN] syncOneMember failed: ", e));
    return entry.rank;
};
