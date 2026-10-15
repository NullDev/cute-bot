import Log from "../../util/log.js";
import { config } from "../../../config/config.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

/**
 * The welcome line for a fresh recruit
 *
 * @param {string} discordId
 * @param {string} playerName
 * @return {string}
 */
export const welcomeText = function(discordId, playerName){
    return `Welcome to \`[cute]\`, <@${discordId}> / \`${playerName}\`! :3\nPlease check out <#1558968094251286548> and the latest infos in <#1104405759460114553>.\nStay cute and have fun~`;
};

/**
 * Greet a new recruit in the clan general channel
 *
 * @param {import("../client.js").default} client
 * @param {string} discordId
 * @param {string} playerName
 * @return {Promise<boolean>} whether the message went out
 */
export const postWelcome = async function(client, discordId, playerName){
    const channelId = config.ids.clan.clan_general;
    if (!channelId) return false;
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isSendable()){
        Log.warn(`[CLAN] clan_general ${channelId} is not a sendable channel, no welcome for ${playerName}`);
        return false;
    }
    await channel.send({ content: welcomeText(discordId, playerName), allowedMentions: { users: [discordId] } });
    return true;
};
