import { test } from "node:test";
import assert from "node:assert/strict";
import { createClanDb } from "../src/service/clan/db.js";
import { buildSnapshotRow, upsertSnapshot, runSnapshot, backfillTurf, hasSnapshotForDay, latestSnapshotDay } from "../src/service/clan/snapshot.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

const PROFILE = {
    player_id: 7610743, player_name: "NulPing", player_score: 19450609, player_kills: 159522, player_deaths: 117807,
    player_wins: 4835, player_games_played: 15613, player_timeplayed: 2164119300, ranked_rank: 0, online: 1,
    player_datenew: "2019-11-14 09:07:10", player_stats: { n: 16 },
};

test("buildSnapshotRow maps a profile and roster entry", () => {
    const row = buildSnapshotRow(PROFILE, { rank: 3, s7: 306910 }, 207, 5);
    assert.deepEqual(row, {
        player_id: 7610743, day: 207, taken_at: 5, player_name: "NulPing", in_clan: 1, clan_role: 3, s7: 306910,
        score: 19450609, kills: 159522, deaths: 117807, wins: 4835, games: 15613, timeplayed: 2164119300, nukes: 16,
        ranked_rank: 0, online: 1, created_at_game: "2019-11-14 09:07:10",
    });
    const off = buildSnapshotRow({ ...PROFILE, player_stats: {} }, null, 207, 5);
    assert.equal(off.in_clan, 0);
    assert.equal(off.clan_role, null);
    assert.equal(off.nukes, 0);
});

test("runSnapshot writes roster members and linked players, skips failures", async() => {
    const db = createClanDb(":memory:");
    db.prepare("insert into players (guild_id, discord_id, player_id, player_name, linked_at, source) values ('g', 'd', 999, 'Linked', 1, 'verify')").run();
    const api = {
        getPlayer: async name => {
            if (name === "Broken") throw new Error("boom");
            if (name === "Linked") return { ...PROFILE, player_id: 999, player_name: "Linked" };
            return { ...PROFILE, player_name: name };
        },
    };
    const roster = { members: [
        { playerId: 7610743, playerName: "NulPing", rank: 3, s7: 1 },
        { playerId: 5, playerName: "Broken", rank: 0, s7: 0 },
    ] };
    const res = await runSnapshot(db, api, roster, { guildId: "g", day: 207, now: 9 });
    assert.deepEqual(res, { ok: 2, failed: ["Broken"] });
    assert.equal(db.prepare("select count(*) as c from snapshots where day = 207").get().c, 2);
    assert.equal(db.prepare("select in_clan from snapshots where player_id = 999").get().in_clan, 0);
    assert.equal(hasSnapshotForDay(db, 207), true);
    assert.equal(latestSnapshotDay(db), 207);
});

test("upsertSnapshot replaces the same day", () => {
    const db = createClanDb(":memory:");
    upsertSnapshot(db, buildSnapshotRow(PROFILE, null, 1, 1));
    upsertSnapshot(db, buildSnapshotRow({ ...PROFILE, player_score: 5 }, null, 1, 2));
    assert.equal(db.prepare("select score from snapshots").get().score, 5);
});

test("backfillTurf writes one row per player and day", async() => {
    const db = createClanDb(":memory:");
    const api = { getTurfPlayers: async(clanId, day) => [{ player_id: 1, player_name: "A", kills: day, deaths: 1, games: 2 }] };
    const n = await backfillTurf(db, api, 561461, 205, 207);
    assert.equal(n, 3);
    assert.equal(db.prepare("select kills from turf_days where player_id = 1 and day = 206").get().kills, 206);
});
