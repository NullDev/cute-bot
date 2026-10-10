import { test } from "node:test";
import assert from "node:assert/strict";
import { createClanDb } from "../src/service/clan/db.js";
import { rememberName } from "../src/service/clan/identity.js";
import { fetchRoster, rosterByPlayerId, RANK } from "../src/service/clan/roster.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

const CLAN = {
    clan_id: 561461,
    clan_name: "cute",
    creator_name: "NulPing",
    members: [
        { p: "NulPing", s: 19450609, r: 0, h: 0, s7: 306910 },
        { p: "Tira_Mitsu", s: 14146064, r: 2, h: 0, s7: 500964 },
        { p: "영구기♥동혀니", s: 10, r: 0, h: 0, s7: 0 },
        { p: "Ghost", s: 5, r: 0, h: 1, s7: 0 },
    ],
};

const fakeApi = function(){
    const calls = [];
    return {
        calls,
        getClan: async() => CLAN,
        getPlayer: async name => {
            calls.push(name);
            if (name === "NulPing") return { player_id: 7610743, player_name: "NulPing" };
            if (name === "영구기♥동혀니") throw new Error("boom");
            if (name === "Ghost") return null;
            return null;
        },
    };
};

test("fetchRoster resolves ids, marks the owner as commander, skips unresolvable names", async() => {
    const db = createClanDb(":memory:");
    rememberName(db, 5, "Tira_Mitsu", 1);
    const api = fakeApi();
    const roster = await fetchRoster(db, api, { clanName: "cute", now: 2 });
    assert.equal(roster.clanId, 561461);
    assert.deepEqual(roster.members.map(m => [m.playerId, m.rank]), [[7610743, RANK.COMMANDER], [5, RANK.CAPTAIN]]);
    assert.deepEqual(roster.unresolved, ["영구기♥동혀니", "Ghost"]);
    assert.deepEqual(api.calls, ["NulPing", "영구기♥동혀니", "Ghost"]);
    assert.equal(db.prepare("select player_id from player_names where player_name = 'NulPing'").get().player_id, 7610743);
});

test("fetchRoster uses the name cache without calling the api", async() => {
    const db = createClanDb(":memory:");
    rememberName(db, 7610743, "nulping", 1);
    rememberName(db, 5, "Tira_Mitsu", 1);
    rememberName(db, 6, "영구기♥동혀니", 1);
    rememberName(db, 8, "Ghost", 1);
    const api = fakeApi();
    const roster = await fetchRoster(db, api, { clanName: "cute", now: 2 });
    assert.equal(roster.members.length, 4);
    assert.deepEqual(api.calls, []);
    assert.equal(roster.members[3].hacker, true);
});

test("fetchRoster throws on an empty clan", async() => {
    const db = createClanDb(":memory:");
    const api = { getClan: async() => ({ clan_id: 1, clan_name: "x", members: [] }), getPlayer: async() => null };
    await assert.rejects(() => fetchRoster(db, api, { clanName: "x" }), /empty/);
});

test("rosterByPlayerId indexes members", async() => {
    const map = rosterByPlayerId({ members: [{ playerId: 1, rank: 0 }, { playerId: 2, rank: 1 }] });
    assert.equal(map.get(2).rank, 1);
});
