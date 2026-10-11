import { test } from "node:test";
import assert from "node:assert/strict";
import { allClans, isMainGuild, clanForGuild, mainClan, clanTargetSize, clanGuildIds, SHARED_COMMANDS } from "../src/service/clan/clans.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

const CFG = {
    main_server: "998616013203574984",
    target_size: 100,
    clans: [
        { discord: "998616013203574984", id: "561461", name: "cute" },
        { discord: 1484220967889932469n.toString(), id: 565009, name: "TWZY", target_size: 50 },
    ],
};

test("clans resolve by guild with normalised ids", () => {
    assert.deepEqual(allClans(CFG).map(c => [c.discord, c.id, c.name]), [["998616013203574984", 561461, "cute"], ["1484220967889932469", 565009, "TWZY"]]);
    assert.equal(clanForGuild("1484220967889932469", CFG)?.name, "TWZY");
    assert.equal(clanForGuild("1", CFG), null);
    assert.equal(mainClan(CFG)?.name, "cute");
    assert.deepEqual(clanGuildIds(CFG), ["998616013203574984", "1484220967889932469"]);
});

test("main guild detection falls back to single-server mode without a main server", () => {
    assert.equal(isMainGuild("998616013203574984", CFG), true);
    assert.equal(isMainGuild("1484220967889932469", CFG), false);
    assert.equal(isMainGuild("anything", { clans: [] }), true);
    assert.equal(mainClan({ clans: [] }), null);
});

test("target size can be overridden per clan", () => {
    const [cute, twzy] = allClans(CFG);
    assert.equal(clanTargetSize(cute, CFG), 100);
    assert.equal(clanTargetSize(twzy, CFG), 50);
});

test("shared commands are the review and evaluate commands plus help and info", () => {
    assert.deepEqual([...SHARED_COMMANDS], ["clan-review", "clan-evaluate", "help", "info"]);
});
