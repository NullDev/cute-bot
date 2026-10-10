import { test } from "node:test";
import assert from "node:assert/strict";
import { createClanDb } from "../src/service/clan/db.js";
import {
    resolveIgn, suggestIgns, linkPlayer, unlinkDiscord, getLinkByDiscord, getLinkByPlayer, listLinks, migrateQuickDb,
} from "../src/service/clan/identity.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

/**
 * Fake api backed by a name -> profile map (case-insensitive)
 *
 * @param {Record<string, { player_id: number, player_name: string, player_clan?: string }>} players
 */
const fakeApi = function(players){
    const byLower = Object.fromEntries(Object.values(players).map(p => [p.player_name.toLowerCase(), p]));
    return {
        getPlayer: async name => byLower[name.toLowerCase()] ?? null,
        searchPlayers: async q => Object.values(players).filter(p => p.player_name.toLowerCase().includes(q.toLowerCase())),
    };
};

const PLAYERS = {
    nul: { player_id: 7610743, player_name: "NulPing", player_clan: "cute" },
    mun: { player_id: 100, player_name: "mungat0923", player_clan: "cute" },
    twz: { player_id: 200, player_name: "qari99", player_clan: "TWZY" },
};

test("resolveIgn returns canonical spelling and null for unknown", async() => {
    const api = fakeApi(PLAYERS);
    assert.deepEqual(await resolveIgn(api, "nulping"), { playerId: 7610743, playerName: "NulPing", playerClan: "cute" });
    assert.equal(await resolveIgn(api, "NLPing"), null);
});

test("suggestIgns lists up to five names", async() => {
    const api = fakeApi(PLAYERS);
    assert.deepEqual(await suggestIgns(api, "nul"), ["NulPing"]);
});

test("linkPlayer stores, replaces own link, rejects a player id linked to another discord user", () => {
    const db = createClanDb(":memory:");
    assert.deepEqual(linkPlayer(db, { guildId: "g", discordId: "d1", playerId: 100, playerName: "Mungat0923", source: "verify", now: 1 }), { ok: true });
    const taken = linkPlayer(db, { guildId: "g", discordId: "d2", playerId: 100, playerName: "mungat0923", source: "verify", now: 2 });
    assert.deepEqual(taken, { ok: false, reason: "player_taken", discordId: "d1" });
    assert.deepEqual(linkPlayer(db, { guildId: "g", discordId: "d1", playerId: 200, playerName: "qari99", source: "admin", now: 3 }), { ok: true });
    assert.equal(getLinkByDiscord(db, "g", "d1").playerId, 200);
    assert.equal(getLinkByPlayer(db, "g", 100), null);
    assert.equal(getLinkByPlayer(db, "g", 200).discordId, "d1");
});

test("unlinkDiscord removes and reports", () => {
    const db = createClanDb(":memory:");
    linkPlayer(db, { guildId: "g", discordId: "d1", playerId: 1, playerName: "A", source: "verify", now: 1 });
    assert.equal(unlinkDiscord(db, "g", "d1"), true);
    assert.equal(unlinkDiscord(db, "g", "d1"), false);
    assert.equal(listLinks(db, "g").size, 0);
});

test("migrateQuickDb links resolvable names, reports the rest, keeps existing links", async() => {
    const db = createClanDb(":memory:");
    const api = fakeApi(PLAYERS);
    linkPlayer(db, { guildId: "g", discordId: "keep", playerId: 200, playerName: "qari99", source: "verify", now: 1 });
    const result = await migrateQuickDb(db, api, "g", [
        { discordId: "a", username: "nulping" },
        { discordId: "b", username: "NLPing" },
        { discordId: "c", username: "qari99" },
        { discordId: "keep", username: "whatever" },
    ]);
    assert.deepEqual(result.linked, [{ discordId: "a", playerId: 7610743, playerName: "NulPing", username: "nulping" }]);
    assert.deepEqual(result.unresolved, [{ discordId: "b", username: "NLPing" }]);
    assert.deepEqual(result.conflicts, [{ discordId: "c", username: "qari99", playerName: "qari99", takenBy: "keep" }]);
    assert.equal(getLinkByDiscord(db, "g", "keep").playerId, 200);
});
