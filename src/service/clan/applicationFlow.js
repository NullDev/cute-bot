import {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle,
} from "discord.js";
import Log from "../../util/log.js";
import defaults from "../../util/defaults.js";
import { config } from "../../../config/config.js";
import { api, levelFromScore } from "./krunkerApi.js";
import { getClanDb } from "./db.js";
import { getLinkByDiscord, suggestIgns } from "./identity.js";
import { fetchRoster, rosterByPlayerId } from "./roster.js";
import { syncOneMember } from "./sync.js";
import { canApply, createApplication, setApplicationMessage, getApplication, finalizeDecision } from "./applications.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

export const APPLY_BUTTON = "apply";
export const APPLY_MODAL = "application_submit";
export const ACCEPT_PREFIX = "application_accept:";
export const REJECT_PREFIX = "application_reject:";
export const REJECT_MODAL_PREFIX = "application_reject_modal:";

const FIELDS = [
    { id: "ign", label: "Your Krunker IGN", style: TextInputStyle.Short, required: true, max: 32 },
    { id: "modeRegion", label: "Main mode & region (e.g. Turf, EU)", style: TextInputStyle.Short, required: true, max: 60 },
    { id: "why", label: "Why do you want to join [cute]?", style: TextInputStyle.Paragraph, required: true, max: 500 },
    { id: "duel", label: "Willing to 1v1 if stats don't check out?", style: TextInputStyle.Short, required: true, max: 40 },
    { id: "extra", label: "Anything else?", style: TextInputStyle.Paragraph, required: false, max: 500 },
];

/**
 * Ephemeral reply or edit depending on state
 *
 * @param {import("discord.js").RepliableInteraction} interaction
 * @param {string} content
 */
const whisper = async function(interaction, content){
    if (interaction.deferred || interaction.replied) return await interaction.editReply({ content }).catch(() => null);
    return await interaction.reply({ content, flags: [MessageFlags.Ephemeral] }).catch(() => null);
};

/**
 * Button row for a pending application
 *
 * @param {number} id
 * @param {boolean} disabled
 * @return {ActionRowBuilder<ButtonBuilder>}
 */
export const decisionComponents = function(id, disabled){
    return /** @type {ActionRowBuilder<ButtonBuilder>} */ (new ActionRowBuilder()).addComponents(
        new ButtonBuilder().setCustomId(ACCEPT_PREFIX + id).setLabel("Accept").setStyle(ButtonStyle.Success).setDisabled(disabled),
        new ButtonBuilder().setCustomId(REJECT_PREFIX + id).setLabel("Reject").setStyle(ButtonStyle.Danger).setDisabled(disabled),
    );
};

/**
 * Application embed, with the decision when there is one
 *
 * @param {import("./applications.js").Application} app
 * @param {any} profile player profile or null
 * @param {{ status: string, reviewerId: string, reason: string | null, decidedAt: number, rolesOk?: boolean, dmOk?: boolean, rolesError?: string | null } | null} decision
 * @return {EmbedBuilder}
 */
export const buildApplicationEmbed = function(app, profile, decision){
    const a = app.answers;
    const stats = profile ? [
        `Level **${levelFromScore(profile.player_score)}** · KDR **${(profile.player_kills / Math.max(profile.player_deaths, 1)).toFixed(2)}** · KPG **${(profile.player_kills / Math.max(profile.player_games_played, 1)).toFixed(1)}**`,
        `Nukes **${profile.player_stats?.n ?? 0}** · Games **${profile.player_games_played}** · Since **${String(profile.player_datenew ?? "").slice(0, 10)}**`,
        `Clan **${profile.player_clan ? `[${profile.player_clan}]` : "none"}**${profile.player_clan && profile.player_clan !== config.clan.name ? " ⚠️ already in a clan" : ""}`,
    ].join("\n") : "stats unavailable";

    let color = defaults.embed_color;
    if (decision) color = decision.status === "accepted" ? "Green" : "Red";

    const embed = new EmbedBuilder()
        .setTitle(`📨┃Application #${app.id}: ${app.playerName}`)
        .setColor(color)
        .setDescription(`Applicant: <@${app.discordId}>\nIGN: \`${app.playerName}\` (id ${app.playerId})`)
        .addFields(
            { name: "Stats", value: stats },
            { name: "Main mode & region", value: a.modeRegion || "-" },
            { name: "Why join", value: (a.why || "-").slice(0, 1024) },
            { name: "Willing to 1v1", value: a.duel || "-" },
            { name: "Anything else", value: (a.extra || "-").slice(0, 1024) },
        )
        .setTimestamp(app.createdAt);

    if (decision){
        const parts = [`**${decision.status}** by <@${decision.reviewerId}> <t:${Math.floor(decision.decidedAt / 1000)}:R>`];
        if (decision.reason) parts.push(`Reason: ${decision.reason}`);
        if (decision.rolesOk === false) parts.push(`⚠️ roles not applied: ${decision.rolesError ?? "unknown error"}`);
        if (decision.dmOk === false) parts.push("⚠️ could not DM the applicant");
        embed.addFields({ name: "Decision", value: parts.join("\n") });
    }
    return embed;
};

