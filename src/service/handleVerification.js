import path from "node:path";
import { EmbedBuilder, MessageFlags } from "discord.js";
import { QuickDB } from "quick.db";
import defaults from "../util/defaults.js";
import Log from "../util/log.js";
import gLogger from "./gLogger.js";
import { config } from "../../config/config.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

const db = new QuickDB({
    filePath: path.resolve("./data/guild_data.sqlite"),
});

/**
 * Send success message
 *
 * @param {import("discord.js").ModalSubmitInteraction} interaction
 * @param {String} username
 * @return {Promise<any>}
 */
const sendSuccessMessage = async function(interaction, username){
    const embed = new EmbedBuilder()
        .setTitle("Verification Successful")
        .setDescription(`You have successfully been verified as ${username}!`)
        .setColor(defaults.embed_color);

    Log.done(`User ${interaction.user.displayName} has been verified as "${username}"`);

    await gLogger(
        interaction,
        "🔷┃Verification Log - Success",
        `User ${interaction.user} has been verified as **"${username}"**.`,
    );

    return await interaction.editReply({
        embeds: [embed],
    }).catch(() => null);
};

/**
 * Send error message
 *
 * @param {import("discord.js").ModalSubmitInteraction} interaction
 * @param {String} message
 * @return {Promise<any>}
 */
const sendErrorMessage = async function(interaction, message){
    const embed = new EmbedBuilder()
        .setTitle("Verification Failed")
        .setDescription(message)
        .setColor(defaults.embed_color);

    Log.error(`User ${interaction.user.displayName} failed verification: ${message}`);

    await gLogger(
        interaction,
        "🔷┃Verification Log - Error",
        `User ${interaction.user} **could NOT** be verified via modal:\n${message}`,
        "Red",
    );

    return await interaction.editReply({
        embeds: [embed],
    }).catch(() => null);
};

/**
 * Handle verification
 *
 * @param {import("discord.js").ModalSubmitInteraction} interaction
 * @return {Promise<import("discord.js").Message>}
 */
const handleVerification = async function(interaction){
    if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    const existingUsername = await db.get(`guild-${interaction.guildId}.user-${interaction.user.id}.username`).catch(() => null);
    if (existingUsername) return await interaction.editReply({ content: "You are already verified, silly" }).catch(() => null);

    const username = interaction.fields.getTextInputValue("username");

    const gMember = /** @type {import("discord.js").GuildMember} */ (interaction.member);
    const memberRole = await interaction.guild?.roles.fetch(config.ids.verified_role);

    if (!memberRole) return await sendErrorMessage(interaction, "Member role not found. Please contact the server owner.");

    await gMember.roles.add(memberRole).catch(() => null);

    await db.set(`guild-${interaction.guildId}.user-${interaction.user.id}.username`, username).catch(() => null);

    return await sendSuccessMessage(interaction, username);
};

export default handleVerification;
