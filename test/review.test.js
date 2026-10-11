import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_REVIEW, computeRefs, scoreMember, reviewClan, explainMember, computeScoreMedians } from "../src/service/clan/review.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

const base = { playerId: 1, playerName: "x", rank: 0, linked: true, level: 40, kdr: 1.2, kpg: 7, nukes: 0, s7: 100000, turf14Kills: 500, turf14Games: 50, score14Delta: null, rankedRank: 0 };
const refs = { refS7: 100000, refTurf: 500, refDelta: 1 };

test("inactive unprotected member is a kick with the inactivity reason", () => {
    const r = scoreMember({ ...base, s7: 0, turf14Kills: 0, turf14Games: 0 }, refs, DEFAULT_REVIEW);
    assert.equal(r.inactive, true);
    assert.equal(r.protected, false);
    assert.equal(r.verdict, "kick");
    assert.match(r.reasons[0], /no clan score in 7 days/);
});

test("inactive nuker is protected and only a watch", () => {
    const r = scoreMember({ ...base, s7: 0, turf14Kills: 0, turf14Games: 0, nukes: 749, level: 112, kdr: 6 }, refs, DEFAULT_REVIEW);
    assert.equal(r.protected, true);
    assert.equal(r.verdict, "watch");
    assert.match(r.reasons[0], /protected/);
});

test("captain is protected", () => {
    const r = scoreMember({ ...base, s7: 0, turf14Kills: 0, turf14Games: 0, rank: 2 }, refs, DEFAULT_REVIEW);
    assert.equal(r.verdict, "watch");
});

test("active average member is a keep", () => {
    const r = scoreMember(base, refs, DEFAULT_REVIEW);
    assert.equal(r.verdict, "keep");
    assert.ok(r.total >= DEFAULT_REVIEW.thresholds.watch);
});

test("KDR counts less at high level", () => {
    const low = scoreMember({ ...base, level: 20, kdr: 0.5 }, refs, DEFAULT_REVIEW);
    const high = scoreMember({ ...base, level: 140, kdr: 0.5 }, refs, DEFAULT_REVIEW);
    assert.ok(high.paper > low.paper);
});

test("weak active member lands in watch or kick with the lowest terms as reasons", () => {
    const r = scoreMember({ ...base, level: 15, kdr: 0.5, kpg: 2, s7: 5000, turf14Kills: 10, turf14Games: 2, linked: false }, refs, DEFAULT_REVIEW);
    assert.notEqual(r.verdict, "keep");
    assert.equal(r.reasons.length, 2);
});

test("reasons skip the unknown delta and not ranked terms", () => {
    const r = scoreMember({ ...base, level: 15, kdr: 0.5, kpg: 2, s7: 5000, turf14Kills: 10, turf14Games: 2, score14Delta: null, rankedRank: 0 }, refs, DEFAULT_REVIEW);
    assert.notEqual(r.verdict, "keep");
    assert.equal(r.reasons.length, 2);
    for (const reason of r.reasons){
        assert.ok(!reason.includes("unknown"), reason);
        assert.ok(!reason.includes("not ranked"), reason);
    }
});

test("computeRefs takes medians over active members", () => {
    const refsOut = computeRefs([
        { ...base, s7: 10, turf14Kills: 1, turf14Games: 1 },
        { ...base, s7: 30, turf14Kills: 3, turf14Games: 1 },
        { ...base, s7: 0, turf14Kills: 0, turf14Games: 0 },
    ]);
    assert.equal(refsOut.refS7, 20);
    assert.equal(refsOut.refTurf, 2);
    assert.equal(refsOut.refDelta, 1);
});

test("reviewClan sorts kick first and summarises", () => {
    const out = reviewClan([
        { ...base, playerId: 1 },
        { ...base, playerId: 2, s7: 0, turf14Kills: 0, turf14Games: 0 },
        { ...base, playerId: 3, s7: 0, turf14Kills: 0, turf14Games: 0, nukes: 100 },
    ]);
    assert.deepEqual(out.rows.map(r => r.review.verdict), ["kick", "watch", "keep"]);
    assert.deepEqual(out.summary, { total: 3, kick: 1, watch: 1, keep: 1, protectedInactive: 1 });
});

test("computeRefs also reports clan medians for level, kdr and kpg over all members", () => {
    const refsOut = computeRefs([
        { ...base, level: 10, kdr: 0.5, kpg: 2 },
        { ...base, level: 30, kdr: 1.5, kpg: 6 },
        { ...base, level: 50, kdr: 2.5, kpg: 10, s7: 0, turf14Kills: 0, turf14Games: 0 },
    ]);
    assert.equal(refsOut.medLevel, 30);
    assert.equal(refsOut.medKdr, 1.5);
    assert.equal(refsOut.medKpg, 6);
});

test("scoreMember exposes the term values", () => {
    const r = scoreMember(base, refs, DEFAULT_REVIEW);
    assert.deepEqual(r.terms.map(t => t.name), ["level", "nukes", "kdr", "kpg", "rank", "s7", "turf", "delta"]);
    assert.ok(r.terms.every(t => typeof t.value === "number"));
});