/**
 * Button "apply": pre-checks then the modal
 *
 * @param {import("discord.js").ButtonInteraction} interaction
 */
export const sendApplicationModal = async function(interaction){
    if (!interaction.guildId) return;
    const db = getClanDb();
    // no network here: a button must answer within 3 seconds, so use the last snapshot
    const link = getLinkByDiscord(db, interaction.guildId, interaction.user.id);
    if (link){
        const last = db.prepare("select in_clan from snapshots where player_id = ? order by day desc limit 1").get(link.playerId);
        if (last?.in_clan){
            await whisper(interaction, "You are already in the clan, silly");
            return;
        }
    }
    const check = canApply(db, { guildId: interaction.guildId, discordId: interaction.user.id, playerId: link?.playerId ?? -1, cooldownDays: config.clan.cooldown_days });
    if (!check.ok && check.reason === "pending"){
        await whisper(interaction, "You already have a pending application. Please wait for a decision.");
        return;
    }
    if (!check.ok && check.reason === "cooldown"){
        await whisper(interaction, `You can apply again <t:${Math.floor((check.until ?? 0) / 1000)}:R>.`);
        return;
    }

    const modal = new ModalBuilder().setCustomId(APPLY_MODAL).setTitle("Apply to [cute]");
    for (const f of FIELDS){
        const input = new TextInputBuilder().setCustomId(f.id).setLabel(f.label).setStyle(f.style).setRequired(f.required).setMaxLength(f.max);
        if (link && f.id === "ign") input.setValue(link.playerName);
        modal.addComponents(/** @type {ActionRowBuilder<import("discord.js").ModalActionRowComponentBuilder>} */ (new ActionRowBuilder()).addComponents(input));
    }
    await interaction.showModal(modal);
};

/**
 * Modal submit: validate, store, post to the review channel
 *
 * @param {import("discord.js").ModalSubmitInteraction} interaction
 */
export const handleApplicationSubmit = async function(interaction){
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
    if (!interaction.guildId || !interaction.guild) return;
    const db = getClanDb();
    const answers = Object.fromEntries(FIELDS.map(f => [f.id, interaction.fields.getTextInputValue(f.id)?.trim() ?? ""]));

    const profile = await api.getPlayer(answers.ign).catch(() => null);
    if (!profile?.player_id){
        const suggestions = await suggestIgns(api, answers.ign);
        const hint = suggestions.length ? ` Did you mean: ${suggestions.map(s => `\`${s}\``).join(", ")}?` : "";
        await whisper(interaction, `There is no Krunker player named \`${answers.ign}\`.${hint}`);
        return;
    }

    const roster = await fetchRoster(db, api, { clanName: config.clan.name }).catch(() => null);
    if (roster && rosterByPlayerId(roster).has(profile.player_id)){
        await whisper(interaction, `\`${profile.player_name}\` is already in the clan. If that is you, press Verify instead.`);
        return;
    }

    const check = canApply(db, { guildId: interaction.guildId, discordId: interaction.user.id, playerId: profile.player_id, cooldownDays: config.clan.cooldown_days });
    if (!check.ok){
        if (check.reason === "pending"){
            await whisper(interaction, "You already have a pending application.");
            return;
        }
        if (check.reason === "cooldown"){
            await whisper(interaction, `You can apply again <t:${Math.floor((check.until ?? 0) / 1000)}:R>.`);
            return;
        }
        await whisper(interaction, `The IGN \`${profile.player_name}\` is linked to <@${check.discordId}>. If that is wrong, ask a mod.`);
        return;
    }

    const channel = await interaction.guild.channels.fetch(config.ids.clan.applications_channel).catch(() => null);
    if (!channel?.isSendable()){
        await whisper(interaction, "The applications channel is not configured. Please tell a mod.");
        return;
    }

    const id = createApplication(db, { guildId: interaction.guildId, discordId: interaction.user.id, playerId: profile.player_id, playerName: profile.player_name, answers });
    const app = /** @type {import("./applications.js").Application} */ (getApplication(db, id));
    try {
        const message = await channel.send({ embeds: [buildApplicationEmbed(app, profile, null)], components: [decisionComponents(id, false)] });
        setApplicationMessage(db, id, channel.id, message.id);
    }
    catch (error){
        db.prepare("delete from applications where id = ?").run(id);
        Log.error("[CLAN] Could not post application: ", error instanceof Error ? error : new Error(String(error)));
        await whisper(interaction, "Could not post your application, please try again later or tell a mod.");
        return;
    }

    Log.info(`[CLAN] Application #${id} by ${interaction.user.tag} as ${profile.player_name}`);
    await whisper(interaction, `Your application as \`${profile.player_name}\` was submitted. You will get a DM once it is reviewed.`);
};

