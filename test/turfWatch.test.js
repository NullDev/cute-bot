import { test } from "node:test";
import assert from "node:assert/strict";
import {
    DEFAULT_TURF, mergeStandings, assessTurf, headline, mapLine, alertText, decideTurfPosts, composeTurfReport, timeLeftText, actionNeeded, ping, outOfReach,
} from "../src/service/clan/turfWatch.js";
import { config } from "../config/config.js";

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
// the fixtures were written against a 100 kill margin; the shipped default is 150
const CFG = { ...DEFAULT_TURF, close_margin: 100 };

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
    assert.match(mapLine(a[0], CFG), /#4 with 600 kills, 300 behind SIBU for #2/);
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
    assert.equal(headline(safe, CFG), "We are steadily holding #2 on Burg, Sandstorm and Subzero :3");

    const close = assessTurf(standings(), { hold_position: 2, close_margin: 150 });
    assert.equal(headline(close, CFG), "⚠️ SIBU is only 117 kills away from taking our second place on Subzero.");

    const mixed = safe.map(m => (m.mapName === "Sandstorm" ? { ...m, state: "lost", position: 3, lead: null, chaser: null, deficit: 86, target: "SIBU" } : m));
    assert.equal(headline(mixed, CFG), "We are holding #2 on Burg and Subzero, but only #3 on Sandstorm. SIBU is 85 kills ahead of us for #2 on Sandstorm.");

    const none = safe.map(m => ({ ...m, state: "lost", position: 4, lead: null, chaser: null, deficit: 120, target: "SIBU" }));
    assert.equal(headline(none, CFG), "🚨 We are not holding #2 on any map right now.\n• SIBU is 119 kills ahead of us for #2 on Burg\n• SIBU is 119 kills ahead of us for #2 on Sandstorm\n• SIBU is 119 kills ahead of us for #2 on Subzero");

    const mixedPlaces = [{ ...safe[0], position: 1 }, safe[1], { ...safe[2], state: "none", position: null, kills: 0, lead: null, chaser: null }];
    assert.equal(headline(mixedPlaces, CFG), "We are holding #1 on Burg and #2 on Sandstorm, but no kills on Subzero. Subzero has no kills from us yet.");

    const allClose = assessTurf(standings(), { hold_position: 2, close_margin: 400 });
    assert.equal(headline(allClose, CFG), "⚠️ Our spots are under pressure:\n• SIBU is only 272 kills away from taking our second place on Burg\n• SIBU is only 196 kills away from taking our second place on Sandstorm\n• SIBU is only 117 kills away from taking our second place on Subzero");

    const first = { ...safe[0], position: 1, state: "close", lead: 40, chaser: "TWZY" };
    assert.equal(headline([first], CFG), "⚠️ TWZY is only 40 kills behind us on Burg, our first place is at risk.");
});

