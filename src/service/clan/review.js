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
    const known = rows.filter(r => r.level > 0);
    return {
        refS7: median(nz(active.map(r => r.s7))) || 1,
        refTurf: median(nz(active.map(r => r.turf14Kills))) || 1,
        refDelta: median(nz(active.map(r => r.score14Delta ?? 0))) || 1,
        medLevel: known.length ? median(known.map(r => r.level)) : 0,
        medKdr: known.length ? median(known.map(r => r.kdr)) : 0,
        medKpg: known.length ? median(known.map(r => r.kpg)) : 0,
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

    return { paper, activity, bonus, total, inactive, "protected": isProtected, verdict, reasons, terms };
};

/**
 * @param {number} n
 * @return {string}
 */
const fmt = n => Math.round(n).toLocaleString("en-US");

/**
 * "above", "below" or "around" a reference value
 *
 * @param {number} value
 * @param {number} ref
 * @return {string}
 */
const relation = function(value, ref){
    if (!ref) return "with no clan reference";
    const ratio = value / ref;
    if (ratio >= 1.15) return "above";
    if (ratio <= 0.85) return "below";
    return "around";
};

/**
 * Plain-language reasoning behind a verdict, one sentence per line
 *
 * @param {ReviewRow} row
 * @param {ReturnType<typeof scoreMember>} result
 * @param {ReturnType<typeof computeRefs>} refs
 * @param {typeof DEFAULT_REVIEW} cfg
 * @return {string[]}
 */
export const explainMember = function(row, result, refs, cfg){
    const lines = [];
    const lvl = Math.min(row.level, 150);

    // activity
    if (result.inactive){
        lines.push("No clan score in the last 7 days and no turf games in the last 14 days.");
    }
    else {
        if (row.turf14Games > 0){
            lines.push(`Played ${fmt(row.turf14Games)} turf games with ${fmt(row.turf14Kills)} kills in the last 14 days, ${(row.turf14Kills / refs.refTurf).toFixed(1)}x the clan median of ${fmt(refs.refTurf)} kills.`);
        }
        else lines.push("No turf games in the last 14 days.");
        lines.push(`${fmt(row.s7)} clan score in the last 7 days, ${relation(row.s7, refs.refS7)} the median of ${fmt(refs.refS7)}.`);
        if (row.score14Delta !== null) lines.push(`Gained ${fmt(row.score14Delta)} score in the last 14 days, ${relation(row.score14Delta, refs.refDelta)} the median of ${fmt(refs.refDelta)}.`);
    }

    // paper
    lines.push(`Level ${row.level}, ${relation(row.level, refs.medLevel)} the clan median of ${fmt(refs.medLevel)}.`);
    let kdrWord = "is solid";
    if (row.kdr < 1) kdrWord = "is below 1.0";
    else if (row.kdr >= 2) kdrWord = "is strong";
    lines.push(`KDR ${row.kdr.toFixed(2)} ${kdrWord}, ${relation(row.kdr, refs.medKdr)} the clan median of ${refs.medKdr.toFixed(2)}; at level ${row.level} KDR counts ${Math.round((1 - lvl / 200) * 100)}% of its full weight.`);
    lines.push(`${row.kpg.toFixed(1)} kills per game, ${relation(row.kpg, refs.medKpg)} the clan median of ${refs.medKpg.toFixed(1)}.`);
    if (row.nukes > 0) lines.push(`${fmt(row.nukes)} nukes${row.nukes >= cfg.protect.nukes ? ", enough to be protected" : ""}.`);
    else lines.push("No nukes.");
    lines.push(row.rankedRank > 0 ? `Placed in ranked at rank ${row.rankedRank}.` : "Not placed in ranked.");

    // standing
    lines.push(row.linked ? "Linked on Discord." : `Not linked on Discord (${-cfg.penalties.unlinked} penalty).`);
    if (row.rank > 0) lines.push(`Holds an in-game rank above recruit (+${cfg.roleBonus[row.rank] ?? 0}).`);
    if (result.protected){
        const why = [];
        if (row.nukes >= cfg.protect.nukes) why.push(`${fmt(row.nukes)} nukes`);
        if (row.level >= cfg.protect.level) why.push(`level ${row.level}`);
        if (row.rank >= cfg.protect.rank) why.push("officer rank");
        lines.push(`Protected from a kick (${why.join(", ")}).`);
    }

    // verdict
    const total = result.total.toFixed(2);
    lines.push(`Verdict ${result.verdict.toUpperCase()} with a total of ${total} (paper ${result.paper.toFixed(2)}, activity ${result.activity.toFixed(2)}, bonus ${result.bonus.toFixed(2)}); watch below ${cfg.thresholds.watch}, kick below ${cfg.thresholds.kick}.`);
    if (result.verdict === "keep" && !result.inactive){
        if (result.paper < cfg.thresholds.watch && result.activity >= cfg.thresholds.watch) lines.push("Activity carries this verdict: on paper alone this member would not reach the keep line.");
        else if (result.activity < cfg.thresholds.watch && result.paper >= cfg.thresholds.watch) lines.push("Paper stats carry this verdict: the recent activity alone would not reach the keep line.");
    }
    return lines;
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
