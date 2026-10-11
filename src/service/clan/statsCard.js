import { config } from "../../../config/config.js";
import { levelFromScore, TURF_EPOCH_UTC } from "./krunkerApi.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

/**
 * Public profile page of a player
 *
 * @param {string} playerName
 * @return {string}
 */
export const profileUrl = function(playerName){
    return `https://krunker.io/social.html?p=profile&q=${encodeURIComponent(playerName)}`;
};

/**
 * @param {number} n
 * @return {string}
 */
export const num = n => Math.round(Number(n) || 0).toLocaleString("en-US");

/**
 * @param {number} part
 * @param {number} whole
 * @return {string}
 */
const pct = (part, whole) => `${Math.round(100 * (Number(part) || 0) / Math.max(Number(whole) || 0, 1))}%`;

/**
 * Stats lines for a player card (applications, evaluations)
 *
 * @param {any} profile
 * @return {string}
 */
export const statsText = function(profile){
    if (!profile) return "stats unavailable";
    const st = profile.player_stats ?? {};
    const kills = Number(profile.player_kills) || 0;
    const deaths = Number(profile.player_deaths) || 0;
    const games = Number(profile.player_games_played) || 0;
    const wins = Number(profile.player_wins) || 0;
    const inOtherClan = profile.player_clan && profile.player_clan !== config.clan.name;
    return [
        `Level **${levelFromScore(profile.player_score)}** · KDR **${(kills / Math.max(deaths, 1)).toFixed(2)}** · KPG **${(kills / Math.max(games, 1)).toFixed(1)}** · W/L **${(wins / Math.max(games - wins, 1)).toFixed(2)}**`,
        `Kills **${num(kills)}** · Deaths **${num(deaths)}** · Wins **${num(wins)}** · Games **${num(games)}** · Hours **${num((Number(profile.player_timeplayed) || 0) / 3600000)}**`,
        `Nukes **${num(st.n)}** · Headshots **${pct(st.hs, kills)}** · Accuracy **${pct(st.h, st.s)}** · Ranked **${Number(profile.ranked_rank) || 0 ? profile.ranked_rank : "unranked"}**`,
        `Since **${String(profile.player_datenew ?? "").slice(0, 10) || "?"}** · ${profile.online ? "🟢 online" : "⚫ offline"} · Clan **${profile.player_clan ? `[${profile.player_clan}]` : "none"}**${inOtherClan ? " ⚠️ already in a clan" : ""}`,
    ].join("\n");
};

/**
 * Turf season line for a player card
 *
 * @param {any} turf result of getTurfPlayer, or null
 * @return {string}
 */
export const turfText = function(turf){
    if (!turf || !(Number(turf.total_games) > 0)) return "no turf games this season";
    const kills = Number(turf.total_kills) || 0;
    const deaths = Number(turf.total_deaths) || 0;
    const lastDay = Number(turf.last_day);
    const lastPlayed = Number.isFinite(lastDay) ? new Date(TURF_EPOCH_UTC + lastDay * 86400000).toISOString().slice(0, 10) : "?";
    return `Kills **${num(kills)}** · Deaths **${num(deaths)}** · K/D **${(kills / Math.max(deaths, 1)).toFixed(2)}** · Games **${num(turf.total_games)}** · KR **${num(turf.total_kr)}** · Last played **${lastPlayed}**`;
};
