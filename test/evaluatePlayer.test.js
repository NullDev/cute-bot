import { test } from "node:test";
import assert from "node:assert/strict";
import { turf14FromContributions, applicantRow, applicantVerdict } from "../src/service/clan/evaluatePlayer.js";
import { scoreMember, explainMember, DEFAULT_REVIEW } from "../src/service/clan/review.js";
import { buildEvaluationEmbed } from "../src/service/clan/evaluate.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

const REFS = { refS7: 90625, refTurf: 296, refDelta: 1, medLevel: 30, medKdr: 1.5, medKpg: 7, medPaper: 1.0, medActivity: 2.5 };

const PROFILE = {
    player_id: 123, player_name: "Vorfw", player_clan: null, player_score: 2000000, player_kills: 20000, player_deaths: 10000,
    player_wins: 500, player_games_played: 2000, player_timeplayed: 360000000, player_datenew: "2022-01-01 00:00:00", ranked_rank: 0,
    player_stats: { n: 3, hs: 5000, h: 40000, s: 100000 },
};

test("turf14FromContributions sums only the last 14 days and notes the clans played for", () => {
    const rows = [
        { day: 207, clan_name: "TWZY", kills: 50, games: 4 },
        { day: 207, clan_name: "TWZY", kills: 20, games: 2 },
        { day: 194, clan_name: "cute", kills: 10, games: 1 },
        { day: 193, clan_name: "cute", kills: 999, games: 9 },
    ];
    assert.deepEqual(turf14FromContributions(rows, 207), { kills: 80, games: 7, clans: { TWZY: 6, cute: 1 } });
    assert.deepEqual(turf14FromContributions([], 207), { kills: 0, games: 0, clans: {} });
});

test("applicantRow leaves the clan score unknown and the scorer credits it at the median", () => {
    const row = applicantRow(PROFILE, { kills: 600, games: 50 });
    assert.equal(row.s7, null);
    assert.equal(row.linked, true, "no link penalty for non-members");
    assert.equal(row.level, 42);
    assert.equal(row.kdr, 2);
    const result = scoreMember(row, REFS, DEFAULT_REVIEW);
    assert.equal(result.inactive, false);
    assert.equal(result.terms.find(t => t.name === "s7")?.value, 0, "unknown clan score gets no credit");
    const text = explainMember(row, result, REFS, DEFAULT_REVIEW).join("\n");
    assert.ok(text.includes("gets no credit"), text);
    assert.ok(text.includes("No Discord link penalty"), text);
    assert.ok(text.includes("Would-be verdict ACCEPT"), text);
    assert.ok(!text.includes("Verdict KEEP"), text);
});

test("applicantVerdict maps keep to accept and the rest to deny", () => {
    assert.deepEqual(applicantVerdict("keep"), { label: "ACCEPT", borderline: false });
    assert.deepEqual(applicantVerdict("watch"), { label: "DENY", borderline: true });
    assert.deepEqual(applicantVerdict("kick"), { label: "DENY", borderline: false });
});

test("evaluation embed shows a would-be verdict and the clans played for when not a member", () => {
    const turf14 = { kills: 600, games: 50, clans: { TWZY: 50 } };
    const row = applicantRow(PROFILE, turf14);
    const result = scoreMember(row, REFS, DEFAULT_REVIEW);
    const embed = buildEvaluationEmbed({ row, result, refs: REFS, cfg: DEFAULT_REVIEW, profile: PROFILE, turf: null, turf14, member: false }).toJSON();
    assert.ok(embed.description.includes("Would-be verdict: **ACCEPT**"), embed.description);
    const recent = embed.fields.find(f => f.name === "Last 14 days")?.value ?? "";
    assert.ok(recent.includes("played for [TWZY] 50 games"), recent);
    assert.ok(recent.includes("members only"), recent);
});

test("a high level applicant with no recent turf is a borderline deny", () => {
    const veteran = { ...PROFILE, player_score: 27400000, player_kills: 232443, player_deaths: 236468, player_games_played: 36924, player_stats: { n: 6 } };
    const row = applicantRow(veteran, { kills: 25, games: 2 });
    const result = scoreMember(row, REFS, DEFAULT_REVIEW);
    assert.equal(result.verdict, "watch");
    assert.deepEqual(applicantVerdict(result.verdict), { label: "DENY", borderline: true });
});

