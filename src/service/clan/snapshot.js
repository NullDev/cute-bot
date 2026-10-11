import Log from "../../util/log.js";
import { listLinks, rememberName } from "./identity.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

/**
 * Build a snapshots row from a profile
 *
 * @param {any} profile
 * @param {{ rank: number, s7: number } | null} rosterMember
 * @param {number} day
 * @param {number} now
 * @return {Record<string, any>}
 */
export const buildSnapshotRow = function(profile, rosterMember, day, now){
    return {
        player_id: profile.player_id,
        day,
        taken_at: now,
        player_name: profile.player_name,
        in_clan: rosterMember ? 1 : 0,
        clan_role: rosterMember ? rosterMember.rank : null,
        s7: rosterMember ? rosterMember.s7 : null,
        score: Number(profile.player_score) || 0,
        kills: Number(profile.player_kills) || 0,
        deaths: Number(profile.player_deaths) || 0,
        wins: Number(profile.player_wins) || 0,
        games: Number(profile.player_games_played) || 0,
        timeplayed: Number(profile.player_timeplayed) || 0,
        nukes: Number(profile.player_stats?.n) || 0,
        ranked_rank: Number(profile.ranked_rank) || 0,
        online: profile.online ? 1 : 0,
        created_at_game: profile.player_datenew ?? null,
    };
};

const SNAPSHOT_COLUMNS = ["player_id", "day", "taken_at", "player_name", "in_clan", "clan_role", "s7", "score", "kills", "deaths", "wins", "games", "timeplayed", "nukes", "ranked_rank", "online", "created_at_game"];

/**
 * Insert or replace a snapshot row
 *
 * @param {import("better-sqlite3").Database} db
 * @param {Record<string, any>} row
 */
export const upsertSnapshot = function(db, row){
    const cols = SNAPSHOT_COLUMNS.join(", ");
    const marks = SNAPSHOT_COLUMNS.map(() => "?").join(", ");
    const updates = SNAPSHOT_COLUMNS.filter(c => c !== "player_id" && c !== "day").map(c => `${c} = excluded.${c}`).join(", ");
    db.prepare(`insert into snapshots (${cols}) values (${marks}) on conflict (player_id, day) do update set ${updates}`)
        .run(...SNAPSHOT_COLUMNS.map(c => row[c] ?? null));
};

/**
 * Insert or replace a turf day row
 *
 * @param {import("better-sqlite3").Database} db
 * @param {{ playerId: number, day: number, kills: number, deaths: number, games: number }} row
 */
export const upsertTurfDay = function(db, { playerId, day, kills, deaths, games }){
    db.prepare("insert into turf_days (player_id, day, kills, deaths, games) values (?, ?, ?, ?, ?) on conflict (player_id, day) do update set kills = excluded.kills, deaths = excluded.deaths, games = excluded.games")
        .run(playerId, day, kills, deaths, games);
};

/**
 * Snapshot every roster member and every linked player
 *
 * @param {import("better-sqlite3").Database} db
 * @param {import("./krunkerApi.js").KrunkerApi} api
 * @param {{ members: Array<{ playerId: number, playerName: string, rank: number, s7: number }> }} roster
 * @param {{ guildId: string, day: number, now?: number }} options
 * @return {Promise<{ ok: number, failed: string[] }>}
 */
export const runSnapshot = async function(db, api, roster, { guildId, day, now = Date.now() }){
    /** @type {Map<number, { playerName: string, member: { rank: number, s7: number } | null }>} */
    const targets = new Map();
    for (const m of roster.members) targets.set(m.playerId, { playerName: m.playerName, member: { rank: m.rank, s7: m.s7 } });
    for (const link of listLinks(db, guildId).values()){
        if (!targets.has(link.playerId)) targets.set(link.playerId, { playerName: link.playerName, member: null });
    }

    let ok = 0;
    const failed = [];
    for (const [, { playerName, member }] of targets){
        try {
            const profile = await api.getPlayer(playerName);
            if (!profile?.player_id) throw new Error("not found");
            upsertSnapshot(db, buildSnapshotRow(profile, member, day, now));
            rememberName(db, profile.player_id, profile.player_name, now);
            ok++;
        }
        catch (e){
            failed.push(playerName);
            Log.warn(`[CLAN] Snapshot of ${playerName} failed: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
    return { ok, failed };
};

/**
 * Fetch and store turf rows for a day range (inclusive)
 *
 * @param {import("better-sqlite3").Database} db
 * @param {import("./krunkerApi.js").KrunkerApi} api
 * @param {number} clanId
 * @param {number} fromDay
 * @param {number} toDay
 * @return {Promise<number>} rows written
 */
export const backfillTurf = async function(db, api, clanId, fromDay, toDay){
    let n = 0;
    for (let day = fromDay; day <= toDay; day++){
        const rows = await api.getTurfPlayers(clanId, day).catch(e => {
            Log.warn(`[CLAN] Turf day ${day} failed: ${e instanceof Error ? e.message : String(e)}`);
            return [];
        });
        for (const r of rows){
            upsertTurfDay(db, { playerId: r.player_id, day, kills: r.kills, deaths: r.deaths, games: r.games });
            rememberName(db, r.player_id, r.player_name);
            n++;
        }
    }
    return n;
};

/**
 * @param {import("better-sqlite3").Database} db
 * @param {number} day
 * @return {boolean}
 */
export const hasSnapshotForDay = function(db, day){
    return !!db.prepare("select 1 from snapshots where day = ? limit 1").get(day);
};

/**
 * @param {import("better-sqlite3").Database} db
 * @return {number | null}
 */
export const latestSnapshotDay = function(db){
    return db.prepare("select max(day) as d from snapshots").get()?.d ?? null;
};

/**
 * First turf day a player was snapshotted as a clan member, or null
 *
 * @param {import("better-sqlite3").Database} db
 * @param {number} playerId
 * @return {number | null}
 */
export const firstSeenInClanDay = function(db, playerId){
    return db.prepare("select min(day) as d from snapshots where player_id = ? and in_clan = 1").get(playerId)?.d ?? null;
};

/**
 * Earliest day with any snapshot, or null
 *
 * @param {import("better-sqlite3").Database} db
 * @return {number | null}
 */
export const earliestSnapshotDay = function(db){
    return db.prepare("select min(day) as d from snapshots").get()?.d ?? null;
};

