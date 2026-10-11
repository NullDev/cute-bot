import { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, MessageFlags } from "discord.js";
import { runTurfWatch } from "../../service/clan/turfWatch.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

const commandName = import.meta.url.split("/").pop()?.split(".").shift() ?? "";

export default {
    data: new SlashCommandBuilder()
        .setName(commandName)
        .setDescription("(ADMIN) Post the current turf standing to the clan general channel now")
        .setContexts([InteractionContextType.Guild])
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    /**
     * @param {import("discord.js").ChatInputCommandInteraction} interaction
     */
    async execute(interaction){
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        try {
            const { client } = interaction;
            const { posted } = await runTurfWatch(/** @type {import("../../service/client.js").default} */ (client), { force: true });
            await interaction.editReply(posted ? "Posted the turf report." : "Nothing posted: check ids.clan.clan_general and clan.main_server.");
        }
        catch (e){
            await interaction.editReply(`Turf check failed: ${e instanceof Error ? e.message : String(e)}`);
        }
    },
};
