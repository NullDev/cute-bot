import { test } from "node:test";
import assert from "node:assert/strict";
import {
    DEFAULT_TURF, mergeStandings, assessTurf, headline, mapLine, alertText, decideTurfPosts, composeTurfReport, timeLeftText, actionNeeded,
} from "../src/service/clan/turfWatch.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

// live standings captured 2026-10-11 21:58 UTC
const STATUS = [
    { map_id: 0, map_name: "Burg", leaderboard: [
        { position: 1, clan_name: "TWZY", kills: 2244 }, { position: 2, clan_name: "cute", kills: 1101 }, { position: 3, clan_name: "SIBU", kills: 829 },
        { position: 4, clan_name: "keef", kills: 537 }, { position: 5, clan_name: "StaZ", kills: 488 },
    ] },
    { map_id: 2, map_name: "Sandstorm", leaderboard: [
        { position: 1, clan_name: "TWZY", kills: 6959 }, { position: 2, clan_name: "cute", kills: 2958 }, { position: 3, clan_name: "SIBU", kills: 2762 },
        { position: 4, clan_name: "StaZ", kills: 1653 }, { position: 5, clan_name: "keef", kills: 1217 },
    ] },
    { map_id: 3, map_name: "Subzero", leaderboard: [
        { position: 1, clan_name: "TWZY", kills: 5739 }, { position: 2, clan_name: "cute", kills: 2645 }, { position: 3, clan_name: "SIBU", kills: 2528 },
        { position: 4, clan_name: "StaZ", kills: 1376 }, { position: 5, clan_name: "Feed", kills: 962 },
    ] },
];
const OURS = [
    { map_id: 0, map_name: "Burg", kills: 1101, position: 2 },
    { map_id: 2, map_name: "Sandstorm", kills: 2958, position: 2 },
    { map_id: 3, map_name: "Subzero", kills: 2645, position: 2 },
];
const CFG = { ...DEFAULT_TURF };

const standings = () => mergeStandings(STATUS, OURS, "cute", CFG.hold_position);

test("mergeStandings finds the clans above and below us per map", () => {
    const s = standings();
    assert.equal(s.length, 3);
    assert.deepEqual(s[0].above, { name: "TWZY", kills: 2244, position: 1 });
    assert.deepEqual(s[0].below, { name: "SIBU", kills: 829, position: 3 });
    assert.equal(s[0].holdLine, null);
});

test("assessTurf marks safe and close maps from the lead over the chaser", () => {
    const a = assessTurf(standings(), { hold_position: 2, close_margin: 100 });
    assert.deepEqual(a.map(m => [m.mapName, m.state, m.lead, m.chaser]), [["Burg", "safe", 272, "SIBU"], ["Sandstorm", "safe", 196, "SIBU"], ["Subzero", "safe", 117, "SIBU"]]);
    const tight = assessTurf(standings(), { hold_position: 2, close_margin: 150 });
    assert.equal(tight[2].state, "close");
    assert.equal(actionNeeded(a), false);
    assert.equal(actionNeeded(tight), true);
});

