import { EmbedBuilder } from "discord.js";
import defaults from "../../util/defaults.js";
import { levelFromScore } from "./krunkerApi.js";
import { earliestSnapshotDay } from "./snapshot.js";
import { capField } from "./sync.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

/**
 * Build the review input rows from the database
 *
 * @param {import("better-sqlite3").Database} db
 * @param {{ members: Array<{ playerId: number, playerName: string, rank: number, s7: number }> }} roster
 * @param {Map<string, { playerId: number }>} links
 * @param {number} day
 * @return {Array<import("./review.js").ReviewRow & { hours: number, since: string }>}
 */
export const buildReviewRows = function(db, roster, links, day){
    const linkedIds = new Set([...links.values()].map(l => l.playerId));
    const latest = db.prepare("select * from snapshots where player_id = ? and day <= ? order by day desc limit 1");
    const old = db.prepare("select score from snapshots where player_id = ? and day = ?");
    const turf = db.prepare("select coalesce(sum(kills), 0) as kills, coalesce(sum(games), 0) as games from turf_days where player_id = ? and day between ? and ?");
    const firstSeen = db.prepare("select min(day) as d from snapshots where player_id = ? and in_clan = 1");
    const historyStart = earliestSnapshotDay(db);

    return roster.members.map(m => {
        const s = latest.get(m.playerId, day) ?? {};
        const before = old.get(m.playerId, day - 14);
        const t = turf.get(m.playerId, day - 13, day);
        // members already present on the first snapshot day have an unknown join date
        const seen = firstSeen.get(m.playerId)?.d ?? null;
        const memberDays = seen !== null && historyStart !== null && seen > historyStart ? day - seen : null;
        const kills = s.kills ?? 0;
        const deaths = s.deaths ?? 0;
        const games = s.games ?? 0;
        return {
            playerId: m.playerId,
            playerName: m.playerName,
            rank: m.rank,
            linked: linkedIds.has(m.playerId),
            level: levelFromScore(s.score ?? 0),
            kdr: kills / Math.max(deaths, 1),
            kpg: kills / Math.max(games, 1),
            nukes: s.nukes ?? 0,
            s7: m.s7,
            turf14Kills: t.kills,
            turf14Games: t.games,
            score14Delta: before && s.score !== undefined ? s.score - before.score : null,
            rankedRank: s.ranked_rank ?? 0,
            hasSnapshot: s.player_id !== undefined,
            memberDays,
            hours: Math.round((s.timeplayed ?? 0) / 3600000),
            since: String(s.created_at_game ?? "").slice(0, 10),
        };
    });
};

const RANK_NAMES = ["recruit", "soldier", "captain", "cmdr"];

/**
 * Fixed-width table for the attachment
 *
 * @param {Array<any>} rows
 * @return {string}
 */
export const formatReviewTable = function(rows){
    const cols = [
        ["name", 18, (/** @type {any} */ r) => r.playerName],
        ["role", 8, r => RANK_NAMES[r.rank] ?? String(r.rank)],
        ["dc", 3, r => (r.linked ? "y" : "-")],
        ["lvl", 4, r => (r.hasSnapshot === false ? "-" : r.level)],
        ["kdr", 6, r => (r.hasSnapshot === false ? "-" : r.kdr.toFixed(2))],
        ["kpg", 6, r => (r.hasSnapshot === false ? "-" : r.kpg.toFixed(1))],
        ["nuke", 5, r => (r.hasSnapshot === false ? "-" : r.nukes)],
        ["s7", 8, r => r.s7],
        ["d14", 8, r => (r.score14Delta === null ? "-" : r.score14Delta)],
        ["t14k", 6, r => r.turf14Kills],
        ["t14g", 5, r => r.turf14Games],
        ["rr", 3, r => r.rankedRank],
        ["hrs", 5, r => (r.hasSnapshot === false ? "-" : r.hours)],
        ["since", 11, r => r.since],
        ["score", 6, r => r.review.total.toFixed(2)],
        ["verdict", 8, r => r.review.verdict],
        ["reasons", 0, r => r.review.reasons.join("; ")],
    ];
    const pad = (/** @type {any} */ v, /** @type {number} */ w) => (w ? String(v).padEnd(w).slice(0, w) : String(v));
    const header = cols.map(([name, w]) => pad(name, w)).join(" ");
    const lines = rows.map(r => cols.map(([, w, f]) => pad(f(r), w)).join(" "));
    return [header, ...lines].join("\n") + "\n";
};

/**
 * Summary embed
 *
 * @param {{ total: number, kick: number, watch: number, keep: number, protectedInactive: number }} summary
 * @param {Array<any>} rows
 * @param {number} targetSize
 * @return {EmbedBuilder}
 */
export const buildReviewEmbed = function(summary, rows, targetSize){
    const kicks = rows.filter(r => r.review.verdict === "kick");
    const protectedInactive = rows.filter(r => r.review.inactive && r.review.protected);
    const list = (/** @type {any[]} */ xs) => (xs.length ? xs.slice(0, 20).map(r => `\`${r.playerName}\` - ${r.review.reasons[0] ?? ""}`).join("\n") + (xs.length > 20 ? `\n... ${xs.length - 20} more in the file` : "") : "none");
    return new EmbedBuilder()
        .setTitle("📋┃Clan Review")
        .setColor(defaults.embed_color)
        .setTimestamp()
        .setDescription(`${summary.total} members, target ${targetSize}, ${Math.max(0, summary.total - targetSize)} over.\nKick ${summary.kick} · Watch ${summary.watch} · Keep ${summary.keep}`)
        .addFields(
            { name: `Kick (${kicks.length})`, value: capField(list(kicks)) },
            { name: `Inactive but protected (${protectedInactive.length})`, value: capField(list(protectedInactive)) },
        );
};
