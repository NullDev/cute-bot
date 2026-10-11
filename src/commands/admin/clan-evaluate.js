import { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, MessageFlags } from "discord.js";
import { config } from "../../../config/config.js";
import { api, turfDay, levelFromScore } from "../../service/clan/krunkerApi.js";
import { getClanDb } from "../../service/clan/db.js";
import { listLinks, getLinkByDiscord, getLinkByPlayer } from "../../service/clan/identity.js";
import { fetchRoster } from "../../service/clan/roster.js";
import { computeRefs, scoreMember, DEFAULT_REVIEW } from "../../service/clan/review.js";
import { buildReviewRows } from "../../service/clan/reviewReport.js";
import { buildEvaluationEmbed } from "../../service/clan/evaluate.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

const commandName = import.meta.url.split("/").pop()?.split(".").shift() ?? "";

/**
 * Review row for a player who is not on the roster: paper stats from the live profile, no activity
 *
 * @param {any} profile
 * @param {boolean} linked
 * @return {import("../../service/clan/review.js").ReviewRow}
 */
const rowFromProfile = function(profile, linked){
    const kills = Number(profile.player_kills) || 0;
    return {
        playerId: profile.player_id,
        playerName: profile.player_name,
        rank: 0,
        linked,
        level: levelFromScore(profile.player_score),
        kdr: kills / Math.max(Number(profile.player_deaths) || 0, 1),
        kpg: kills / Math.max(Number(profile.player_games_played) || 0, 1),
        nukes: Number(profile.player_stats?.n) || 0,
        s7: 0,
        turf14Kills: 0,
        turf14Games: 0,
        score14Delta: null,
        rankedRank: Number(profile.ranked_rank) || 0,
    };
};

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

        let roster;
        try {
            roster = await fetchRoster(db, api, { clanName: config.clan.name });
        }
        catch (e){
            return await interaction.editReply(`Could not fetch the roster: ${e instanceof Error ? e.message : String(e)}`);
        }

        const rows = buildReviewRows(db, roster, listLinks(db, guildId), turfDay());
        const refs = computeRefs(rows);
        const cfg = { ...DEFAULT_REVIEW, ...(config.clan.review ?? {}) };
        const memberRow = rows.find(r => r.playerId === profile.player_id);
        const row = memberRow ?? rowFromProfile(profile, !!getLinkByPlayer(db, guildId, profile.player_id));
        const result = scoreMember(row, refs, cfg);
        const turf = await api.getTurfPlayer(profile.player_id).catch(() => null);

        return await interaction.editReply({
            embeds: [buildEvaluationEmbed({ row, result, refs, cfg, profile, turf, member: !!memberRow })],
        });
    },
};
