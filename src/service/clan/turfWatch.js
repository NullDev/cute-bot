import { EmbedBuilder } from "discord.js";
import Log from "../../util/log.js";
import defaults from "../../util/defaults.js";
import { config } from "../../../config/config.js";
import { api, turfDay } from "./krunkerApi.js";
import { getClanDb } from "./db.js";
import { mainClan } from "./clans.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

export const DEFAULT_TURF = Object.freeze({
    check_minutes: 30,
    report_hours_utc: [12, 18, 21, 23],
    hold_position: 2,
    close_margin: 100,
    max_pings_per_day: 2,
});

/**
 * @typedef {Object} MapStanding
 * @property {number} mapId
 * @property {string} mapName
 * @property {number} kills our kills today
 * @property {number | null} position our position, null when we have no kills yet
 * @property {{ name: string, kills: number, position: number } | null} above the clan directly above us (null when we lead)
 * @property {{ name: string, kills: number, position: number } | null} below the clan directly below us (null when unknown or last)
 * @property {{ name: string, kills: number } | null} holdLine the clan that currently sits on the last held position, when we are below it
 */

/**
 * @typedef {Object} MapAssessment
 * @property {number} mapId
 * @property {string} mapName
 * @property {"safe" | "close" | "lost" | "none"} state none = no kills at all today
 * @property {number} kills
 * @property {number | null} position
 * @property {number | null} lead kills ahead of the clan below us (held maps)
 * @property {string | null} chaser name of the clan below us
 * @property {number | null} deficit kills needed to reach the hold position (lost maps)
 * @property {string | null} target name of the clan on the hold position we need to pass
 */

/**
 * Settings with config overrides
 *
 * @return {typeof DEFAULT_TURF}
 */
export const turfSettings = function(){
    return { ...DEFAULT_TURF, ...(config.clan.turf ?? {}) };
};

/**
 * Merge the public status (top 5 per map) with our own per-map numbers into one standing per map
 *
 * @param {Array<{ map_id: number, map_name: string, leaderboard: Array<{ position: number, clan_name: string, kills: number }> }>} status
 * @param {Array<{ map_id: number, map_name: string, kills: number, position: number }>} ours
 * @param {string} clanName
 * @param {number} holdPosition
 * @return {MapStanding[]}
 */
export const mergeStandings = function(status, ours, clanName, holdPosition){
    return status.map(m => {
        const board = [...(m.leaderboard ?? [])].sort((a, b) => a.position - b.position);
        const mine = ours.find(o => o.map_id === m.map_id);
        const kills = Number(mine?.kills) || 0;
        const onBoard = board.find(r => r.clan_name === clanName);
        let position = onBoard?.position ?? (Number(mine?.position) || null);
        if (!kills) position = null;
        const entry = (/** @type {{ position: number, clan_name: string, kills: number } | undefined} */ r) => (r ? { name: r.clan_name, kills: Number(r.kills) || 0, position: r.position } : null);
        const above = position && position > 1 ? entry(board.find(r => r.position === position - 1)) : null;
        const below = position ? entry(board.find(r => r.position === position + 1)) : null;
        const holdRow = board.find(r => r.position === holdPosition);
        const holdLine = position && position > holdPosition && holdRow ? { name: holdRow.clan_name, kills: Number(holdRow.kills) || 0 } : null;
        return { mapId: m.map_id, mapName: m.map_name, kills, position, above, below, holdLine };
    });
};

/**
 * Classify every map
 *
 * @param {MapStanding[]} standings
 * @param {{ hold_position: number, close_margin: number }} cfg
 * @return {MapAssessment[]}
 */
