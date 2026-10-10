// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

/**
 * @typedef {Object} Link
 * @property {string} guildId
 * @property {string} discordId
 * @property {number} playerId
 * @property {string} playerName
 * @property {number} linkedAt
 * @property {string} source
 */

/**
 * @param {any} row
 * @return {Link | null}
 */
const toLink = row => (row ? {
    guildId: row.guild_id,
    discordId: row.discord_id,
    playerId: row.player_id,
    playerName: row.player_name,
    linkedAt: row.linked_at,
    source: row.source,
} : null);

/**
 * Resolve an IGN to its player id and canonical spelling
 *
 * @param {import("./krunkerApi.js").KrunkerApi} api
 * @param {string} name
 * @return {Promise<{ playerId: number, playerName: string, playerClan: string | null } | null>}
 */
export const resolveIgn = async function(api, name){
    const trimmed = String(name ?? "").trim();
    if (!trimmed) return null;
    const profile = await api.getPlayer(trimmed);
    if (!profile?.player_id) return null;
    return { playerId: profile.player_id, playerName: profile.player_name, playerClan: profile.player_clan ?? null };
};

/**
 * Suggest similar names for an unknown IGN
 *
 * @param {import("./krunkerApi.js").KrunkerApi} api
 * @param {string} name
 * @return {Promise<string[]>}
 */
export const suggestIgns = async function(api, name){
    const results = await api.searchPlayers(String(name ?? "").trim(), 5).catch(() => []);
    return results.slice(0, 5).map(r => r.player_name);
};

/**
 * Remember the current name of a player id
 *
 * @param {import("better-sqlite3").Database} db
 * @param {number} playerId
 * @param {string} playerName
 * @param {number} [now=Date.now()]
 */
export const rememberName = function(db, playerId, playerName, now = Date.now()){
    db.prepare("insert into player_names (player_id, player_name, seen_at) values (?, ?, ?) on conflict (player_id) do update set player_name = excluded.player_name, seen_at = excluded.seen_at")
        .run(playerId, playerName, now);
};

/**
 * @param {import("better-sqlite3").Database} db
 * @param {string} guildId
 * @param {string} discordId
 * @return {Link | null}
 */
export const getLinkByDiscord = function(db, guildId, discordId){
    return toLink(db.prepare("select * from players where guild_id = ? and discord_id = ?").get(guildId, discordId));
};

/**
 * @param {import("better-sqlite3").Database} db
 * @param {string} guildId
 * @param {number} playerId
 * @return {Link | null}
 */
export const getLinkByPlayer = function(db, guildId, playerId){
    return toLink(db.prepare("select * from players where guild_id = ? and player_id = ?").get(guildId, playerId));
};

/**
 * Link a Discord user to a player id. Relinking the same Discord user replaces the old link.
 *
 * @param {import("better-sqlite3").Database} db
 * @param {{ guildId: string, discordId: string, playerId: number, playerName: string, source: string, now?: number }} link
 * @return {{ ok: true } | { ok: false, reason: "player_taken", discordId: string }}
 */
export const linkPlayer = function(db, { guildId, discordId, playerId, playerName, source, now = Date.now() }){
    const taken = getLinkByPlayer(db, guildId, playerId);
    if (taken && taken.discordId !== discordId) return { ok: false, reason: "player_taken", discordId: taken.discordId };
    db.prepare("insert into players (guild_id, discord_id, player_id, player_name, linked_at, source) values (?, ?, ?, ?, ?, ?) on conflict (guild_id, discord_id) do update set player_id = excluded.player_id, player_name = excluded.player_name, linked_at = excluded.linked_at, source = excluded.source")
        .run(guildId, discordId, playerId, playerName, now, source);
    rememberName(db, playerId, playerName, now);
    return { ok: true };
};

/**
 * Remove the link of a Discord user
 *
 * @param {import("better-sqlite3").Database} db
 * @param {string} guildId
 * @param {string} discordId
 * @return {boolean} true when a link was removed
 */
export const unlinkDiscord = function(db, guildId, discordId){
    return db.prepare("delete from players where guild_id = ? and discord_id = ?").run(guildId, discordId).changes > 0;
};

/**
 * All links of a guild keyed by discord id
 *
 * @param {import("better-sqlite3").Database} db
 * @param {string} guildId
 * @return {Map<string, Link>}
 */
export const listLinks = function(db, guildId){
    const rows = db.prepare("select * from players where guild_id = ?").all(guildId);
    return new Map(rows.map(r => [r.discord_id, /** @type {Link} */ (toLink(r))]));
};

/**
 * One-off migration of the quick.db usernames into the players table
 * An API error aborts the run and is rethrown with the entries processed so far attached as `error.partial`
 * (same shape as the return value); those links are kept
 *
 * @param {import("better-sqlite3").Database} db
 * @param {import("./krunkerApi.js").KrunkerApi} api
 * @param {string} guildId
 * @param {Array<{ discordId: string, username: string }>} entries
 * @return {Promise<{ linked: Array<{ discordId: string, username: string, playerId: number, playerName: string }>, unresolved: Array<{ discordId: string, username: string }>, conflicts: Array<{ discordId: string, username: string, playerName: string, takenBy: string }> }>}
 */
export const migrateQuickDb = async function(db, api, guildId, entries){
    const linked = [];
    const unresolved = [];
    const conflicts = [];
    for (const { discordId, username } of entries){
        if (getLinkByDiscord(db, guildId, discordId)) continue;
        let resolved;
        try {
            resolved = await resolveIgn(api, username);
        }
        catch (e){
            const error = e instanceof Error ? e : new Error(String(e));
            /** @type {any} */ (error).partial = { linked, unresolved, conflicts };
            throw error;
        }
        if (!resolved){
            unresolved.push({ discordId, username });
            continue;
        }
        const res = linkPlayer(db, { guildId, discordId, playerId: resolved.playerId, playerName: resolved.playerName, source: "migration" });
        if (res.ok) linked.push({ discordId, username, playerId: resolved.playerId, playerName: resolved.playerName });
        else conflicts.push({ discordId, username, playerName: resolved.playerName, takenBy: res.discordId });
    }
    return { linked, unresolved, conflicts };
};
