import Log from "../util/log.js";
import { config } from "../../config/config.js";
import { api, turfDay } from "../service/clan/krunkerApi.js";
import { getClanDb } from "../service/clan/db.js";
import { fetchRoster } from "../service/clan/roster.js";
import { runSnapshot, backfillTurf, hasSnapshotForDay } from "../service/clan/snapshot.js";
import { runClanSync } from "../service/clan/sync.js";
import { allClans, mainGuildId, isMainGuild } from "../service/clan/clans.js";
import { checkPendingJoins } from "../service/clan/pendingJoins.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

const TURF_BACKFILL_DAYS = 14;

/**
 * Run one step and log instead of throwing
 *
 * @param {string} name
 * @param {() => Promise<any>} fn
 * @return {Promise<any>}
 */
const step = async function(name, fn){
    try {
        const res = await fn();
        Log.done(`[CLAN] ${name} done`);
        return res;
    }
    catch (e){
        Log.error(`[CLAN] ${name} failed: `, e instanceof Error ? e : new Error(String(e)));
        return null;
    }
};

/**
 * Daily clan maintenance: snapshot, turf, pending joins, sync
 * The snapshot is skipped when today's already exists; turf and pending joins always run
 * The role sync only runs when clan.sync_enabled is true
 *
 * @param {import("../service/client.js").default} client
 * @param {{ force?: boolean }} [options] force re-snapshots even when today's exists
 */
const clanDaily = async function(client, { force = false } = {}){
    const db = getClanDb();
    const day = turfDay();
    const clans = allClans();
    if (!clans.length){
        Log.warn("[CLAN] No clans configured (clan.main_server and clan.clans), skipping the daily run");
        return;
    }

    const snapshotToday = force || !hasSnapshotForDay(db, day);
    if (!snapshotToday) Log.info(`[CLAN] Snapshot for day ${day} exists, skipping`);
    const turfEmpty = !db.prepare("select 1 from turf_days limit 1").get();
    const from = turfEmpty ? day - TURF_BACKFILL_DAYS + 1 : day - 1;

    /** @type {import("../service/clan/roster.js").Roster | null} */
    let mainRoster = null;
    for (const clan of clans){
        const roster = await step(`roster ${clan.name}`, () => fetchRoster(db, api, { clanName: clan.name }));
        if (!roster) continue;
        if (isMainGuild(clan.discord)) mainRoster = roster;
        if (snapshotToday) await step(`snapshot ${clan.name}`, () => runSnapshot(db, api, roster, { guildId: clan.discord, day }));
        await step(`turf ${clan.name}`, () => backfillTurf(db, api, clan.id, from, day));
    }

    if (!mainRoster) return;
    const guildId = mainGuildId() || [...client.guilds.cache.keys()][0] || "";
    if (!guildId) return;
    if (!config.clan.sync_enabled) Log.info("[CLAN] Automatic role sync is disabled (clan.sync_enabled)");
    await step("pending joins", () => checkPendingJoins(client, db, /** @type {import("../service/clan/roster.js").Roster} */ (mainRoster), guildId));
    if (config.clan.sync_enabled) await step("sync", () => runClanSync(client, guildId));
};

export default clanDaily;