export const assessTurf = function(standings, cfg){
    return standings.map(s => {
        if (!s.position) return { mapId: s.mapId, mapName: s.mapName, state: "none", kills: 0, position: null, lead: null, chaser: null, deficit: null, target: null };
        if (s.position <= cfg.hold_position){
            const lead = s.below ? s.kills - s.below.kills : null;
            const state = lead !== null && lead <= cfg.close_margin ? "close" : "safe";
            return { mapId: s.mapId, mapName: s.mapName, state, kills: s.kills, position: s.position, lead, chaser: s.below?.name ?? null, deficit: null, target: null };
        }
        const target = s.holdLine ?? s.above;
        const deficit = target ? target.kills - s.kills + 1 : null;
        return { mapId: s.mapId, mapName: s.mapName, state: "lost", kills: s.kills, position: s.position, lead: null, chaser: null, deficit, target: target?.name ?? null };
    });
};

/**
 * @param {number} n
 * @return {string}
 */
const num = n => Math.round(n).toLocaleString("en-US");

/**
 * @param {number} position
 * @return {string}
 */
const ordinal = position => ({ 1: "first", 2: "second", 3: "third" })[position] ?? `#${position}`;

/**
 * "2h 10m" until 00:00 UTC
 *
 * @param {Date} [now=new Date()]
 * @return {string}
 */
export const timeLeftText = function(now = new Date()){
    const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
    const minutes = Math.max(0, Math.round((end - now.getTime()) / 60000));
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h ? `${h}h ${m}m` : `${m}m`;
};

/**
 * One line per map
 *
 * @param {MapAssessment} a
 * @param {{ hold_position: number }} cfg
 * @return {string}
 */
export const mapLine = function(a, cfg){
    if (a.state === "none") return `**${a.mapName}**: no kills yet today`;
    if (a.state === "lost"){
        const need = a.deficit !== null && a.target ? `, ${num(a.deficit)} more kills needed to pass ${a.target} for #${cfg.hold_position}` : "";
        return `**${a.mapName}**: #${a.position} with ${num(a.kills)} kills${need} 🚨`;
    }
    const lead = a.lead !== null && a.chaser ? `, ${num(a.lead)} ahead of ${a.chaser}` : "";
    const flag = a.state === "close" ? " ⚠️" : "";
    return `**${a.mapName}**: #${a.position} with ${num(a.kills)} kills${lead}${flag}`;
};

/**
 * Headline sentence for a set of maps
 *
 * @param {MapAssessment[]} maps
 * @param {{ hold_position: number }} cfg
 * @return {string}
 */
export const headline = function(maps, cfg){
    const held = maps.filter(m => m.state === "safe" || m.state === "close");
    const lost = maps.filter(m => m.state === "lost" || m.state === "none");
    const close = maps.filter(m => m.state === "close");
    const list = (/** @type {MapAssessment[]} */ xs) => xs.map(m => m.mapName).join(xs.length === 2 ? " and " : ", ").replace(/, ([^,]*)$/, " and $1");

    if (!held.length){
        const needs = lost.filter(m => m.deficit !== null && m.target).map(m => `${m.mapName} needs ${num(/** @type {number} */ (m.deficit))} more kills to pass ${m.target}`);
        return `🚨 We are not holding any map right now. ${needs.join(", ")}.`;
    }
    const warnings = close.map(m => (m.position === 1
        ? `${m.chaser} is only ${num(/** @type {number} */ (m.lead))} kills behind us on ${m.mapName}, our first place is at risk`
        : `${m.chaser} is only ${num(/** @type {number} */ (m.lead))} kills away from taking our ${ordinal(/** @type {number} */ (m.position))} place on ${m.mapName}`));
    if (lost.length){
        const gaps = lost.map(m => (m.deficit !== null && m.target ? `${m.target} is ${num(/** @type {number} */ (m.deficit) - 1)} kills ahead of us for #${cfg.hold_position} on ${m.mapName}` : `${m.mapName} has no kills from us yet`));
        const base = `We are holding ${list(held)} but not ${list(lost)}: ${gaps.join("; ")}.`;
        return warnings.length ? `⚠️ ${base} ${warnings.join(". ")}.` : base;
    }
    if (warnings.length) return `⚠️ ${warnings.join(". ")}.`;
    return "We are steadily holding turf on all three maps :3";
};

