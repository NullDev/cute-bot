import Log from "../../util/log.js";
import { config } from "../../../config/config.js";
import { rosterByPlayerId } from "./roster.js";
import { listByStatus, planPendingJoins, markJoined, markReminded, markExpired } from "./applications.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

/**
 * Follow up on accepted applications
 *
 * @param {import("../client.js").default} client
 * @param {import("better-sqlite3").Database} db
 * @param {import("./roster.js").Roster} roster
 * @param {string} guildId
 * @param {{ now?: number }} [options]
 * @return {Promise<{ joined: number, reminded: number, expired: number }>}
 */
export const checkPendingJoins = async function(client, db, roster, guildId, { now = Date.now() } = {}){
    const accepted = listByStatus(db, guildId, "accepted");
    const plan = planPendingJoins(accepted, new Set(rosterByPlayerId(roster).keys()), now, {
        reminderDays: config.clan.join_reminder_days,
        expireDays: config.clan.join_expire_days,
    });

    const guild = await client.guilds.fetch(guildId).catch(() => null);
    const channel = guild ? await guild.channels.fetch(config.ids.clan.applications_channel).catch(() => null) : null;
    const notify = async(/** @type {string} */ text) => { if (channel?.isSendable()) await channel.send(text).catch(() => null); };
    const dm = async(/** @type {string} */ discordId, /** @type {string} */ text) => {
        const user = await client.users.fetch(discordId).catch(() => null);
        await user?.send(text).catch(() => null);
    };

    for (const app of plan.joined){
        markJoined(db, app.id, now);
        await dm(app.discordId, "🎉 You are in **[cute]** now. Welcome!");
        await notify(`✅ <@${app.discordId}> (\`${app.playerName}\`) joined the clan in game (application #${app.id}).`);
    }
    for (const app of plan.remind){
        markReminded(db, app.id, now);
        await dm(app.discordId, "Reminder: your **[cute]** application was accepted, but you have not joined in game yet. Profile → clan → search `cute` → request to join.");
    }
    for (const app of plan.expire){
        markExpired(db, app.id, now);
        await notify(`⌛ <@${app.discordId}> (\`${app.playerName}\`) never joined in game within ${config.clan.join_expire_days} days (application #${app.id}). Their recruit role will be removed by the next sync.`);
    }

    Log.done(`[CLAN] Pending joins: ${plan.joined.length} joined, ${plan.remind.length} reminded, ${plan.expire.length} expired`);
    return { joined: plan.joined.length, reminded: plan.remind.length, expired: plan.expire.length };
};
