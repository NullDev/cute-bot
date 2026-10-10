// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

export const DEFAULT_REVIEW = Object.freeze({
    weights: { level: 1.0, nukes: 1.5, kdr: 1.0, kpg: 0.5, rank: 0.5, s7: 1.5, turf: 1.0, delta: 1.0 },
    penalties: { unlinked: 0.3 },
    roleBonus: { 0: 0, 1: 0.3, 2: 0.6, 3: 0.6 },
    protect: { nukes: 50, level: 100, rank: 2 },
    thresholds: { kick: 1.0, watch: 2.0 },
});

/**
 * @typedef {Object} ReviewRow
 * @property {number} playerId
 * @property {string} playerName
 * @property {number} rank
 * @property {boolean} linked
 * @property {number} level
 * @property {number} kdr
 * @property {number} kpg
 * @property {number} nukes
 * @property {number} s7
 * @property {number} turf14Kills
 * @property {number} turf14Games
 * @property {number | null} score14Delta
 * @property {number} rankedRank
 */

/**
 * @param {number} v
 * @param {number} lo
 * @param {number} hi
 * @return {number}
 */
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * @param {number[]} values
 * @return {number}
 */
const median = function(values){
    if (!values.length) return 1;
    const s = [...values].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/**
 * @param {ReviewRow} row
 * @return {boolean}
 */
const isInactive = row => row.s7 === 0 && row.turf14Games === 0 && (row.score14Delta === null || row.score14Delta === 0);

/**
 * Reference values (medians of active members)
 *
 * @param {ReviewRow[]} rows
 * @return {{ refS7: number, refTurf: number, refDelta: number }}
 */
export const computeRefs = function(rows){
    const active = rows.filter(r => !isInactive(r));
    const nz = (/** @type {number[]} */ v) => v.filter(x => x > 0);
    return {
        refS7: median(nz(active.map(r => r.s7))) || 1,
        refTurf: median(nz(active.map(r => r.turf14Kills))) || 1,
        refDelta: median(nz(active.map(r => r.score14Delta ?? 0))) || 1,
    };
};

/**
 * Score one member
 *
 * @param {ReviewRow} row
 * @param {{ refS7: number, refTurf: number, refDelta: number }} refs
 * @param {typeof DEFAULT_REVIEW} cfg
 * @return {{ paper: number, activity: number, bonus: number, total: number, inactive: boolean, protected: boolean, verdict: "keep" | "watch" | "kick", reasons: string[] }}
 */
export const scoreMember = function(row, refs, cfg){
    const w = cfg.weights;
    const lvl = Math.min(row.level, 150);

    const terms = [
        { name: "level", value: w.level * lvl / 150, text: `level ${row.level}` },
        { name: "nukes", value: w.nukes * Math.log10(1 + row.nukes) / 3, text: `${row.nukes} nukes` },
        { name: "kdr", value: w.kdr * clamp(row.kdr - 1, -1, 3) * (1 - lvl / 200), text: `KDR ${row.kdr.toFixed(2)} at level ${row.level}` },
        { name: "kpg", value: w.kpg * clamp(row.kpg / 10, 0, 2), text: `${row.kpg.toFixed(1)} kills per game` },
        { name: "rank", value: w.rank * (row.rankedRank > 0 ? row.rankedRank / 10 : 0), text: row.rankedRank > 0 ? `ranked rank ${row.rankedRank}` : "not ranked" },
        { name: "s7", value: w.s7 * Math.min(row.s7 / refs.refS7, 2), text: `7 day score ${row.s7}` },
        { name: "turf", value: w.turf * Math.min(row.turf14Kills / refs.refTurf, 2), text: `${row.turf14Kills} turf kills in 14 days` },
        { name: "delta", value: row.score14Delta === null ? 0 : w.delta * Math.min(row.score14Delta / refs.refDelta, 2), text: `14 day score gain ${row.score14Delta ?? "unknown"}` },
    ];
    const paper = terms.slice(0, 5).reduce((a, t) => a + t.value, 0);
    const activity = terms.slice(5).reduce((a, t) => a + t.value, 0);
    const bonus = (row.linked ? 0 : -cfg.penalties.unlinked) + (cfg.roleBonus[row.rank] ?? 0);
    const total = paper + activity + bonus;

    const inactive = isInactive(row);
    const isProtected = row.nukes >= cfg.protect.nukes || row.level >= cfg.protect.level || row.rank >= cfg.protect.rank;

    /** @type {"keep" | "watch" | "kick"} */
    let verdict;
    /** @type {string[]} */
    let reasons;
    if (inactive && !isProtected){
        verdict = "kick";
        reasons = ["no clan score in 7 days and no turf games in 14 days"];
    }
    else if (inactive){
        verdict = "watch";
        reasons = [`inactive but protected (${row.nukes} nukes, level ${row.level}${row.rank >= cfg.protect.rank ? ", officer" : ""})`];
    }
    else {
        if (total < cfg.thresholds.kick) verdict = "kick";
        else if (total < cfg.thresholds.watch) verdict = "watch";
        else verdict = "keep";
        const candidates = terms.filter(t => !(t.name === "delta" && row.score14Delta === null) && !(t.name === "rank" && row.rankedRank === 0));
        const weakest = [...candidates].sort((a, b) => a.value - b.value).slice(0, 2).map(t => t.text);
        if (!row.linked) weakest[1] = "not linked on Discord";
        reasons = verdict === "keep" ? [] : weakest;
    }

    return { paper, activity, bonus, total, inactive, "protected": isProtected, verdict, reasons };
};

const ORDER = { kick: 0, watch: 1, keep: 2 };

/**
 * Review every member
 *
 * @param {ReviewRow[]} rows
 * @param {typeof DEFAULT_REVIEW} [cfg=DEFAULT_REVIEW]
 * @return {{ rows: Array<ReviewRow & { review: ReturnType<typeof scoreMember> }>, summary: { total: number, kick: number, watch: number, keep: number, protectedInactive: number }, refs: ReturnType<typeof computeRefs> }}
 */
export const reviewClan = function(rows, cfg = DEFAULT_REVIEW){
    const refs = computeRefs(rows);
    const scored = rows.map(r => ({ ...r, review: scoreMember(r, refs, cfg) }));
    scored.sort((a, b) => ORDER[a.review.verdict] - ORDER[b.review.verdict] || a.review.total - b.review.total);
    const summary = {
        total: scored.length,
        kick: scored.filter(r => r.review.verdict === "kick").length,
        watch: scored.filter(r => r.review.verdict === "watch").length,
        keep: scored.filter(r => r.review.verdict === "keep").length,
        protectedInactive: scored.filter(r => r.review.inactive && r.review.protected).length,
    };
    return { rows: scored, summary, refs };
};
