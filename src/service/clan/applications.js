import Log from "../../util/log.js";
import { linkPlayer, getLinkByPlayer, getLinkByDiscord, unlinkDiscord } from "./identity.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

const DAY_MS = 86400000;

/**
 * @typedef {Object} Application
 * @property {number} id
 * @property {string} guildId
 * @property {string} discordId
 * @property {number} playerId
 * @property {string} playerName
 * @property {Record<string, string>} answers
 * @property {string} status
 * @property {string | null} channelId
 * @property {string | null} messageId
 * @property {string | null} reviewerId
 * @property {string | null} reason
 * @property {number} createdAt
 * @property {number | null} decidedAt
 * @property {number | null} joinedAt
 * @property {number | null} remindedAt
 * @property {string | null} interviewChannelId follow-up channel opened by a reviewer, null when none
 */

/**
 * @param {any} row
 * @return {Application | null}
 */
const toApp = row => (row ? {
    id: row.id,
    guildId: row.guild_id,
    discordId: row.discord_id,
    playerId: row.player_id,
    playerName: row.player_name,
    answers: JSON.parse(row.answers),
    status: row.status,
    channelId: row.channel_id,
    messageId: row.message_id,
    reviewerId: row.reviewer_id,
    reason: row.reason,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
    joinedAt: row.joined_at,
    remindedAt: row.reminded_at,
    interviewChannelId: row.interview_channel_id ?? null,
} : null);

/**
 * Check whether a user may apply right now
 *
 * @param {import("better-sqlite3").Database} db
 * @param {{ guildId: string, discordId: string, playerId: number, now?: number, cooldownDays: number }} input
 * @return {{ ok: true } | { ok: false, reason: "pending" | "cooldown" | "player_taken", until?: number, discordId?: string }}
 */
export const canApply = function(db, { guildId, discordId, playerId, now = Date.now(), cooldownDays }){
    const pending = db.prepare("select 1 from applications where guild_id = ? and discord_id = ? and status = 'pending' limit 1").get(guildId, discordId);
    if (pending) return { ok: false, reason: "pending" };

    const lastRejected = db.prepare("select decided_at from applications where guild_id = ? and discord_id = ? and status = 'rejected' order by decided_at desc limit 1").get(guildId, discordId);
    if (lastRejected){
        const until = lastRejected.decided_at + cooldownDays * DAY_MS;
        if (now < until) return { ok: false, reason: "cooldown", until };
    }

    const taken = getLinkByPlayer(db, guildId, playerId);
    if (taken && taken.discordId !== discordId) return { ok: false, reason: "player_taken", discordId: taken.discordId };

    return { ok: true };
};

/**
 * @param {import("better-sqlite3").Database} db
 * @param {{ guildId: string, discordId: string, playerId: number, playerName: string, answers: Record<string, string>, now?: number }} input
 * @return {number} the new application id
 */
export const createApplication = function(db, { guildId, discordId, playerId, playerName, answers, now = Date.now() }){
    const res = db.prepare("insert into applications (guild_id, discord_id, player_id, player_name, answers, status, created_at) values (?, ?, ?, ?, ?, 'pending', ?)")
        .run(guildId, discordId, playerId, playerName, JSON.stringify(answers), now);
    return Number(res.lastInsertRowid);
};

/**
 * @param {import("better-sqlite3").Database} db
 * @param {number} id
 * @param {string} channelId
 * @param {string} messageId
 */
export const setApplicationMessage = function(db, id, channelId, messageId){
    db.prepare("update applications set channel_id = ?, message_id = ? where id = ?").run(channelId, messageId, id);
};

/**
 * Remember (or forget, with null) the follow-up channel of an application
 *
 * @param {import("better-sqlite3").Database} db
 * @param {number} id
 * @param {string | null} channelId
 */
export const setInterviewChannel = function(db, id, channelId){
    db.prepare("update applications set interview_channel_id = ? where id = ?").run(channelId, id);
};

/**
 * @param {import("better-sqlite3").Database} db
 * @param {number} id
 * @return {Application | null}
 */
export const getApplication = function(db, id){
    return toApp(db.prepare("select * from applications where id = ?").get(id));
};

/**
 * Record a decision, then run the side effects (each one caught)
 *
 * @param {import("better-sqlite3").Database} db
 * @param {{ id: number, status: "accepted" | "rejected", reviewerId: string, reason: string | null, now?: number, effects: { grantRoles?: (app: Application) => Promise<any>, dm?: (app: Application) => Promise<any>, editEmbed?: (app: Application, result: { rolesOk: boolean, dmOk: boolean, rolesError: string | null }) => Promise<any> } }} input
 * @return {Promise<{ app: Application, rolesOk: boolean, dmOk: boolean, rolesError: string | null }>}
 */
