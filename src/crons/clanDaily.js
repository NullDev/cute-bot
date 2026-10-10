import Log from "../util/log.js";
import { config } from "../../config/config.js";
import { api, turfDay } from "../service/clan/krunkerApi.js";
import { getClanDb } from "../service/clan/db.js";
import { fetchRoster } from "../service/clan/roster.js";
import { runSnapshot, backfillTurf, hasSnapshotForDay } from "../service/clan/snapshot.js";
import { runClanSync } from "../service/clan/sync.js";

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
 * Daily clan maintenance: snapshot, turf, sync
 * The snapshot is skipped when today's already exists; turf and sync always run
 *
 * @param {import("../service/client.js").default} client
 * @param {{ force?: boolean }} [options] force re-snapshots even when today's exists
 */
const clanDaily = async function(client, { force = false } = {}){
    const db = getClanDb();
    const day = turfDay();
    const roster = await step("roster", () => fetchRoster(db, api, { clanName: config.clan.name }));
    if (!roster) return;

    if (force || !hasSnapshotForDay(db, day)){
        for (const guild of client.guilds.cache.values()){
            await step(`snapshot ${guild.id}`, () => runSnapshot(db, api, roster, { guildId: guild.id, day }));
        }
    }
    else Log.info(`[CLAN] Snapshot for day ${day} exists, skipping`);

    const turfEmpty = !db.prepare("select 1 from turf_days limit 1").get();
    const from = turfEmpty ? day - TURF_BACKFILL_DAYS + 1 : day - 1;
    await step("turf", () => backfillTurf(db, api, config.clan.id, from, day));

    for (const guild of client.guilds.cache.values()){
        await step(`sync ${guild.id}`, () => runClanSync(client, guild.id));
    }
};

export default clanDaily;