test("alerts fire on meaningful transitions only", () => {
    const safe = assessTurf(standings(), CFG);
    const close = { ...safe[2], state: "close", lead: 21, chaser: "SIBU" };
    assert.equal(alertText(close, "safe", CFG), "⚠️ SIBU is only 21 kills away from taking our second place on Subzero!");
    const lost = { ...safe[1], state: "lost", position: 3, lead: null, chaser: null, deficit: 86, target: "SIBU" };
    assert.match(alertText(lost, "close", CFG), /^🚨 We lost #2 on Sandstorm, we are #3 now\. SIBU is 85 kills ahead for #2\./);
    assert.match(alertText(safe[1], "lost", CFG), /^✅ We are back to #2 on Sandstorm with 2,958 kills, 196 ahead of SIBU\./);
    assert.equal(alertText(safe[1], "close", CFG), null, "going from close back to safe is not news");
});

test("decideTurfPosts reports at the configured hours once and alerts once per map and state", () => {
    const safe = assessTurf(standings(), CFG);
    const at = (/** @type {number} */ h) => new Date(Date.UTC(2026, 9, 11, h, 5));
    const quiet = decideTurfPosts({ maps: safe, previous: {}, posted: new Set(), now: at(17), cfg: CFG });
    assert.deepEqual(quiet, { report: false, alerts: [], keys: [] });

    const report = decideTurfPosts({ maps: safe, previous: {}, posted: new Set(), now: at(18), cfg: CFG });
    assert.equal(report.report, true);
    assert.deepEqual(report.keys, ["report:18"]);
    const again = decideTurfPosts({ maps: safe, previous: {}, posted: new Set(["report:18"]), now: at(18), cfg: CFG });
    assert.equal(again.report, false);

    const close = safe.map(m => (m.mapName === "Subzero" ? { ...m, state: "close", lead: 21 } : m));
    const alert = decideTurfPosts({ maps: close, previous: { 3: "safe" }, posted: new Set(), now: at(19), cfg: CFG });
    assert.equal(alert.alerts.length, 1);
    assert.equal(alert.alerts[0].needed, true);
    assert.deepEqual(alert.keys, ["alert:3:close"]);
    const dup = decideTurfPosts({ maps: close, previous: { 3: "safe" }, posted: new Set(["alert:3:close"]), now: at(19), cfg: CFG });
    assert.equal(dup.alerts.length, 0);
    const unchanged = decideTurfPosts({ maps: close, previous: { 3: "close" }, posted: new Set(), now: at(19), cfg: CFG });
    assert.equal(unchanged.alerts.length, 0);

    // the quiet period swallows everything, even changes and report hours
    const early = decideTurfPosts({ maps: close, previous: { 3: "safe" }, posted: new Set(), now: at(2), cfg: { ...CFG, report_hours_utc: [2] } });
    assert.deepEqual(early, { report: false, alerts: [], keys: [] });

    // a recovery alone needs nobody
    const back = decideTurfPosts({ maps: safe, previous: { 2: "lost" }, posted: new Set(), now: at(19), cfg: CFG });
    assert.equal(back.alerts.length, 1);
    assert.equal(back.alerts[0].needed, false);
});

test("the report carries the map lines and the time left", () => {
    const safe = assessTurf(standings(), CFG);
    const now = new Date(Date.UTC(2026, 9, 11, 21, 50));
    assert.equal(timeLeftText(now), "2h 10m");
    const { content, embed, needed } = composeTurfReport(safe, CFG, now);
    assert.equal(needed, false);
    assert.equal(content, "We are steadily holding #2 on Burg, Sandstorm and Subzero :3");
    const desc = embed.toJSON().description ?? "";
    assert.ok(desc.includes("**Burg**: #2 with 1,101 kills, 272 ahead of SIBU"), desc);
    assert.ok(desc.includes("⏳ 2h 10m until the turf day ends"), desc);
});

test("role pings stop after the daily budget", () => {
    const saved = config.ids.clan.turf_role;
    config.ids.clan.turf_role = "role1";
    try {
        const cfg = { ...DEFAULT_TURF, max_pings_per_day: 2 };
        assert.equal(ping(false, { pingsToday: 0, cfg }), "", "nothing needed, no ping");
        assert.equal(ping(true, { pingsToday: 0, cfg }), "<@&role1> ");
        assert.equal(ping(true, { pingsToday: 1, cfg }), "<@&role1> ");
        assert.equal(ping(true, { pingsToday: 2, cfg }), "", "budget spent");
        const tight = assessTurf(standings(), { hold_position: 2, close_margin: 400 });
        assert.equal(composeTurfReport(tight, cfg, new Date(), 2).pinged, false);
        assert.equal(composeTurfReport(tight, cfg, new Date(), 0).pinged, true);
    }
    finally {
        config.ids.clan.turf_role = saved;
    }
});

test("the shipped close margin is 150 kills", () => {
    assert.equal(DEFAULT_TURF.close_margin, 150);
    const a = assessTurf(standings(), DEFAULT_TURF);
    assert.deepEqual(a.map(m => m.state), ["safe", "safe", "close"]);
});

test("hopeless lost maps are out of reach and do not count as action needed", () => {
    const safe = assessTurf(standings(), CFG);
    const hopeless = { ...safe[0], state: "lost", position: 4, lead: null, chaser: null, deficit: 2500, target: "SIBU" };
    const reachable = { ...safe[0], state: "lost", position: 3, lead: null, chaser: null, deficit: 200, target: "SIBU" };
    assert.equal(outOfReach(hopeless, CFG), true);
    assert.equal(outOfReach(reachable, CFG), false);
    assert.equal(actionNeeded([safe[1], safe[2], hopeless], CFG), false);
    assert.equal(actionNeeded([safe[1], safe[2], reachable], CFG), true);
    assert.match(mapLine(hopeless, CFG), /out of reach today/);
});

test("the shipped schedule is quiet until 16:00 UTC with reports at 18 and 22 and three pings", () => {
    assert.equal(DEFAULT_TURF.quiet_until_hour_utc, 16);
    assert.deepEqual(DEFAULT_TURF.report_hours_utc, [18, 22]);
    assert.equal(DEFAULT_TURF.max_pings_per_day, 3);
});

