import { EmbedBuilder, MessageFlags } from "discord.js";
import defaults from "../util/defaults.js";
import Log from "../util/log.js";
import gLogger from "./gLogger.js";
import { config } from "../../config/config.js";
import { api } from "./clan/krunkerApi.js";
import { getClanDb } from "./clan/db.js";
import { syncOneMember } from "./clan/sync.js";
import { resolveIgn, suggestIgns, linkPlayer, unlinkDiscord, getLinkByDiscord } from "./clan/identity.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

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

    return await interaction.editReply({ embeds: [embed] }).catch(() => null);
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

    return await interaction.editReply({ embeds: [embed] }).catch(() => null);
};

/**
 * Handle verification
 *
 * @param {import("discord.js").ModalSubmitInteraction} interaction
 * @return {Promise<import("discord.js").Message|null>}
 */
const handleVerification = async function(interaction){
    if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
    if (!interaction.guildId) return null;

    const db = getClanDb();
    if (getLinkByDiscord(db, interaction.guildId, interaction.user.id)){
        return await interaction.editReply({ content: "You are already verified, silly" }).catch(() => null);
    }

    const username = interaction.fields.getTextInputValue("username");

    let resolved;
    try {
        resolved = await resolveIgn(api, username);
    }
    catch (e){
        Log.error("[CLAN] verify: Krunker API error: ", e instanceof Error ? e : new Error(String(e)));
        return await sendErrorMessage(interaction, "The Krunker API is unavailable right now, please try again later.");
    }
    if (!resolved){
        const suggestions = await suggestIgns(api, username);
        const hint = suggestions.length ? `\nDid you mean: ${suggestions.map(s => `\`${s}\``).join(", ")}?` : "";
        return await sendErrorMessage(interaction, `There is no Krunker player named \`${username}\`. Check the spelling and press Verify again.${hint}`);
    }

    const memberRole = await interaction.guild?.roles.fetch(config.ids.verified_role);
    if (!memberRole) return await sendErrorMessage(interaction, "Member role not found. Please contact the server owner.");

    const linked = linkPlayer(db, {
        guildId: interaction.guildId,
        discordId: interaction.user.id,
        playerId: resolved.playerId,
        playerName: resolved.playerName,
        source: "verify",
    });
    if (!linked.ok){
        return await sendErrorMessage(interaction, `The IGN \`${resolved.playerName}\` is already linked to <@${linked.discordId}>. If that is wrong, ask a mod.`);
    }

    const gMember = /** @type {import("discord.js").GuildMember} */ (interaction.member);
    const roleAdded = await gMember.roles.add(memberRole).then(() => true).catch(() => false);
    if (!roleAdded){
        unlinkDiscord(db, interaction.guildId, interaction.user.id);
        return await sendErrorMessage(interaction, "Could not give you the verified role, please try again or ask a mod.");
    }

    await syncOneMember(gMember).catch(() => null);

    return await sendSuccessMessage(interaction, resolved.playerName);
};

export default handleVerification;