test("explainMember writes the activity and paper reasoning against the clan medians", () => {
    const row = { ...base, playerName: "CHHG", level: 14, kdr: 0.78, kpg: 3.3, s7: 76330, turf14Kills: 790, turf14Games: 110, linked: false, rankedRank: 3 };
    const fullRefs = { refS7: 90625, refTurf: 296, refDelta: 1, medLevel: 30, medKdr: 1.5, medKpg: 7, medPaper: 1.0, medActivity: 2.5 };
    const result = scoreMember(row, fullRefs, DEFAULT_REVIEW);
    const text = explainMember(row, result, fullRefs, DEFAULT_REVIEW).join("\n");
    for (const expected of [
        "Played 110 turf games with 790 kills in the last 14 days",
        "2.7x the clan median of 296",
        "76,330 clan score in the last 7 days",
        "below the median of 90,625",
        "Level 14, below the clan median of 30",
        "KDR 0.78 is below 1.0",
        "3.3 kills per game",
        "No nukes",
        "Not linked on Discord",
        "Verdict KEEP",
        "Paper stats score 0.20, below the clan median of 1.00",
        "Activity carries this verdict",
    ]) assert.ok(text.includes(expected), `expected "${expected}" in:\n${text}`);
});

test("explainMember says both sides are fine for a solid active member", () => {
    const row = { ...base, level: 28, kdr: 1.81, kpg: 4.0, s7: 136800, turf14Kills: 928, turf14Games: 86, rankedRank: 9 };
    const fullRefs = { refS7: 80732, refTurf: 296, refDelta: 1, medLevel: 32, medKdr: 1.59, medKpg: 7.1, medPaper: 1.0, medActivity: 2.5 };
    const result = scoreMember(row, fullRefs, DEFAULT_REVIEW);
    const text = explainMember(row, result, fullRefs, DEFAULT_REVIEW).join("\n");
    assert.ok(text.includes("Both paper stats and recent activity are at or above the clan median."), text);
    assert.ok(!text.includes("would not reach the keep line"), text);
});

test("computeScoreMedians reports the clan median paper and activity scores", () => {
    const meds = computeScoreMedians([
        { ...base, level: 10, kdr: 0.8 },
        { ...base, level: 60, kdr: 2.5, nukes: 30 },
        { ...base, s7: 0, turf14Kills: 0, turf14Games: 0 },
    ], refs, DEFAULT_REVIEW);
    assert.ok(meds.medPaper > 0);
    assert.ok(meds.medActivity > 0);
});

test("explainMember explains an inactive protected member", () => {
    const row = { ...base, playerName: "Amox", level: 112, nukes: 749, kdr: 6.05, s7: 0, turf14Kills: 0, turf14Games: 0 };
    const fullRefs = { ...refs, medLevel: 30, medKdr: 1.5, medKpg: 7 };
    const result = scoreMember(row, fullRefs, DEFAULT_REVIEW);
    const text = explainMember(row, result, fullRefs, DEFAULT_REVIEW).join("\n");
    assert.ok(text.includes("No clan score in the last 7 days and no turf games in the last 14 days"), text);
    assert.ok(text.includes("Protected from a kick"), text);
    assert.ok(text.includes("Verdict WATCH"), text);
});

test("a member who joined within the grace period is kept even with no stats", () => {
    const fresh = { ...base, s7: 0, turf14Kills: 0, turf14Games: 0, level: 5, kdr: 0.4, memberDays: 2 };
    const r = scoreMember(fresh, refs, DEFAULT_REVIEW);
    assert.equal(r.grace, true);
    assert.equal(r.verdict, "keep");
    assert.match(r.reasons[0], /joined 2 days ago, grace period of 7 days/);
    const old = scoreMember({ ...fresh, memberDays: 9 }, refs, DEFAULT_REVIEW);
    assert.equal(old.verdict, "kick");
    const unknown = scoreMember({ ...fresh, memberDays: null }, refs, DEFAULT_REVIEW);
    assert.equal(unknown.verdict, "kick");
    const text = explainMember(fresh, r, { ...refs, medLevel: 30, medKdr: 1.5, medKpg: 7 }, DEFAULT_REVIEW).join("\n");
    assert.ok(text.includes("within the grace period"), text);
});

test("score medians ignore members without a snapshot and the comparison copes with negative medians", () => {
    const rows = [
        { ...base, level: 0, kdr: 0, kpg: 0 },
        { ...base, level: 0, kdr: 0, kpg: 0 },
        { ...base, level: 40, kdr: 1.5 },
    ];
    const meds = computeScoreMedians(rows, refs, DEFAULT_REVIEW);
    assert.ok(meds.medPaper > 0, `median paper should come from snapshotted members, got ${meds.medPaper}`);

    const star = { ...base, level: 150, kdr: 4.14, kpg: 13.5, nukes: 924, rank: 1, s7: 811115, turf14Kills: 1672, turf14Games: 94 };
    const fullRefs = { ...refs, medLevel: 81, medKdr: 2.33, medKpg: 8.4, medPaper: -1.0, medActivity: 2.05 };
    const result = scoreMember(star, fullRefs, DEFAULT_REVIEW);
    const text = explainMember(star, result, fullRefs, DEFAULT_REVIEW).join("\n");
    assert.ok(text.includes("above the clan median of -1.00"), text);
    assert.ok(text.includes("Both paper stats and recent activity are at or above the clan median."), text);
    assert.ok(!text.includes("looks weaker"), text);

    const unsnapshotted = { ...base, level: 0, kdr: 0, kpg: 0 };
    const text2 = explainMember(unsnapshotted, scoreMember(unsnapshotted, fullRefs, DEFAULT_REVIEW), fullRefs, DEFAULT_REVIEW).join("\n");
    assert.ok(text2.includes("No daily snapshot for this member yet"), text2);
});

