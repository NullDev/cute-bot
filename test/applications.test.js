import { test } from "node:test";
import assert from "node:assert/strict";
import { createClanDb } from "../src/service/clan/db.js";
import { linkPlayer, getLinkByDiscord } from "../src/service/clan/identity.js";
import {
    canApply, createApplication, setApplicationMessage, getApplication, finalizeDecision, listByStatus,
    markJoined, markReminded, markExpired, planPendingJoins,
} from "../src/service/clan/applications.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

const DAY = 86400000;
const ANSWERS = { ign: "Vorfw", modeRegion: "Turf, EU", why: "cute", duel: "yes", extra: "" };

const fresh = () => createClanDb(":memory:");

test("canApply blocks pending, cooldown and taken players", () => {
    const db = fresh();
    assert.deepEqual(canApply(db, { guildId: "g", discordId: "a", playerId: 1, now: 0, cooldownDays: 7 }), { ok: true });

    const id = createApplication(db, { guildId: "g", discordId: "a", playerId: 1, playerName: "Vorfw", answers: ANSWERS, now: 0 });
    assert.deepEqual(canApply(db, { guildId: "g", discordId: "a", playerId: 1, now: 1, cooldownDays: 7 }), { ok: false, reason: "pending" });

    finalizeDecision(db, { id, status: "rejected", reviewerId: "mod", reason: "no", now: DAY, effects: {} });
    const cd = canApply(db, { guildId: "g", discordId: "a", playerId: 1, now: 2 * DAY, cooldownDays: 7 });
    assert.deepEqual(cd, { ok: false, reason: "cooldown", until: 8 * DAY });
    assert.deepEqual(canApply(db, { guildId: "g", discordId: "a", playerId: 1, now: 9 * DAY, cooldownDays: 7 }), { ok: true });

    linkPlayer(db, { guildId: "g", discordId: "someone", playerId: 1, playerName: "Vorfw", source: "verify", now: 0 });
    assert.deepEqual(canApply(db, { guildId: "g", discordId: "b", playerId: 1, now: 9 * DAY, cooldownDays: 7 }), { ok: false, reason: "player_taken", discordId: "someone" });
});

test("createApplication stores answers and message ids", () => {
    const db = fresh();
    const id = createApplication(db, { guildId: "g", discordId: "a", playerId: 1, playerName: "Vorfw", answers: ANSWERS, now: 5 });
    setApplicationMessage(db, id, "chan", "msg");
    const app = getApplication(db, id);
    assert.equal(app.status, "pending");
    assert.deepEqual(app.answers, ANSWERS);
    assert.equal(app.messageId, "msg");
    assert.equal(getApplication(db, 999), null);
});

test("finalizeDecision accept links the player, runs effects, and survives DM failure", async() => {
    const db = fresh();
    const id = createApplication(db, { guildId: "g", discordId: "a", playerId: 1, playerName: "Vorfw", answers: ANSWERS, now: 0 });
    const calls = [];
    const result = await finalizeDecision(db, {
        id, status: "accepted", reviewerId: "mod", reason: null, now: 10,
        effects: {
            grantRoles: async() => { calls.push("roles"); },
            dm: async() => { throw new Error("Cannot send messages to this user"); },
            editEmbed: async(app, r) => { calls.push("embed:" + r.dmOk); },
        },
    });
    assert.equal(result.rolesOk, true);
    assert.equal(result.dmOk, false);
    assert.deepEqual(calls, ["roles", "embed:false"]);
    const app = getApplication(db, id);
    assert.equal(app.status, "accepted");
    assert.equal(app.reviewerId, "mod");
    assert.equal(app.decidedAt, 10);
    assert.equal(getLinkByDiscord(db, "g", "a").playerId, 1);
});

test("finalizeDecision accept reports a taken player instead of linking", async() => {
    const db = fresh();
    linkPlayer(db, { guildId: "g", discordId: "other", playerId: 1, playerName: "Vorfw", source: "verify", now: 0 });
    const id = createApplication(db, { guildId: "g", discordId: "a", playerId: 1, playerName: "Vorfw", answers: ANSWERS, now: 0 });
    const result = await finalizeDecision(db, { id, status: "accepted", reviewerId: "mod", reason: null, now: 1, effects: {} });
    assert.equal(result.rolesOk, false);
    assert.match(result.rolesError, /other/);
    assert.equal(getApplication(db, id).status, "accepted");
});

test("finalizeDecision refuses a second decision", async() => {
    const db = fresh();
    const id = createApplication(db, { guildId: "g", discordId: "a", playerId: 1, playerName: "Vorfw", answers: ANSWERS, now: 0 });
    await finalizeDecision(db, { id, status: "rejected", reviewerId: "m1", reason: "x", now: 1, effects: {} });
    await assert.rejects(() => finalizeDecision(db, { id, status: "accepted", reviewerId: "m2", reason: null, now: 2, effects: {} }), /already decided/);
});

test("status helpers and listByStatus", async() => {
    const db = fresh();
    const id = createApplication(db, { guildId: "g", discordId: "a", playerId: 1, playerName: "V", answers: ANSWERS, now: 0 });
    await finalizeDecision(db, { id, status: "accepted", reviewerId: "m", reason: null, now: 1, effects: {} });
    assert.equal(listByStatus(db, "g", "accepted").length, 1);
    markReminded(db, id, 2);
    assert.equal(getApplication(db, id).remindedAt, 2);
    markJoined(db, id, 3);
    assert.equal(getApplication(db, id).status, "joined");
    const id2 = createApplication(db, { guildId: "g", discordId: "b", playerId: 2, playerName: "W", answers: ANSWERS, now: 0 });
    await finalizeDecision(db, { id: id2, status: "accepted", reviewerId: "m", reason: null, now: 1, effects: {} });
    markExpired(db, id2, 4);
    assert.equal(getApplication(db, id2).status, "expired");
    assert.equal(listByStatus(db, "g", "accepted").length, 0);
});

test("planPendingJoins splits into joined, remind and expire", () => {
    const now = 20 * DAY;
    const apps = [
        { id: 1, playerId: 1, decidedAt: now - DAY, remindedAt: null },
        { id: 2, playerId: 2, decidedAt: now - 4 * DAY, remindedAt: null },
        { id: 3, playerId: 3, decidedAt: now - 4 * DAY, remindedAt: now - DAY },
        { id: 4, playerId: 4, decidedAt: now - 15 * DAY, remindedAt: now - 10 * DAY },
        { id: 5, playerId: 5, decidedAt: now - DAY, remindedAt: null },
    ];
    const plan = planPendingJoins(apps, new Set([1, 4]), now, { reminderDays: 3, expireDays: 14 });
    assert.deepEqual(plan.joined.map(a => a.id), [1, 4]);
    assert.deepEqual(plan.remind.map(a => a.id), [2]);
    assert.deepEqual(plan.expire.map(a => a.id), []);
    const later = planPendingJoins(apps.filter(a => a.id === 3), new Set(), now + 11 * DAY, { reminderDays: 3, expireDays: 14 });
    assert.deepEqual(later.expire.map(a => a.id), [3]);
});
