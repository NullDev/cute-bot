import { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from "discord.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

/**
 * Send the verification modal
 *
 * @param {import("discord.js").ButtonInteraction} interaction
 * @return {Promise<undefined>}
 */
const sendVerifyModal = async function(interaction){
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
