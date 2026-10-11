import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { createClanDb } from "../src/service/clan/db.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

test("createClanDb creates all tables", () => {
    const db = createClanDb(":memory:");
    const names = db.prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name").all().map(r => r.name);
    assert.deepEqual(names, ["applications", "player_names", "players", "snapshots", "turf_days", "turf_watch_log", "turf_watch_state"]);
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

test("an applications table from before the interview column gets it on open", () => {
    const file = path.join(os.tmpdir(), `clan-migrate-${process.pid}-${Date.now()}.sqlite`);
    const old = new Database(file);
    old.exec("create table applications (id integer primary key autoincrement, guild_id text not null, discord_id text not null, player_id integer not null, player_name text not null, answers text not null, status text not null, channel_id text, message_id text, reviewer_id text, reason text, created_at integer not null, decided_at integer, joined_at integer, reminded_at integer)");
    old.close();
    const db = createClanDb(file);
    const cols = db.pragma("table_info(applications)").map(c => c.name);
    assert.ok(cols.includes("interview_channel_id"));
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(file + suffix, { force: true });
});