export const finalizeDecision = async function(db, { id, status, reviewerId, reason, now = Date.now(), effects }){
    const current = getApplication(db, id);
    if (!current) throw new Error(`Application ${id} not found`);
    if (current.status !== "pending") throw new Error(`Application ${id} was already decided (${current.status})`);

    db.prepare("update applications set status = ?, reviewer_id = ?, reason = ?, decided_at = ? where id = ?").run(status, reviewerId, reason, now, id);
    const app = /** @type {Application} */ (getApplication(db, id));

    let rolesOk = true;
    let rolesError = null;
    if (status === "accepted"){
        const link = linkPlayer(db, { guildId: app.guildId, discordId: app.discordId, playerId: app.playerId, playerName: app.playerName, source: "application", now });
        if (!link.ok){
            rolesOk = false;
            rolesError = `IGN is linked to <@${link.discordId}>`;
        }
        else if (effects.grantRoles){
            await effects.grantRoles(app).catch(e => {
                rolesOk = false;
                rolesError = String(e?.message ?? e);
            });
        }
    }

    let dmOk = true;
    if (effects.dm){
        await effects.dm(app).catch(e => {
            dmOk = false;
            Log.warn(`[CLAN] DM for application ${id} failed: ${e?.message ?? e}`);
        });
    }

    const result = { rolesOk, dmOk, rolesError };
    if (effects.editEmbed) await effects.editEmbed(app, result).catch(e => Log.warn(`[CLAN] Embed edit for application ${id} failed: ${e?.message ?? e}`));

    return { app, ...result };
};

/**
 * Undo a decision: back to pending, then the side effects (each one caught).
 * An accept also drops the IGN link, but only when it still is the one this application made.
 *
 * @param {import("better-sqlite3").Database} db
 * @param {{ id: number, effects: { revokeRoles?: (app: Application) => Promise<any>, dm?: (app: Application, previousStatus: "accepted" | "rejected") => Promise<any>, editEmbed?: (app: Application, result: { previousStatus: "accepted" | "rejected", rolesOk: boolean, dmOk: boolean, rolesError: string | null }) => Promise<any> } }} input
 * @return {Promise<{ app: Application, previousStatus: "accepted" | "rejected", rolesOk: boolean, dmOk: boolean, rolesError: string | null }>}
 */
export const reopenApplication = async function(db, { id, effects }){
    const current = getApplication(db, id);
    if (!current) throw new Error(`Application ${id} not found`);
    if (current.status !== "accepted" && current.status !== "rejected") throw new Error(`Application ${id} is ${current.status} and cannot be reopened`);
    const previousStatus = /** @type {"accepted" | "rejected"} */ (current.status);

    db.prepare("update applications set status = 'pending', reviewer_id = null, reason = null, decided_at = null, reminded_at = null where id = ?").run(id);
    const app = /** @type {Application} */ (getApplication(db, id));

    let rolesOk = true;
    let rolesError = null;
    if (previousStatus === "accepted"){
        const link = getLinkByDiscord(db, app.guildId, app.discordId);
        if (link && link.playerId === app.playerId && link.source === "application") unlinkDiscord(db, app.guildId, app.discordId);
        if (effects.revokeRoles){
            await effects.revokeRoles(app).catch(e => {
                rolesOk = false;
                rolesError = String(e?.message ?? e);
            });
        }
    }

    let dmOk = true;
    if (effects.dm){
        await effects.dm(app, previousStatus).catch(e => {
            dmOk = false;
            Log.warn(`[CLAN] Reopen DM for application ${id} failed: ${e?.message ?? e}`);
        });
    }

    const result = { previousStatus, rolesOk, dmOk, rolesError };
    if (effects.editEmbed) await effects.editEmbed(app, result).catch(e => Log.warn(`[CLAN] Embed edit for application ${id} failed: ${e?.message ?? e}`));

    return { app, ...result };
};

/**
 * @param {import("better-sqlite3").Database} db
 * @param {string} guildId
 * @param {string} status
 * @return {Application[]}
 */
export const listByStatus = function(db, guildId, status){
    return db.prepare("select * from applications where guild_id = ? and status = ?").all(guildId, status).map(r => /** @type {Application} */ (toApp(r)));
};

/**
 * @param {import("better-sqlite3").Database} db
 * @param {number} id
 * @param {number} [now=Date.now()]
 */
export const markJoined = function(db, id, now = Date.now()){
    db.prepare("update applications set status = 'joined', joined_at = ? where id = ?").run(now, id);
};

/**
 * @param {import("better-sqlite3").Database} db
 * @param {number} id
 * @param {number} [now=Date.now()]
 */
export const markReminded = function(db, id, now = Date.now()){
    db.prepare("update applications set reminded_at = ? where id = ?").run(now, id);
};

/**
 * @param {import("better-sqlite3").Database} db
 * @param {number} id
 * @param {number} [now=Date.now()]
 */
export const markExpired = function(db, id, now = Date.now()){
    db.prepare("update applications set status = 'expired', reminded_at = coalesce(reminded_at, ?) where id = ?").run(now, id);
};

/**
 * Decide what to do with accepted applications
 *
 * @param {Array<{ id: number, playerId: number, decidedAt: number | null, remindedAt: number | null }>} apps
 * @param {Set<number>} rosterIds
 * @param {number} now
 * @param {{ reminderDays: number, expireDays: number }} options
 * @return {{ joined: any[], remind: any[], expire: any[] }}
 */
export const planPendingJoins = function(apps, rosterIds, now, { reminderDays, expireDays }){
    const joined = [];
    const remind = [];
    const expire = [];
    for (const app of apps){
        if (rosterIds.has(app.playerId)){
            joined.push(app);
            continue;
        }
        const age = now - (app.decidedAt ?? now);
        if (age >= expireDays * DAY_MS) expire.push(app);
        else if (age >= reminderDays * DAY_MS && !app.remindedAt) remind.push(app);
    }
    return { joined, remind, expire };
};
