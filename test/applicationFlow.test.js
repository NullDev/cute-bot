import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApplicationEmbed, decisionComponents, profileUrl, interviewChannelName, interviewOverwrites } from "../src/service/clan/applicationFlow.js";
import { PermissionFlagsBits } from "discord.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

const APP = {
    id: 7, guildId: "g", discordId: "d", playerId: 7610743, playerName: "NulPing",
    answers: { ign: "NulPing", modeRegion: "Turf, EU", why: "cute", duel: "yes", extra: "" },
    status: "pending", channelId: null, messageId: null, reviewerId: null, reason: null,
    createdAt: 1760000000000, decidedAt: null, joinedAt: null, remindedAt: null,
};

const PROFILE = {
    player_id: 7610743, player_name: "NulPing", player_clan: "TWZY", player_score: 19450609,
    player_kills: 159522, player_deaths: 117807, player_wins: 4835, player_games_played: 15613,
    player_timeplayed: 2164119300, player_datenew: "2019-11-14 09:07:10", ranked_rank: 3, online: 1,
    player_stats: { n: 16, hs: 77870, h: 226346, s: 536028 },
};

const TURF = { player_id: 7610743, total_kills: 12846, total_deaths: 5450, total_games: 1195, kd: 2.357, total_kr: 3848, first_day: 1, last_day: 207 };

test("profileUrl points at the public social profile", () => {
    assert.equal(profileUrl("YA BOI ALI-A"), "https://krunker.io/social.html?p=profile&q=YA%20BOI%20ALI-A");
});

test("application embed links the profile and shows the extended stats", () => {
    const embed = buildApplicationEmbed(APP, PROFILE, null, TURF).toJSON();
    assert.equal(embed.url, profileUrl("NulPing"));
    const stats = embed.fields.find(f => f.name === "Stats")?.value ?? "";
    for (const expected of ["Level **132**", "KDR **1.35**", "KPG **10.2**", "W/L **0.45**", "Kills **159,522**", "Games **15,613**", "Hours **601**", "Nukes **16**", "Headshots **49%**", "Accuracy **42%**", "Ranked **3**", "Since **2019-11-14**", "Clan **[TWZY]**", "already in a clan"]){
        assert.ok(stats.includes(expected), `stats should contain ${expected}, got:\n${stats}`);
    }
    const turf = embed.fields.find(f => f.name === "Turf (this season)")?.value ?? "";
    for (const expected of ["Kills **12,846**", "K/D **2.36**", "Games **1,195**", "KR **3,848**", "Last played **2026-10-10**"]){
        assert.ok(turf.includes(expected), `turf should contain ${expected}, got:\n${turf}`);
    }
});

test("application embed copes with no profile and no turf data", () => {
    const embed = buildApplicationEmbed(APP, null, null, null).toJSON();
    assert.equal(embed.fields.find(f => f.name === "Stats")?.value, "stats unavailable");
    assert.equal(embed.fields.find(f => f.name === "Turf (this season)")?.value, "no turf games this season");
});

test("decision row carries a profile link button next to Accept and Reject", () => {
    const row = decisionComponents(7, false, profileUrl("NulPing")).toJSON();
    assert.deepEqual(row.components.map(c => c.label), ["Accept", "Reject", "Show Evaluation", "Start Interview", "Profile"]);
    assert.equal(row.components[2].custom_id, "application_eval:7");
    assert.equal(row.components[3].custom_id, "application_interview:7");
    assert.equal(row.components[4].url, profileUrl("NulPing"));
    assert.equal(row.components[4].disabled, undefined);
    const done = decisionComponents(7, true, profileUrl("NulPing")).toJSON();
    assert.deepEqual(done.components.slice(0, 2).map(c => c.disabled), [true, true]);
    assert.equal(done.components[2].disabled, undefined, "evaluation stays available after a decision");
});

test("interview channel names are discord-safe", () => {
    assert.equal(interviewChannelName(12, "YA BOI ALI-A"), "app-12-ya-boi-ali-a");
    assert.equal(interviewChannelName(3, "영구기♥동혀니"), "app-3");
    assert.ok(interviewChannelName(1, "x".repeat(200)).length <= 100);
});

test("interview overwrites hide the channel and open it to the applicant, the roles and the bot", () => {
    const ow = interviewOverwrites({ guildId: "g", applicantId: "a", botId: "b", roleIds: ["r1", "", "r2"] });
    assert.deepEqual(ow.map(o => o.id), ["g", "a", "b", "r1", "r2"]);
    assert.deepEqual(ow[0].deny, [PermissionFlagsBits.ViewChannel]);
    for (const o of ow.slice(1)){
        assert.ok(o.allow.includes(PermissionFlagsBits.ViewChannel));
        assert.ok(o.allow.includes(PermissionFlagsBits.SendMessages));
        assert.ok(o.allow.includes(PermissionFlagsBits.AttachFiles));
    }
    assert.ok(ow[2].allow.includes(PermissionFlagsBits.ManageChannels));
});

