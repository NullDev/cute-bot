import path from "node:path";
import { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, MessageFlags, AttachmentBuilder } from "discord.js";
import { QuickDB } from "quick.db";
import Log from "../../util/log.js";
import { api } from "../../service/clan/krunkerApi.js";
import { getClanDb } from "../../service/clan/db.js";
import { resolveIgn, linkPlayer, unlinkDiscord, getLinkByDiscord, migrateQuickDb } from "../../service/clan/identity.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

const commandName = import.meta.url.split("/").pop()?.split(".").shift() ?? "";

const legacyDb = new QuickDB({
    filePath: path.resolve("./data/guild_data.sqlite"),
});

export default {
    data: new SlashCommandBuilder()
        .setName(commandName)
        .setDescription("(ADMIN) Manage the Discord <-> Krunker links")
        .setContexts([InteractionContextType.Guild])
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(sub => sub.setName("set").setDescription("Link a user to an IGN (overrides their current link)")
            .addUserOption(o => o.setName("user").setDescription("Discord user").setRequired(true))
            .addStringOption(o => o.setName("ign").setDescription("Krunker IGN").setRequired(true)))
        .addSubcommand(sub => sub.setName("remove").setDescription("Remove the link of a user")
            .addUserOption(o => o.setName("user").setDescription("Discord user").setRequired(true)))
        .addSubcommand(sub => sub.setName("show").setDescription("Show the link of a user")
            .addUserOption(o => o.setName("user").setDescription("Discord user").setRequired(true)))
        .addSubcommand(sub => sub.setName("migrate").setDescription("One-off: import the old verify usernames")),

    /**
     * @param {import("discord.js").ChatInputCommandInteraction} interaction
     */
    async execute(interaction){
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const guildId = interaction.guildId ?? "";
        const db = getClanDb();
        const sub = interaction.options.getSubcommand();

        if (sub === "set"){
            const user = interaction.options.getUser("user", true);
            const ign = interaction.options.getString("ign", true);
            let resolved;
            try {
                resolved = await resolveIgn(api, ign);
            }
            catch (e){
                Log.error("[CLAN] clan-link set: Krunker API error: ", e instanceof Error ? e : new Error(String(e)));
                return await interaction.editReply("The Krunker API is unavailable right now, please try again later.");
            }
            if (!resolved) return await interaction.editReply(`No Krunker player named \`${ign}\`.`);
            const res = linkPlayer(db, { guildId, discordId: user.id, playerId: resolved.playerId, playerName: resolved.playerName, source: "admin" });
            if (!res.ok) return await interaction.editReply(`\`${resolved.playerName}\` is already linked to <@${res.discordId}>. Remove that link first.`);
            return await interaction.editReply(`Linked ${user} to \`${resolved.playerName}\` (id ${resolved.playerId}).`);
        }

        if (sub === "remove"){
            const user = interaction.options.getUser("user", true);
            const removed = unlinkDiscord(db, guildId, user.id);
            return await interaction.editReply(removed ? `Removed the link of ${user}.` : `${user} has no link.`);
        }

        if (sub === "show"){
            const user = interaction.options.getUser("user", true);
            const link = getLinkByDiscord(db, guildId, user.id);
            if (!link) return await interaction.editReply(`${user} has no link.`);
            return await interaction.editReply(`${user} is \`${link.playerName}\` (id ${link.playerId}, source ${link.source}, linked <t:${Math.floor(link.linkedAt / 1000)}:R>).`);
        }

        // migrate
        const legacy = await legacyDb.get(`guild-${guildId}`).catch(() => null) ?? {};
        const entries = Object.entries(legacy)
            .filter(([key, value]) => key.startsWith("user-") && value?.username)
            .map(([key, value]) => ({ discordId: key.slice("user-".length), username: String(value.username) }));
        let result;
        try {
            result = await migrateQuickDb(db, api, guildId, entries);
        }
        catch (e){
            Log.error("[CLAN] clan-link migrate: Krunker API error: ", e instanceof Error ? e : new Error(String(e)));
            const linkedSoFar = /** @type {any} */ (e)?.partial?.linked?.length ?? 0;
            return await interaction.editReply(`The Krunker API became unavailable during the migration; ${linkedSoFar} entries were linked so far, run the command again later.`);
        }
        const lines = [
            `Linked ${result.linked.length}, unresolved ${result.unresolved.length}, conflicts ${result.conflicts.length}.`,
            "",
            "Unresolved (need to re-verify):",
            ...result.unresolved.map(u => `  <@${u.discordId}> "${u.username}"`),
            "",
            "Conflicts (IGN already linked to someone else):",
            ...result.conflicts.map(c => `  <@${c.discordId}> "${c.username}" -> ${c.playerName} taken by <@${c.takenBy}>`),
        ];
        const file = new AttachmentBuilder(Buffer.from(lines.join("\n"), "utf-8"), { name: "migration.txt" });
        return await interaction.editReply({ content: lines[0], files: [file] });
    },
};
