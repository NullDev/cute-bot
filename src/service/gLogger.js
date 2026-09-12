import { EmbedBuilder } from "discord.js";
import { config } from "../../config/config.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

/**
 * Log to a guild
 *
 * @param {import("discord.js").Interaction | import("discord.js").CommandInteraction} interaction
 * @param {string} title
 * @param {string} description
 * @param {import("discord.js").ColorResolvable | null} [color="Green"]
 */
const gLogger = async function(interaction, title, description, color = "Green"){
    const logChannelId = config.ids.log_channel;
    if (logChannelId){
        const logChannel = await interaction.guild?.channels.fetch(logChannelId).catch(() => null);
        if (logChannel){
            const logEmbed = new EmbedBuilder()
                .setTitle(title)
                .setDescription(description)
                .setTimestamp()
                .setColor(color);

            await /** @type {import("discord.js").GuildTextBasedChannel} */ (logChannel).send({
                embeds: [logEmbed],
            }).catch(() => null);
        }
    }
};

export default gLogger;
