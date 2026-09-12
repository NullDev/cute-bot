import { MessageFlags } from "discord.js";
import Log from "../util/log.js";
import { giveawayDb, withLock, isVerified, hasRequiredRole, buildGiveawayEmbed } from "./giveaway.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

/**
 * Handle a click on the "Join Giveaway" button
 *
 * @param {import("discord.js").ButtonInteraction} interaction
 * @return {Promise<any>}
 */
const handleGiveawayJoin = async function(interaction){
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    const messageId = interaction.message.id;

    return await withLock(messageId, async() => {
        const gw = await giveawayDb.get(messageId);
        if (!gw) return await interaction.editReply({ content: "I can't find this giveaway." }).catch(() => null);
        if (gw.ended) return await interaction.editReply({ content: "This giveaway has ended." }).catch(() => null);

        const member = await interaction.guild?.members.fetch(interaction.user.id).catch(() => null);
        if (!member || !(await isVerified(member))){
            return await interaction.editReply({
                content: "You need to be verified to join the giveaway. Go to <#1548170086525706301>",
            }).catch(() => null);
        }

        if (!hasRequiredRole(member, gw)){
            return await interaction.editReply({
                content: `You need the <@&${gw.requiredRoleId}> role to join this giveaway.`,
                allowedMentions: { parse: [] },
            }).catch(() => null);
        }

        if (gw.participants.includes(interaction.user.id)){
            return await interaction.editReply({ content: "You're already in!" }).catch(() => null);
        }

        gw.participants.push(interaction.user.id);
        await giveawayDb.set(messageId, gw);

        await interaction.message.edit({ embeds: [buildGiveawayEmbed(gw)] })
            .catch(e => Log.error(`Failed to update giveaway embed ${messageId}: `, e));

        Log.info(`User ${interaction.user.displayName} joined giveaway ${messageId}`);

        return await interaction.editReply({ content: "You're in! Good luck 🍀" }).catch(() => null);
    });
};

export default handleGiveawayJoin;
