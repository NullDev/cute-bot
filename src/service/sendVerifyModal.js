import path from "node:path";
import { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, MessageFlags } from "discord.js";
import { QuickDB } from "quick.db";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

const db = new QuickDB({
    filePath: path.resolve("./data/guild_data.sqlite"),
});

/**
 * Send the verification modal
 *
 * @param {import("discord.js").ButtonInteraction} interaction
 * @return {Promise<any>}
 */
const sendVerifyModal = async function(interaction){
    const existingUsername = await db.get(`guild-${interaction.guildId}.user-${interaction.user.id}.username`).catch(() => null);
    if (existingUsername){
        return await interaction.reply({
            content: "You are already verified, silly",
            flags: [MessageFlags.Ephemeral],
        }).catch(() => null);
    }

    const modal = new ModalBuilder()
        .setCustomId("submit_into")
        .setTitle("Krunker Info");

    const username = new TextInputBuilder()
        .setCustomId("username")
        .setStyle(TextInputStyle.Short)
        .setLabel("Your Last Krunker Username / IGN")
        .setRequired(true);

    const first = /** @type {ActionRowBuilder<import("discord.js").ModalActionRowComponentBuilder>} */ (new ActionRowBuilder()).addComponents(username);

    modal.addComponents(first);

    return await interaction.showModal(modal);
};

export default sendVerifyModal;
