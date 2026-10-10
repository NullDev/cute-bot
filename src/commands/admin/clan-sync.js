import { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, MessageFlags } from "discord.js";
import { runClanSync } from "../../service/clan/sync.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

const commandName = import.meta.url.split("/").pop()?.split(".").shift() ?? "";

export default {
    data: new SlashCommandBuilder()
        .setName(commandName)
        .setDescription("(ADMIN) Sync Discord clan roles with the in-game roster")
        .setContexts([InteractionContextType.Guild])
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addBooleanOption(o => o.setName("dry_run").setDescription("Only show what would change").setRequired(false)),

    /**
     * @param {import("discord.js").ChatInputCommandInteraction} interaction
     */
    async execute(interaction){
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const dryRun = interaction.options.getBoolean("dry_run") ?? false;
        try {
            const { client } = interaction;
            const { embed } = await runClanSync(/** @type {import("../../service/client.js").default} */ (client), interaction.guildId ?? "", { dryRun });
            await interaction.editReply({ embeds: [embed] });
        }
        catch (e){
            await interaction.editReply(`Sync aborted: ${e instanceof Error ? e.message : String(e)}`);
        }
    },
};
