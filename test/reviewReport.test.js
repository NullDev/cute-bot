import { test } from "node:test";
import assert from "node:assert/strict";
import { createClanDb } from "../src/service/clan/db.js";
import { upsertSnapshot, upsertTurfDay } from "../src/service/clan/snapshot.js";
import { buildReviewRows, formatReviewTable } from "../src/service/clan/reviewReport.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

const snap = (playerId, day, score, extra = {}) => ({
    player_id: playerId, day, taken_at: 1, player_name: "P" + playerId, in_clan: 1, clan_role: 0, s7: 10,
    score, kills: 200, deaths: 100, wins: 1, games: 20, timeplayed: 3600000, nukes: 3, ranked_rank: 0, online: 0, created_at_game: "2020-01-01 00:00:00", ...extra,
});

test("buildReviewRows joins snapshot, turf sum and 14 day delta", () => {
    const db = createClanDb(":memory:");
    upsertSnapshot(db, snap(1, 207, 1000000));
    upsertSnapshot(db, snap(1, 193, 900000));
    upsertSnapshot(db, snap(2, 207, 400));
    upsertTurfDay(db, { playerId: 1, day: 207, kills: 5, deaths: 1, games: 1 });
    upsertTurfDay(db, { playerId: 1, day: 194, kills: 7, deaths: 1, games: 2 });
    upsertTurfDay(db, { playerId: 1, day: 193, kills: 100, deaths: 1, games: 9 });
    const roster = { members: [
        { playerId: 1, playerName: "P1", rank: 1, s7: 50 },
        { playerId: 2, playerName: "P2", rank: 0, s7: 0 },
        { playerId: 3, playerName: "NoSnap", rank: 0, s7: 0 },
    ] };
    const links = new Map([["d", { playerId: 1 }]]);
    const rows = buildReviewRows(db, roster, links, 207);
    assert.equal(rows.length, 3);
    const p1 = rows.find(r => r.playerId === 1);
    assert.equal(p1.linked, true);
    assert.equal(p1.level, 30);
    assert.equal(p1.kdr, 2);
    assert.equal(p1.kpg, 10);
    assert.equal(p1.s7, 50);
    assert.equal(p1.turf14Kills, 12);
    assert.equal(p1.turf14Games, 3);
    assert.equal(p1.score14Delta, 100000);
    assert.equal(p1.hours, 1);
    const p2 = rows.find(r => r.playerId === 2);
    assert.equal(p2.score14Delta, null);
    assert.equal(p2.linked, false);
    const p3 = rows.find(r => r.playerId === 3);
    assert.equal(p3.level, 0);
    assert.equal(p3.kdr, 0);
});

test("formatReviewTable has a header and one line per row", () => {
    const text = formatReviewTable([{
        playerId: 1, playerName: "P1", rank: 1, linked: true, level: 30, kdr: 2, kpg: 10, nukes: 3, s7: 50, turf14Kills: 12, turf14Games: 3,
        score14Delta: 100000, rankedRank: 0, hours: 1, since: "2020-01-01",
        review: { verdict: "keep", total: 3.2, reasons: [] },
    }]);
    const lines = text.trimEnd().split("\n");
    assert.equal(lines.length, 2);
    assert.match(lines[0], /name/);
    assert.match(lines[1], /^P1 /);
    assert.match(lines[1], /keep/);
});