/**
 * Whether the current standings need people to play
 *
 * @param {MapAssessment[]} maps
 * @return {boolean}
 */
export const actionNeeded = maps => maps.some(m => m.state !== "safe");

/**
 * Role mention prefix when action is needed and the daily ping budget allows it, empty otherwise
 *
 * @param {boolean} needed
 * @param {{ pingsToday: number, cfg: { max_pings_per_day: number } }} [budget]
 * @return {string}
 */
export const ping = function(needed, budget = { pingsToday: 0, cfg: DEFAULT_TURF }){
    if (!needed || !config.ids.clan.turf_role) return "";
    if (budget.pingsToday >= budget.cfg.max_pings_per_day) return "";
    return `<@&${config.ids.clan.turf_role}> `;
};

/**
 * The full status message
 *
 * @param {MapAssessment[]} maps
 * @param {{ hold_position: number }} cfg
 * @param {Date} [now=new Date()]
 * @param {number} [pingsToday=0] role pings already sent today, for the daily cap
 * @return {{ content: string, embed: EmbedBuilder, needed: boolean, pinged: boolean }}
 */
export const composeTurfReport = function(maps, cfg, now = new Date(), pingsToday = 0){
    const needed = actionNeeded(maps);
    const prefix = ping(needed, { pingsToday, cfg });
    const embed = new EmbedBuilder()
        .setColor(needed ? "Orange" : defaults.embed_color)
        .setDescription(maps.map(m => mapLine(m, cfg)).join("\n") + `\n\n⏳ ${timeLeftText(now)} until the turf day ends`);
    return { content: prefix + headline(maps, cfg), embed, needed, pinged: !!prefix };
};

/**
 * One-line alert for a state change on one map
 *
 * @param {MapAssessment} a
 * @param {"safe" | "close" | "lost" | "none"} previous
 * @param {{ hold_position: number }} cfg
 * @return {string | null} null when the change is not worth a message
 */
export const alertText = function(a, previous, cfg){
    if (a.state === "close" && a.chaser && a.lead !== null){
        return a.position === 1
            ? `⚠️ ${a.chaser} is only ${num(a.lead)} kills behind us on ${a.mapName}, our first place is at risk!`
            : `⚠️ ${a.chaser} is only ${num(a.lead)} kills away from taking our ${ordinal(/** @type {number} */ (a.position))} place on ${a.mapName}!`;
    }
    if (a.state === "lost" && (previous === "safe" || previous === "close")){
        const gap = a.deficit !== null && a.target ? ` ${a.target} is ${num(a.deficit - 1)} kills ahead, we need ${num(a.deficit)} more to take #${cfg.hold_position} back.` : "";
        return `🚨 We lost our spot on ${a.mapName}, we are #${a.position} now.${gap}`;
    }
    if ((a.state === "safe" || a.state === "close") && (previous === "lost" || previous === "none")){
        return `✅ We are back on ${a.mapName}: #${a.position} with ${num(a.kills)} kills${a.lead !== null && a.chaser ? `, ${num(a.lead)} ahead of ${a.chaser}` : ""}.`;
    }
    return null;
};

/**
 * Decide what to post this tick: a report at the configured hours (once per hour and day), and alerts on state changes (once per map and state per day)
 *
 * @param {{ maps: MapAssessment[], previous: Record<number, string>, posted: Set<string>, now: Date, cfg: typeof DEFAULT_TURF }} input
 * @return {{ report: boolean, alerts: Array<{ key: string, text: string }>, keys: string[] }}
 */
export const decideTurfPosts = function({ maps, previous, posted, now, cfg }){
    const hour = now.getUTCHours();
    const reportKey = `report:${hour}`;
    const report = cfg.report_hours_utc.includes(hour) && !posted.has(reportKey);
    const alerts = [];
    const keys = report ? [reportKey] : [];
    for (const a of maps){
        const prev = /** @type {"safe" | "close" | "lost" | "none"} */ (previous[a.mapId] ?? "safe");
        if (prev === a.state) continue;
        const key = `alert:${a.mapId}:${a.state}`;
        if (posted.has(key)) continue;
        const text = alertText(a, prev, cfg);
        if (!text) continue;
        alerts.push({ key, text });
        keys.push(key);
    }
    // a report already says everything, do not repeat it as alerts in the same tick
    return { report, alerts: report ? [] : alerts, keys: report ? [reportKey, ...alerts.map(x => x.key)] : keys };
};

