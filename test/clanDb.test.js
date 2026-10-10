import { test } from "node:test";
import assert from "node:assert/strict";
import { createClanDb } from "../src/service/clan/db.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

test("createClanDb creates all tables", () => {
    const db = createClanDb(":memory:");
    const names = db.prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name").all().map(r => r.name);
    assert.deepEqual(names, ["applications", "player_names", "players", "snapshots", "turf_days"]);
});

test("players enforces one discord user per player id", () => {
    const db = createClanDb(":memory:");
    const ins = db.prepare("insert into players (guild_id, discord_id, player_id, player_name, linked_at, source) values (?, ?, ?, ?, ?, ?)");
    ins.run("g", "d1", 7, "A", 1, "verify");
    assert.throws(() => ins.run("g", "d2", 7, "a", 2, "verify"), /UNIQUE/);
});

test("snapshots upsert on player and day", () => {
    const db = createClanDb(":memory:");
    const up = db.prepare("insert into snapshots (player_id, day, taken_at, player_name, in_clan, score) values (?, ?, ?, ?, ?, ?) on conflict (player_id, day) do update set score = excluded.score");
    up.run(7, 207, 1, "A", 1, 10);
    up.run(7, 207, 2, "A", 1, 20);
    assert.equal(db.prepare("select score from snapshots where player_id = 7 and day = 207").get().score, 20);
});