test("a map where we sit below the hold position is lost with the deficit to the hold line", () => {
    const status = [{ map_id: 0, map_name: "Burg", leaderboard: [
        { position: 1, clan_name: "TWZY", kills: 2000 }, { position: 2, clan_name: "SIBU", kills: 900 }, { position: 3, clan_name: "keef", kills: 700 }, { position: 4, clan_name: "cute", kills: 600 },
    ] }];
    const a = assessTurf(mergeStandings(status, [{ map_id: 0, map_name: "Burg", kills: 600, position: 4 }], "cute", 2), CFG);
    assert.equal(a[0].state, "lost");
    assert.equal(a[0].deficit, 301);
    assert.equal(a[0].target, "SIBU");
    assert.match(mapLine(a[0], CFG), /#4 with 600 kills, 301 more kills needed to pass SIBU for #2/);
});

test("outside the top five we still get our own kills and the hold line from the board", () => {
    const status = [{ map_id: 0, map_name: "Burg", leaderboard: [
        { position: 1, clan_name: "TWZY", kills: 2000 }, { position: 2, clan_name: "SIBU", kills: 900 }, { position: 3, clan_name: "keef", kills: 700 },
        { position: 4, clan_name: "StaZ", kills: 650 }, { position: 5, clan_name: "Feed", kills: 620 },
    ] }];
    const a = assessTurf(mergeStandings(status, [{ map_id: 0, map_name: "Burg", kills: 100, position: 9 }], "cute", 2), CFG);
    assert.equal(a[0].position, 9);
    assert.equal(a[0].deficit, 801);
    const none = assessTurf(mergeStandings(status, [], "cute", 2), CFG);
    assert.equal(none[0].state, "none");
});

test("headline wording for the four situations", () => {
    const safe = assessTurf(standings(), CFG);
    assert.equal(headline(safe, CFG), "We are steadily holding turf on all three maps :3");

    const close = assessTurf(standings(), { hold_position: 2, close_margin: 150 });
    assert.equal(headline(close, CFG), "⚠️ SIBU is only 117 kills away from taking our second place on Subzero.");

    const mixed = safe.map(m => (m.mapName === "Sandstorm" ? { ...m, state: "lost", position: 3, lead: null, chaser: null, deficit: 86, target: "SIBU" } : m));
    assert.equal(headline(mixed, CFG), "We are holding Burg and Subzero but not Sandstorm: SIBU is 85 kills ahead of us for #2 on Sandstorm.");

    const none = safe.map(m => ({ ...m, state: "lost", position: 4, lead: null, chaser: null, deficit: 120, target: "SIBU" }));
    assert.match(headline(none, CFG), /^🚨 We are not holding any map right now\. Burg needs 120 more kills to pass SIBU/);

    const first = { ...safe[0], position: 1, state: "close", lead: 40, chaser: "TWZY" };
    assert.equal(headline([first], CFG), "⚠️ TWZY is only 40 kills behind us on Burg, our first place is at risk.");
});

test("alerts fire on meaningful transitions only", () => {
    const safe = assessTurf(standings(), CFG);
    const close = { ...safe[2], state: "close", lead: 21, chaser: "SIBU" };
    assert.equal(alertText(close, "safe", CFG), "⚠️ SIBU is only 21 kills away from taking our second place on Subzero!");
    const lost = { ...safe[1], state: "lost", position: 3, lead: null, chaser: null, deficit: 86, target: "SIBU" };
    assert.match(alertText(lost, "close", CFG), /^🚨 We lost our spot on Sandstorm, we are #3 now\. SIBU is 85 kills ahead, we need 86 more to take #2 back\./);
    assert.match(alertText(safe[1], "lost", CFG), /^✅ We are back on Sandstorm: #2 with 2,958 kills, 196 ahead of SIBU\./);
    assert.equal(alertText(safe[1], "close", CFG), null, "going from close back to safe is not news");
});

test("decideTurfPosts reports at the configured hours once and alerts once per map and state", () => {
    const safe = assessTurf(standings(), CFG);
    const at = (/** @type {number} */ h) => new Date(Date.UTC(2026, 9, 11, h, 5));
    const quiet = decideTurfPosts({ maps: safe, previous: {}, posted: new Set(), now: at(10), cfg: CFG });
    assert.deepEqual(quiet, { report: false, alerts: [], keys: [] });

    const report = decideTurfPosts({ maps: safe, previous: {}, posted: new Set(), now: at(18), cfg: CFG });
    assert.equal(report.report, true);
    assert.deepEqual(report.keys, ["report:18"]);
    const again = decideTurfPosts({ maps: safe, previous: {}, posted: new Set(["report:18"]), now: at(18), cfg: CFG });
    assert.equal(again.report, false);

    const close = safe.map(m => (m.mapName === "Subzero" ? { ...m, state: "close", lead: 21 } : m));
    const alert = decideTurfPosts({ maps: close, previous: { 3: "safe" }, posted: new Set(), now: at(10), cfg: CFG });
    assert.equal(alert.alerts.length, 1);
    assert.deepEqual(alert.keys, ["alert:3:close"]);
    const dup = decideTurfPosts({ maps: close, previous: { 3: "safe" }, posted: new Set(["alert:3:close"]), now: at(10), cfg: CFG });
    assert.equal(dup.alerts.length, 0);
    const unchanged = decideTurfPosts({ maps: close, previous: { 3: "close" }, posted: new Set(), now: at(10), cfg: CFG });
    assert.equal(unchanged.alerts.length, 0);
});

test("the report carries the map lines and the time left", () => {
    const safe = assessTurf(standings(), CFG);
    const now = new Date(Date.UTC(2026, 9, 11, 21, 50));
    assert.equal(timeLeftText(now), "2h 10m");
    const { content, embed, needed } = composeTurfReport(safe, CFG, now);
    assert.equal(needed, false);
    assert.equal(content, "We are steadily holding turf on all three maps :3");
    const desc = embed.toJSON().description ?? "";
    assert.ok(desc.includes("**Burg**: #2 with 1,101 kills, 272 ahead of SIBU"), desc);
    assert.ok(desc.includes("⏳ 2h 10m until the turf day ends"), desc);
});
