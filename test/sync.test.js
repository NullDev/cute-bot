import { test } from "node:test";
import assert from "node:assert/strict";
import { Collection } from "discord.js";
import { rolesForRank, computeDiff, capField, guardRemovals, buildSyncEmbed, hasClanRoleIds, runClanSync } from "../src/service/clan/sync.js";
import { RANK } from "../src/service/clan/roster.js";
import { createClanDb } from "../src/service/clan/db.js";
import { config } from "../config/config.js";

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

test("computeDiff gives accepted applicants nothing until the roster shows them", () => {
    const diff = computeDiff({
        members: [{ discordId: "a", roleIds: [] }, { discordId: "b", roleIds: ["R", "S"] }],
        links: new Map([["a", { playerId: 1 }], ["b", { playerId: 2 }]]),
        roster: new Map([[9, { rank: 0 }]]),
        roleIds: IDS,
    });
    assert.deepEqual(diff.add, []);
    assert.deepEqual(diff.remove, [{ discordId: "b", roleIds: ["R", "S"] }]);
});

test("computeDiff ignores links whose member is gone", () => {
    const diff = computeDiff({
        members: [],
        links: new Map([["gone", { playerId: 1 }]]),
        roster: new Map([[1, { rank: 0 }]]),
        roleIds: IDS,
    });
    assert.deepEqual(diff, { add: [], remove: [], unlinkedWithRoles: [] });
});

test("computeDiff refuses an empty roster", () => {
    assert.throws(() => computeDiff({ members: [], links: new Map(), roster: new Map(), roleIds: IDS }), /empty/);
});

test("capField leaves short text and cuts long text on a line boundary", () => {
    assert.equal(capField("short"), "short");
    const long = Array.from({ length: 300 }, (_, i) => `line-${i}-xxxxxxxx`).join("\n");
    assert.equal(long.length > 3000, true);
    const capped = capField(long);
    assert.equal(capped.length <= 1000, true);
    assert.equal(capped.endsWith("\n..."), true);
    assert.equal(long.startsWith(capped.slice(0, -4)), true);
    assert.equal(long[capped.length - 4], "\n");
    assert.equal(capField("x".repeat(3000)).length <= 1000, true);
});

test("buildSyncEmbed keeps fields within limits and attaches full text only when cut", () => {
    const entry = (/** @type {number} */ i) => ({ discordId: String(100000000000000000 + i), roleIds: ["111111111111111111", "222222222222222222", "333333333333333333"] });
    const big = { add: Array.from({ length: 200 }, (_, i) => entry(i)), remove: Array.from({ length: 200 }, (_, i) => entry(i + 500)), unlinkedWithRoles: [] };
    const roster = { members: [], unresolved: [] };
    const out = buildSyncEmbed({ diff: big, result: null, dryRun: true, roster: /** @type {any} */ (roster) });
    for (const f of out.embed.data.fields ?? []) assert.equal(f.value.length <= 1024, true);
    assert.equal(out.files.length, 1);

    const small = buildSyncEmbed({ diff: { add: big.add.slice(0, 2), remove: [], unlinkedWithRoles: [] }, result: null, dryRun: true, roster: /** @type {any} */ (roster) });
    assert.equal(small.files.length, 0);
});

test("guardRemovals holds back removals when names are unresolved unless forced", () => {
    const diff = { add: [{ discordId: "a", roleIds: ["R"] }], remove: [{ discordId: "b", roleIds: ["S"] }], unlinkedWithRoles: [] };
    const held = guardRemovals(diff, { unresolved: ["x"] }, false);
    assert.deepEqual(held.diff.remove, []);
    assert.deepEqual(held.diff.add, diff.add);
    assert.deepEqual(held.skippedRemovals, diff.remove);

    const forced = guardRemovals(diff, { unresolved: ["x"] }, true);
    assert.deepEqual(forced.diff, diff);
    assert.deepEqual(forced.skippedRemovals, []);

    const clean = guardRemovals(diff, { unresolved: [] }, false);
    assert.deepEqual(clean.diff, diff);
    assert.deepEqual(clean.skippedRemovals, []);
});

test("hasClanRoleIds needs all three ids non-empty", () => {
    assert.equal(hasClanRoleIds({ recruit: "1", soldier: "2", captain: "3" }), true);
    assert.equal(hasClanRoleIds({ recruit: "", soldier: "2", captain: "3" }), false);
    assert.equal(hasClanRoleIds({ recruit: "1", soldier: "2", captain: "" }), false);
    assert.equal(hasClanRoleIds({ recruit: "1", soldier: "2" }), false);
    assert.equal(hasClanRoleIds(undefined), false);
});

test("buildSyncEmbed attaches the full text when removals were held back", () => {
    const roster = { members: [{}], unresolved: ["a"] };
    const diff = { add: [], remove: [], unlinkedWithRoles: [] };
    const skipped = [1, 2, 3].map(n => ({ discordId: `u${n}`, roleIds: ["R"] }));
    assert.equal(buildSyncEmbed({ diff, result: null, dryRun: true, roster, skippedRemovals: skipped }).files.length, 1);
    assert.equal(buildSyncEmbed({ diff, result: null, dryRun: true, roster }).files.length, 0);
});

test("runClanSync uses a roster handed in instead of fetching one", async() => {
    const saved = { clan: config.clan.clans, main: config.clan.main_server, ids: { ...config.ids.clan } };
    config.clan.main_server = "g1";
    config.clan.clans = [{ discord: "g1", name: "cute", id: 1 }];
    Object.assign(config.ids.clan, IDS);
    try {
        const db = createClanDb(":memory:");
        const guild = {
            members: { fetch: async() => new Collection([["u1", { id: "u1", user: { bot: false }, roles: { cache: new Collection() } }]]) },
            channels: { fetch: async() => null },
        };
        const client = /** @type {any} */ ({ guilds: { fetch: async() => guild } });
        const krunker = /** @type {any} */ ({ getClan: async() => { throw new Error("must not fetch"); } });
        const roster = { clanId: 1, clanName: "cute", members: [{ playerId: 1, playerName: "V", rank: 0, score: 0, s7: 0, hacker: false }], unresolved: [] };

        await assert.rejects(() => runClanSync(client, "g1", { dryRun: true, db, krunker }), /must not fetch/);
        const { diff, result } = await runClanSync(client, "g1", { dryRun: true, db, krunker, roster });
        assert.deepEqual(diff, { add: [], remove: [], unlinkedWithRoles: [] });
        assert.equal(result, null);
    }
    finally {
        config.clan.clans = saved.clan;
        config.clan.main_server = saved.main;
        Object.assign(config.ids.clan, saved.ids);
    }
});
