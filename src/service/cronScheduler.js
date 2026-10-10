import cron from "node-cron";
import Log from "../util/log.js";
import LogHandler from "../crons/removeOldLogs.js";
import { cleanupExpired as cleanupAiRateLimit } from "../ai/aiRateLimit.js";
import drawGiveaways from "../crons/drawGiveaways.js";
import clanDaily from "../crons/clanDaily.js";
import { TIMEZONE, DRAW_HOUR, DRAW_MINUTE } from "./giveaway.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

/**
 * Schedule all crons
 *
 * @param {import("../service/client.js").default} client
 */
const scheduleCrons = async function(client){
    // daily cron
    cron.schedule("0 0 * * *", async() => {
        await LogHandler.removeOldLogs();
    });

    // daily giveaway draw at 13:37
    cron.schedule(`${DRAW_MINUTE} ${DRAW_HOUR} * * *`, async() => {
        await drawGiveaways(client);
    }, { timezone: TIMEZONE });

    // hourly cron: prune expired AI rate-limit entries
    cron.schedule("0 * * * *", () => {
        cleanupAiRateLimit();
    });

    // daily clan snapshot + role sync, 03:30 UTC (turf day rolled over at 00:00 UTC)
    cron.schedule("30 3 * * *", async() => {
        await clanDaily(client);
    }, { timezone: "UTC" });

    const cronCount = cron.getTasks().size;
    Log.done("Scheduled " + cronCount + " Crons.");

    // start jobs on init
    await LogHandler.removeOldLogs();
    await drawGiveaways(client);
    await clanDaily(client);
};

export default scheduleCrons;
