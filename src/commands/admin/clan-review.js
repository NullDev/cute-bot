import { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, MessageFlags, AttachmentBuilder } from "discord.js";
import { config } from "../../../config/config.js";
import { api, turfDay } from "../../service/clan/krunkerApi.js";
import { getClanDb } from "../../service/clan/db.js";
import { listLinks } from "../../service/clan/identity.js";
import { fetchRoster } from "../../service/clan/roster.js";
import { reviewClan, DEFAULT_REVIEW } from "../../service/clan/review.js";
import { buildReviewRows, formatReviewTable, buildReviewEmbed } from "../../service/clan/reviewReport.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

const commandName = import.meta.url.split("/").pop()?.split(".").shift() ?? "";

/** @type {Record<string, (a: any, b: any) => number>} */
const SORTS = {
    verdict: () => 0,
    s7: (a, b) => b.s7 - a.s7,
    level: (a, b) => b.level - a.level,
    nukes: (a, b) => b.nukes - a.nukes,
    kdr: (a, b) => b.kdr - a.kdr,
    turf: (a, b) => b.turf14Kills - a.turf14Kills,
};

export default {
    data: new SlashCommandBuilder()
        .setName(commandName)
        .setDescription("(ADMIN) Stats of every clan member with a keep / watch / kick suggestion")
        .setContexts([InteractionContextType.Guild])
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(o => o.setName("sort").setDescription("Sort order").addChoices(...Object.keys(SORTS).map(k => ({ name: k, value: k }))))
        .addStringOption(o => o.setName("filter").setDescription("Only show one verdict").addChoices(
            { name: "all", value: "all" }, { name: "kick", value: "kick" }, { name: "watch", value: "watch" }, { name: "keep", value: "keep" },
        )),

    /**
     * @param {import("discord.js").ChatInputCommandInteraction} interaction
     */
    async execute(interaction){
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const sort = interaction.options.getString("sort") ?? "verdict";
        const filter = interaction.options.getString("filter") ?? "all";
        const db = getClanDb();
        const guildId = interaction.guildId ?? "";

        let roster;
        try {
            roster = await fetchRoster(db, api, { clanName: config.clan.name });
        }
        catch (e){
            return await interaction.editReply(`Could not fetch the roster: ${e instanceof Error ? e.message : String(e)}`);
        }

        const rows = buildReviewRows(db, roster, listLinks(db, guildId), turfDay());
        const cfg = { ...DEFAULT_REVIEW, ...(config.clan.review ?? {}) };
        const result = reviewClan(rows, cfg);

        let shown = result.rows;
        if (filter !== "all") shown = shown.filter(r => r.review.verdict === filter);
        if (sort !== "verdict") shown = [...shown].sort(SORTS[sort]);

        const file = new AttachmentBuilder(Buffer.from(formatReviewTable(shown), "utf-8"), { name: `clan-review-${turfDay()}.txt` });
        return await interaction.editReply({
            embeds: [buildReviewEmbed(result.summary, result.rows, config.clan.target_size)],
            files: [file],
        });
    },
};
