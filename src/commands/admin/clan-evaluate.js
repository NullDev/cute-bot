import { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, MessageFlags } from "discord.js";
import { api } from "../../service/clan/krunkerApi.js";
import { getClanDb } from "../../service/clan/db.js";
import { getLinkByDiscord } from "../../service/clan/identity.js";
import { evaluatePlayer } from "../../service/clan/evaluatePlayer.js";
import { buildEvaluationEmbed } from "../../service/clan/evaluate.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

const commandName = import.meta.url.split("/").pop()?.split(".").shift() ?? "";

export default {
    data: new SlashCommandBuilder()
        .setName(commandName)
        .setDescription("(ADMIN) Full stats, score breakdown and reasoning for one player")
        .setContexts([InteractionContextType.Guild])
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(o => o.setName("ign").setDescription("Krunker IGN").setRequired(false))
        .addUserOption(o => o.setName("user").setDescription("Discord user (uses their linked IGN)").setRequired(false))
        .addBooleanOption(o => o.setName("public").setDescription("Post the evaluation visibly instead of only to you").setRequired(false)),

    /**
     * @param {import("discord.js").ChatInputCommandInteraction} interaction
     */
    async execute(interaction){
        const isPublic = interaction.options.getBoolean("public") ?? false;
        await interaction.deferReply(isPublic ? {} : { flags: [MessageFlags.Ephemeral] });
        const guildId = interaction.guildId ?? "";
        const db = getClanDb();

        let ign = interaction.options.getString("ign")?.trim() ?? "";
        const user = interaction.options.getUser("user");
        if (!ign && user){
            const link = getLinkByDiscord(db, guildId, user.id);
            if (!link) return await interaction.editReply(`${user} has no linked IGN.`);
            ign = link.playerName;
        }
        if (!ign) return await interaction.editReply("Give an IGN or a Discord user.");

        let profile;
        try {
            profile = await api.getPlayer(ign);
        }
        catch {
            return await interaction.editReply("The Krunker API is unavailable right now, please try again later.");
        }
        if (!profile?.player_id) return await interaction.editReply(`No Krunker player named \`${ign}\`.`);

        let evaluation;
        try {
            evaluation = await evaluatePlayer({ db, api, guildId, profile });
        }
        catch (e){
            return await interaction.editReply(`Could not evaluate: ${e instanceof Error ? e.message : String(e)}`);
        }

        return await interaction.editReply({ embeds: [buildEvaluationEmbed({ ...evaluation, profile })] });
    },
};
