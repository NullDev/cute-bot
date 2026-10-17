import { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, MessageFlags } from "discord.js";
import { config } from "../../../config/config.js";
import { runClanSync } from "../../service/clan/sync.js";
import { checkPendingJoins } from "../../service/clan/pendingJoins.js";
import { fetchRoster } from "../../service/clan/roster.js";
import { getClanDb } from "../../service/clan/db.js";
import { api } from "../../service/clan/krunkerApi.js";
import { mainClan } from "../../service/clan/clans.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

const commandName = import.meta.url.split("/").pop()?.split(".").shift() ?? "";

export default {
    data: new SlashCommandBuilder()
        .setName(commandName)
        .setDescription("(ADMIN) Check accepted applications against the roster, then sync Discord clan roles")
        .setContexts([InteractionContextType.Guild])
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addBooleanOption(o => o.setName("dry_run").setDescription("Only show what would change").setRequired(false))
        .addBooleanOption(o => o.setName("force").setDescription("Apply removals even if some roster names did not resolve").setRequired(false)),

    /**
     * @param {import("discord.js").ChatInputCommandInteraction} interaction
     */
    async execute(interaction){
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const dryRun = interaction.options.getBoolean("dry_run") ?? false;
        const force = interaction.options.getBoolean("force") ?? false;
        try {
            const { client } = /** @type {{ client: import("../../service/client.js").default }} */ (interaction);
            const guildId = interaction.guildId ?? "";
            const clan = mainClan();
            if (!clan) throw new Error("No clan configured for the main server (clan.main_server and clan.clans)");
            const db = getClanDb();
            // same order as the nightly job: accepted applicants who show up on the roster are marked joined and welcomed before the role diff runs
            const roster = await fetchRoster(db, api, { clanName: clan.name });
            const notes = [];
            if (dryRun) notes.push("Dry run: accepted applications were not checked.");
            else {
                const joins = await checkPendingJoins(client, db, roster, guildId);
                notes.push(`Applications: ${joins.joined} joined, ${joins.reminded} reminded, ${joins.expired} expired.`);
            }
            const { embed, files } = await runClanSync(client, guildId, { dryRun, force, db, roster });
            if (!config.clan.sync_enabled) notes.push("Automatic daily sync is disabled (clan.sync_enabled).");
            const note = notes.join("\n");
            await (embed ? interaction.editReply({ content: note, embeds: [embed], files }) : interaction.editReply(`${note}\nSync finished, but the summary could not be built. Check the bot log.`));
        }
        catch (e){
            await interaction.editReply(`Sync aborted: ${e instanceof Error ? e.message : String(e)}`);
        }
    },
};
