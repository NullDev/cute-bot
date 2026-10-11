import { EmbedBuilder } from "discord.js";
import defaults from "../../util/defaults.js";
import { config } from "../../../config/config.js";
import { profileUrl, statsText, turfText, num } from "./statsCard.js";
import { explainMember } from "./review.js";
import { applicantVerdict } from "./evaluatePlayer.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

const VERDICT_COLOR = { keep: "Green", watch: "Yellow", kick: "Red" };
const APPLICANT_COLOR = { keep: "Green", watch: "Yellow", kick: "Red" };

/**
 * Fixed-width breakdown of the score terms
 *
 * @param {import("./review.js").ReviewRow} row
 * @param {ReturnType<typeof import("./review.js").scoreMember>} result
 * @return {string}
 */
const breakdown = function(row, result){
    const sign = (/** @type {number} */ v) => (v >= 0 ? "+" : "") + v.toFixed(2);
    const lines = result.terms.map(t => `${t.name.padEnd(7)} ${sign(t.value).padStart(6)}  ${t.text}`);
    lines.push("");
    lines.push(`paper ${sign(result.paper)}  activity ${sign(result.activity)}  bonus ${sign(result.bonus)}`);
    lines.push(`total ${sign(result.total)}  ${row.linked ? "linked" : "not linked"}${result.protected ? "  protected" : ""}`);
    return "```\n" + lines.join("\n") + "\n```";
};

/**
 * Evaluation embed for one player
 *
 * @param {{ row: import("./review.js").ReviewRow, result: ReturnType<typeof import("./review.js").scoreMember>, refs: ReturnType<typeof import("./review.js").computeRefs>, cfg: typeof import("./review.js").DEFAULT_REVIEW, profile: any, turf: any, turf14?: { kills: number, games: number, clans: Record<string, number> } | null, member: boolean }} input
 * @return {EmbedBuilder}
 */
export const buildEvaluationEmbed = function({ row, result, refs, cfg, profile, turf, turf14 = null, member }){
    const reasoning = explainMember(row, result, refs, cfg);
    let headline;
    if (member){
        headline = `**${result.verdict.toUpperCase()}** · total **${result.total.toFixed(2)}** (watch below ${cfg.thresholds.watch}, kick below ${cfg.thresholds.kick})${result.protected ? " · 🛡️ protected" : ""}`;
    }
    else {
        const would = applicantVerdict(result.verdict);
        headline = `Would-be verdict: **${would.label}**${would.borderline ? " (borderline)" : ""} · total **${result.total.toFixed(2)}**, accept from ${cfg.thresholds.watch}. Not a member: the 7-day clan score is credited at the median.`;
    }

    const turfLine = `Turf 14 days **${num(row.turf14Kills)}** kills in **${num(row.turf14Games)}** games (median ${num(refs.refTurf)} kills)`;
    const playedFor = turf14 && Object.keys(turf14.clans).length
        ? `, played for ${Object.entries(turf14.clans).map(([c, g]) => `[${c}] ${g} games`).join(", ")}`
        : "";
    const recent = member ? [
        `7-day clan score **${num(row.s7)}** (median ${num(refs.refS7)})`,
        turfLine,
        row.score14Delta === null ? "14-day score gain: no snapshot from 14 days ago yet" : `14-day score gain **${num(row.score14Delta)}** (median ${num(refs.refDelta)})`,
    ].join("\n") : [
        "7-day clan score: members only",
        turfLine + playedFor,
    ].join("\n");

    const embed = new EmbedBuilder()
        .setTitle(`🔎┃Evaluation: ${row.playerName}`)
        .setURL(profileUrl(row.playerName))
        .setColor((member ? VERDICT_COLOR : APPLICANT_COLOR)[result.verdict] ?? defaults.embed_color)
        .setDescription(`${headline}\n[profile](${profileUrl(row.playerName)}) · id ${row.playerId}${row.linked ? "" : " · not linked on Discord"}`)
        .addFields(
            { name: "Stats", value: statsText(profile) },
            { name: "Turf (this season)", value: turfText(turf) },
            { name: member ? `Last 14 days in [${config.clan.name}]` : "Last 14 days", value: recent },
            { name: "Score breakdown", value: breakdown(row, result) },
            { name: "Reasoning", value: reasoning.map(l => `• ${l}`).join("\n").slice(0, 1024) },
        )
        .setTimestamp();

    if (result.reasons.length) embed.addFields({ name: "Short reasons", value: result.reasons.join("; ") });
    return embed;
};