/**
 * Fetch the live standings of the main clan
 *
 * @param {import("./krunkerApi.js").KrunkerApi} krunker
 * @param {import("./clans.js").ClanEntry} clan
 * @param {typeof DEFAULT_TURF} cfg
 * @return {Promise<MapAssessment[]>}
 */
export const fetchTurfAssessment = async function(krunker, clan, cfg){
    const status = (await krunker.get("/territorial-wars/status")).data ?? [];
    const ours = (await krunker.get(`/territorial-wars/clan/${clan.id}`)).data?.maps ?? [];
    return assessTurf(mergeStandings(status, ours, clan.name, cfg.hold_position), cfg);
};

/**
 * Periodic check: post reports and alerts to the clan general channel
 *
 * @param {import("../client.js").default} client
 * @param {{ db?: import("better-sqlite3").Database, krunker?: import("./krunkerApi.js").KrunkerApi, now?: Date, force?: boolean }} [options] force posts a report regardless of the hour
 * @return {Promise<{ posted: number }>}
 */
export const runTurfWatch = async function(client, { db = getClanDb(), krunker = api, now = new Date(), force = false } = {}){
    const channelId = config.ids.clan.clan_general;
    const clan = mainClan();
    if (!channelId || !clan) return { posted: 0 };
    const cfg = turfSettings();
    const day = turfDay(now);

    const maps = await fetchTurfAssessment(krunker, clan, cfg);
    const previous = Object.fromEntries(db.prepare("select map_id, state from turf_watch_state where day = ?").all(day).map(r => [r.map_id, r.state]));
    const posted = new Set(db.prepare("select key from turf_watch_log where day = ?").all(day).map(r => r.key));
    const decision = decideTurfPosts({ maps, previous, posted, now, cfg });

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isSendable()){
        Log.warn(`[TURF] clan_general ${channelId} is not a sendable channel`);
        return { posted: 0 };
    }

    let count = 0;
    const roles = config.ids.clan.turf_role ? [config.ids.clan.turf_role] : [];
    const logKey = db.prepare("insert or ignore into turf_watch_log (day, key, posted_at) values (?, ?, ?)");
    let pingsToday = db.prepare("select count(*) as c from turf_watch_log where day = ? and key like 'ping:%'").get(day)?.c ?? 0;
    if (decision.report || force){
        const { content, embed, pinged } = composeTurfReport(maps, cfg, now, pingsToday);
        await channel.send({ content, embeds: [embed], allowedMentions: { roles, users: [] } });
        if (pinged){
            pingsToday++;
            logKey.run(day, `ping:report:${now.getTime()}`, now.getTime());
        }
        count++;
    }
    for (const alert of decision.alerts){
        // "we are back" news needs nobody; warnings and losses do, within the daily ping budget
        const needed = !alert.text.startsWith("✅");
        const prefix = ping(needed, { pingsToday, cfg });
        await channel.send({ content: prefix + alert.text, allowedMentions: { roles, users: [] } });
        if (prefix){
            pingsToday++;
            logKey.run(day, `ping:${alert.key}`, now.getTime());
        }
        count++;
    }

    const upsertState = db.prepare("insert into turf_watch_state (day, map_id, state, updated_at) values (?, ?, ?, ?) on conflict (day, map_id) do update set state = excluded.state, updated_at = excluded.updated_at");
    for (const a of maps) upsertState.run(day, a.mapId, a.state, now.getTime());
    for (const key of decision.keys) logKey.run(day, key, now.getTime());

    if (count) Log.done(`[TURF] posted ${count} message(s)`);
    return { posted: count };
};
