import { test } from "node:test";
import assert from "node:assert/strict";
import { rolesForRank, computeDiff } from "../src/service/clan/sync.js";
import { RANK } from "../src/service/clan/roster.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

const IDS = { recruit: "R", soldier: "S", captain: "C" };

test("rolesForRank is cumulative", () => {
    assert.deepEqual(rolesForRank(RANK.RECRUIT, IDS), ["R"]);
    assert.deepEqual(rolesForRank(RANK.SOLDIER, IDS), ["R", "S"]);
    assert.deepEqual(rolesForRank(RANK.CAPTAIN, IDS), ["R", "S", "C"]);
    assert.deepEqual(rolesForRank(RANK.COMMANDER, IDS), ["R", "S", "C"]);
});

test("computeDiff adds missing, removes extra, strips unlinked, keeps other roles alone", () => {
    const diff = computeDiff({
        members: [
            { discordId: "soldier", roleIds: ["R", "X"] },
            { discordId: "demoted", roleIds: ["R", "S", "C"] },
            { discordId: "left", roleIds: ["R"] },
            { discordId: "unlinked", roleIds: ["R", "S"] },
            { discordId: "nothing", roleIds: ["X"] },
        ],
        links: new Map([["soldier", { playerId: 1 }], ["demoted", { playerId: 2 }], ["left", { playerId: 3 }]]),
        roster: new Map([[1, { rank: RANK.SOLDIER }], [2, { rank: RANK.RECRUIT }]]),
        exempt: new Set(),
        roleIds: IDS,
    });
    assert.deepEqual(diff.add, [{ discordId: "soldier", roleIds: ["S"] }]);
    assert.deepEqual(diff.remove, [
        { discordId: "demoted", roleIds: ["S", "C"] },
        { discordId: "left", roleIds: ["R"] },
        { discordId: "unlinked", roleIds: ["R", "S"] },
    ]);
    assert.deepEqual(diff.unlinkedWithRoles, ["unlinked"]);
});

test("computeDiff keeps recruit for exempt accepted applicants", () => {
    const diff = computeDiff({
        members: [{ discordId: "a", roleIds: [] }, { discordId: "b", roleIds: ["R", "S"] }],
        links: new Map([["a", { playerId: 1 }], ["b", { playerId: 2 }]]),
        roster: new Map([[9, { rank: 0 }]]),
        exempt: new Set(["a", "b"]),
        roleIds: IDS,
    });
    assert.deepEqual(diff.add, [{ discordId: "a", roleIds: ["R"] }]);
    assert.deepEqual(diff.remove, [{ discordId: "b", roleIds: ["S"] }]);
});

test("computeDiff ignores links whose member is gone", () => {
    const diff = computeDiff({
        members: [],
        links: new Map([["gone", { playerId: 1 }]]),
        roster: new Map([[1, { rank: 0 }]]),
        exempt: new Set(),
        roleIds: IDS,
    });
    assert.deepEqual(diff, { add: [], remove: [], unlinkedWithRoles: [] });
});

test("computeDiff refuses an empty roster", () => {
    assert.throws(() => computeDiff({ members: [], links: new Map(), roster: new Map(), exempt: new Set(), roleIds: IDS }), /empty/);
});
