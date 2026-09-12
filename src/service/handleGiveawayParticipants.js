import { EmbedBuilder, MessageFlags, escapeMarkdown } from "discord.js";
import defaults from "../util/defaults.js";
import { giveawayDb, getIgn } from "./giveaway.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

const PAGE_SIZE = 15;

/**
 * Build one page of the participant list
 *
 * @param {import("discord.js").ButtonInteraction} interaction
 * @param {string} messageId
 * @param {number} page
 * @return {Promise<import("discord.js").InteractionEditReplyOptions>}
 */
const buildPage = async function(interaction, messageId, page){
    const gw = await giveawayDb.get(messageId);
    if (!gw) return { content: "I can't find this giveaway.", embeds: [], components: [] };

    const total = gw.participants.length;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const current = Math.min(Math.max(page, 0), pages - 1);
    const ids = gw.participants.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);

    const members = ids.length ? await interaction.guild?.members.fetch({ user: ids }).catch(() => null) : null;

    const lines = await Promise.all(ids.map(async(id, i) => {
        const name = members?.get(id)?.displayName
            ?? (await interaction.client.users.fetch(id).catch(() => null))?.username
            ?? "unknown";
        const ign = await getIgn(gw.guildId, id);
        return `\`${current * PAGE_SIZE + i + 1}.\` **${escapeMarkdown(name)}** (<@${id}>) ┃ 🎮 ${ign ? `\`${String(ign).replaceAll("`", "")}\`` : "*no IGN*"}`;
    }));

    const embed = new EmbedBuilder()
        .setColor(defaults.embed_color)
        .setTitle("👥┃Giveaway Participants")
        .setDescription(lines.length ? lines.join("\n") : "Nobody joined yet.")
        .setFooter({ text: `Page ${current + 1}/${pages} • ${total} participant${total === 1 ? "" : "s"}` });

    return {
        content: "",
        embeds: [embed],
        components: [
            {
                type: 1,
                components: [
                    {
                        type: 2,
                        style: 2,
                        label: "◀ Prev",
                        custom_id: `giveaway_participants_page:${messageId}:${current - 1}`,
                        disabled: current === 0,
                    },
                    {
                        type: 2,
                        style: 2,
                        label: "Next ▶",
                        custom_id: `giveaway_participants_page:${messageId}:${current + 1}`,
                        disabled: current >= pages - 1,
                    },
                ],
            },
        ],
        allowedMentions: { parse: [] },
    };
};

/**
 * Handle the "Participants" button on a giveaway, and the page buttons of the list
 *
 * @param {import("discord.js").ButtonInteraction} interaction
 * @return {Promise<any>}
 */
const handleGiveawayParticipants = async function(interaction){
    if (interaction.customId === "giveaway_participants"){
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        return await interaction.editReply(await buildPage(interaction, interaction.message.id, 0)).catch(() => null);
    }

    const [, messageId, page] = interaction.customId.split(":");
    await interaction.deferUpdate();
    return await interaction.editReply(await buildPage(interaction, messageId, Number(page) || 0)).catch(() => null);
};

export default handleGiveawayParticipants;