/**
 * @param {import("discord.js").GuildMember | null} member
 * @param {string} channelId
 * @return {boolean}
 */
const mayDecide = function(member, channelId){
    return !!member && channelId === config.ids.clan.applications_channel && member.roles.cache.has(config.ids.clan.applications_role);
};

/**
 * Shared decision path: record, roles, DM, embed edit
 *
 * @param {import("discord.js").ButtonInteraction | import("discord.js").ModalSubmitInteraction} interaction
 * @param {import("./applications.js").Application} app
 * @param {"accepted" | "rejected"} status
 * @param {string | null} reason
 */
const decide = async function(interaction, app, status, reason){
    const { guild } = /** @type {{ guild: import("discord.js").Guild }} */ (interaction);
    const db = getClanDb();
    const profile = await api.getPlayer(app.playerName).catch(() => null);

    await finalizeDecision(db, {
        id: app.id,
        status,
        reviewerId: interaction.user.id,
        reason,
        effects: {
            grantRoles: async() => {
                const target = await guild.members.fetch(app.discordId);
                await target.roles.add([config.ids.verified_role, config.ids.clan.recruit], `application #${app.id} accepted`);
                await syncOneMember(target).catch(() => null);
            },
            dm: async() => {
                const user = await interaction.client.users.fetch(app.discordId);
                let text;
                if (status === "accepted"){
                    const inClan = profile?.player_clan === config.clan.name;
                    const next = inClan
                        ? " Welcome, you are already in the clan in game."
                        : " If you have not done it yet, request to join in game: profile → clan → search `cute`. Your Discord roles update automatically once you are in.";
                    text = `🎉 Your application to **[cute]** was accepted!${next}`;
                }
                else {
                    const why = reason ? `\nReason: ${reason}` : "";
                    text = `Your application to **[cute]** was not accepted.${why}\nYou can apply again in ${config.clan.cooldown_days} days.`;
                }
                await user.send(text);
            },
            editEmbed: async(decided, result) => {
                const channel = await guild.channels.fetch(decided.channelId ?? "").catch(() => null);
                const message = channel?.isTextBased() ? await channel.messages.fetch(decided.messageId ?? "").catch(() => null) : null;
                if (!message) return;
                await message.edit({
                    embeds: [buildApplicationEmbed(decided, profile, { status, reviewerId: decided.reviewerId ?? "", reason, decidedAt: decided.decidedAt ?? Date.now(), ...result })],
                    components: [decisionComponents(decided.id, true)],
                });
            },
        },
    });
};

/**
 * Accept / Reject buttons
 *
 * @param {import("discord.js").ButtonInteraction} interaction
 */
export const handleApplicationDecision = async function(interaction){
    const { member } = /** @type {{ member: import("discord.js").GuildMember | null }} */ (interaction);
    if (!mayDecide(member, interaction.channelId)){
        await whisper(interaction, "You are not allowed to decide applications.");
        return;
    }

    const accept = interaction.customId.startsWith(ACCEPT_PREFIX);
    const id = Number(interaction.customId.slice(accept ? ACCEPT_PREFIX.length : REJECT_PREFIX.length));
    const app = getApplication(getClanDb(), id);
    if (!app){
        await whisper(interaction, "Unknown application.");
        return;
    }
    if (app.status !== "pending"){
        await whisper(interaction, `Already ${app.status}.`);
        return;
    }

    if (!accept){
        const modal = new ModalBuilder().setCustomId(REJECT_MODAL_PREFIX + id).setTitle(`Reject ${app.playerName}`);
        const reason = new TextInputBuilder().setCustomId("reason").setLabel("Reason (optional, sent to the applicant)").setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500);
        modal.addComponents(/** @type {ActionRowBuilder<import("discord.js").ModalActionRowComponentBuilder>} */ (new ActionRowBuilder()).addComponents(reason));
        await interaction.showModal(modal);
        return;
    }

    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
    await decide(interaction, app, "accepted", null);
    await whisper(interaction, `Accepted #${id}.`);
};

/**
 * Reject modal submit
 *
 * @param {import("discord.js").ModalSubmitInteraction} interaction
 */
export const handleRejectModal = async function(interaction){
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
    const { member } = /** @type {{ member: import("discord.js").GuildMember | null }} */ (interaction);
    if (!mayDecide(member, interaction.channelId ?? "")){
        await whisper(interaction, "You are not allowed to decide applications.");
        return;
    }
    const id = Number(interaction.customId.slice(REJECT_MODAL_PREFIX.length));
    const app = getApplication(getClanDb(), id);
    if (!app){
        await whisper(interaction, "Unknown application.");
        return;
    }
    if (app.status !== "pending"){
        await whisper(interaction, `Already ${app.status}.`);
        return;
    }
    const reason = interaction.fields.getTextInputValue("reason")?.trim() || null;
    await decide(interaction, app, "rejected", reason);
    await whisper(interaction, `Rejected #${id}.`);
};
