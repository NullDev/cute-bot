import crypto from "node:crypto";
import Log from "../util/log.js";
import {
    giveawayDb,
    withLock,
    isVerified,
    hasRequiredRole,
    buildGiveawayEmbed,
    buildGiveawayComponents,
} from "../service/giveaway.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

/**
 * Pick a random participant who is still in the guild, still verified and still has the required role
 *
 * @param {import("discord.js").Guild} guild
 * @param {import("../service/giveaway.js").Giveaway} gw
 * @return {Promise<string | null>}
 */
const pickWinner = async function(guild, gw){
    const pool = [...gw.participants];
    for (let i = pool.length - 1; i > 0; i--){
        const j = crypto.randomInt(i + 1);
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }

    for (const id of pool){
        const member = await guild.members.fetch(id).catch(() => null);
        if (member && hasRequiredRole(member, gw) && await isVerified(member)) return id;
    }
    return null;
};

/**
 * Draw a single giveaway, announce the winner and DM them
 *
 * @param {import("../service/client.js").default} client
 * @param {string} messageId
 */
const drawGiveaway = async function(client, messageId){
    const gw = await giveawayDb.get(messageId);
    if (!gw || gw.ended) return;

    const guild = client.guilds.cache.get(gw.guildId);
    if (!guild) return;

    const winnerId = await pickWinner(guild, gw);

    // persist first, so a failing announcement can never cause a second draw
    gw.ended = true;
    gw.winnerId = winnerId;
    await giveawayDb.set(messageId, gw);

    Log.done(`[CRON] Giveaway ${messageId} drawn. Winner: ${winnerId ?? "none"}`);

    const channel = await guild.channels.fetch(gw.channelId).catch(() => null);
    if (!channel || !channel.isSendable()){
        Log.warn(`[CRON] Giveaway channel ${gw.channelId} is gone, couldn't announce giveaway ${messageId}.`);
        return;
    }

    const message = await channel.messages.fetch(messageId).catch(() => null);
    await message?.edit({
        embeds: [buildGiveawayEmbed(gw)],
        components: buildGiveawayComponents(true),
    }).catch(e => Log.error(`[CRON] Failed to update giveaway embed ${messageId}: `, e));

    /**
     * @param {string} content
     * @param {string[]} users
     */
    const announce = async(content, users) => {
        const payload = { content, allowedMentions: { users } };
        const sent = message ? await message.reply(payload).catch(() => null) : null;
        if (!sent) await channel.send(payload).catch(e => Log.error(`[CRON] Failed to announce giveaway ${messageId}: `, e));
    };

    if (!winnerId){
        await announce("🎁┃The giveaway has ended, but nobody eligible joined :(", []);
        return;
    }

    const host = await client.users.fetch(gw.hostId).catch(() => null);
    const hostStr = `<@${gw.hostId}>${host ? ` (\`${host.username}\`)` : ""}`;

    const winner = await client.users.fetch(winnerId).catch(() => null);
    const dmSent = await winner?.send({
        content: `🎉┃**Congrats, you won the giveaway in ${guild.name}!**\n\n${gw.description}\n\nPlease DM ${hostStr} to claim your prize!`,
    }).then(() => true).catch(() => false);

    await announce(
        `🎉┃Congratulations <@${winnerId}>, you won the giveaway!` +
        (dmSent ? "" : `\nI couldn't DM you, so please DM <@${gw.hostId}> to claim your prize!`),
        dmSent ? [winnerId] : [winnerId, gw.hostId],
    );
};

/**
 * Draw all giveaways that are due and belong to guilds served by this cluster
 *
 * @param {import("../service/client.js").default} client
 */
const drawGiveaways = async function(client){
    // small slack in case the cron fires a few ms before the stored draw time
    const cutoff = Date.now() + 60_000;

    const due = (await giveawayDb.all())
        .filter(({ value }) => !value.ended && value.endsAt <= cutoff && client.guilds.cache.has(value.guildId));

    if (!due.length) return;
    Log.wait(`[CRON] Drawing ${due.length} giveaway${due.length === 1 ? "" : "s"}...`);

    for (const { id } of due){
        await withLock(id, () => drawGiveaway(client, id))
            .catch(e => Log.error(`[CRON] Failed to draw giveaway ${id}: `, e));
    }
};

export default drawGiveaways;
