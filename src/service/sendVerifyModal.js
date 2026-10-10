import { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, MessageFlags } from "discord.js";
import { getClanDb } from "./clan/db.js";
import { getLinkByDiscord } from "./clan/identity.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

/**
 * Send the verification modal
 *
 * @param {import("discord.js").ButtonInteraction} interaction
 * @return {Promise<any>}
 */
const sendVerifyModal = async function(interaction){
    if (interaction.guildId && getLinkByDiscord(getClanDb(), interaction.guildId, interaction.user.id)){
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
