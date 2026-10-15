import { SlashCommandBuilder, InteractionContextType } from "discord.js";
import { api } from "../../service/clan/krunkerApi.js";
import { mainClan } from "../../service/clan/clans.js";
import { fetchTurfAssessment, turfSettings, composeTurfReport } from "../../service/clan/turfWatch.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

const commandName = import.meta.url.split("/").pop()?.split(".").shift() ?? "";

export default {
    data: new SlashCommandBuilder()
        .setName(commandName)
        .setDescription("Show the current turf standing of the clan.")
        .setContexts([InteractionContextType.Guild]),
    /**
     * @param {import("discord.js").ChatInputCommandInteraction} interaction
     */
    async execute(interaction){
        if (!interaction.deferred && !interaction.replied){
            await interaction.deferReply();
        }

        const clan = mainClan();
        if (!clan){
            await interaction.editReply("❌ No main clan is configured.");
            return;
        }

        try {
            const cfg = turfSettings();
            const maps = await fetchTurfAssessment(api, clan, cfg);
            // on demand: the headline and map lines without the role ping
            const { content, embed } = composeTurfReport(maps, cfg, new Date(), Number.POSITIVE_INFINITY);
            await interaction.editReply({ content, embeds: [embed], allowedMentions: { parse: [] } });
        }
        catch (e){
            await interaction.editReply(`❌ Could not fetch the turf standing: ${e instanceof Error ? e.message : String(e)}`);
        }
    },
};
