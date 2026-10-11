import { config } from "../../../config/config.js";
import { levelFromScore, turfDay } from "./krunkerApi.js";
import { listLinks } from "./identity.js";
import { isMainGuild } from "./clans.js";
import { fetchRoster } from "./roster.js";
import { computeRefs, computeScoreMedians, scoreMember, DEFAULT_REVIEW } from "./review.js";
import { buildReviewRows } from "./reviewReport.js";
import { snapshotMissingMembers } from "./snapshot.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

/**
 * Sum the turf rows of the last 14 days (today included) and note which clans they were played for
 *
 * @param {Array<{ day: number, clan_name: string, kills: number, games: number }>} rows
 * @param {number} day today's turf day number
 * @return {{ kills: number, games: number, clans: Record<string, number> }}
 */
export const turf14FromContributions = function(rows, day){
    const out = { kills: 0, games: 0, clans: /** @type {Record<string, number>} */ ({}) };
    for (const r of rows ?? []){
        if (r.day < day - 13 || r.day > day) continue;
        out.kills += Number(r.kills) || 0;
        out.games += Number(r.games) || 0;
        out.clans[r.clan_name] = (out.clans[r.clan_name] ?? 0) + (Number(r.games) || 0);
    }
    return out;
};

/**
 * Review row for a player who is not on the roster: paper from the live profile, turf from the contributions, clan score unknown
 *
 * @param {any} profile
 * @param {{ kills: number, games: number }} turf14
 * @return {import("./review.js").ReviewRow}
 */
export const applicantRow = function(profile, turf14){
    const kills = Number(profile.player_kills) || 0;
    return {
        playerId: profile.player_id,
        playerName: profile.player_name,
        rank: 0,
        linked: true, // not a member: the Discord link penalty does not apply
        level: levelFromScore(profile.player_score),
        kdr: kills / Math.max(Number(profile.player_deaths) || 0, 1),
        kpg: kills / Math.max(Number(profile.player_games_played) || 0, 1),
        nukes: Number(profile.player_stats?.n) || 0,
        s7: null,
        turf14Kills: turf14.kills,
        turf14Games: turf14.games,
        score14Delta: null,
        rankedRank: Number(profile.ranked_rank) || 0,
    };
};

/**
 * Would-be verdict wording for someone who is not a member
 *
 * @param {"keep" | "watch" | "kick"} verdict
 * @return {{ label: string, borderline: boolean }}
 */
export const applicantVerdict = function(verdict){
    if (verdict === "keep") return { label: "ACCEPT", borderline: false };
    return { label: "DENY", borderline: verdict === "watch" };
};

/**
 * Review settings for a guild: the Discord link penalty only exists where the verify flow runs (the main server)
 *
 * @param {string} guildId
 * @return {typeof DEFAULT_REVIEW}
 */
export const reviewConfig = function(guildId){
    const cfg = { ...DEFAULT_REVIEW, ...(config.clan.review ?? {}) };
    if (!isMainGuild(guildId)) cfg.penalties = { ...cfg.penalties, unlinked: 0 };
    return cfg;
};

/**
 * Evaluate one player against the current clan: members from the daily snapshots, everyone else from live data
 *
 * @param {{ db: import("better-sqlite3").Database, api: import("./krunkerApi.js").KrunkerApi, guildId: string, clan: import("./clans.js").ClanEntry, profile: any }} input
 * @return {Promise<{ clan: import("./clans.js").ClanEntry, row: import("./review.js").ReviewRow, result: ReturnType<typeof scoreMember>, refs: ReturnType<typeof computeRefs> & ReturnType<typeof computeScoreMedians>, cfg: typeof DEFAULT_REVIEW, turf: any, turf14: ReturnType<typeof turf14FromContributions> | null, member: boolean }>}
 */
export const evaluatePlayer = async function({ db, api, guildId, clan, profile }){
    const roster = await fetchRoster(db, api, { clanName: clan.name });
    const day = turfDay();
    await snapshotMissingMembers(db, api, roster, { day }).catch(() => null);
    const rows = buildReviewRows(db, roster, listLinks(db, guildId), day);
    const cfg = reviewConfig(guildId);
    const baseRefs = computeRefs(rows);
    const refs = { ...baseRefs, ...computeScoreMedians(rows, baseRefs, cfg) };

    const memberRow = rows.find(r => r.playerId === profile.player_id);
    let turf14 = null;
    let row = memberRow;
    if (!row){
        const contributions = await api.getTurfContributions(profile.player_id).catch(() => []);
        turf14 = turf14FromContributions(contributions, day);
        row = applicantRow(profile, turf14);
    }
    const result = scoreMember(row, refs, cfg);
    const turf = await api.getTurfPlayer(profile.player_id).catch(() => null);
    return { clan, row, result, refs, cfg, turf, turf14, member: !!memberRow };
};
