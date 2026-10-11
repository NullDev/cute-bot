import {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, MessageFlags, ModalBuilder, PermissionFlagsBits, TextInputBuilder, TextInputStyle, ThreadAutoArchiveDuration,
} from "discord.js";
import Log from "../../util/log.js";
import defaults from "../../util/defaults.js";
import { config } from "../../../config/config.js";
import { api } from "./krunkerApi.js";
import { profileUrl, statsText, turfText } from "./statsCard.js";
import { evaluatePlayer } from "./evaluatePlayer.js";
import { mainClan } from "./clans.js";
import { buildEvaluationEmbed } from "./evaluate.js";

export { profileUrl };
import { getClanDb } from "./db.js";
import { getLinkByDiscord, suggestIgns } from "./identity.js";
import { fetchRoster, rosterByPlayerId } from "./roster.js";
import { syncOneMember } from "./sync.js";
import { canApply, createApplication, setApplicationMessage, getApplication, finalizeDecision, setInterviewChannel } from "./applications.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

export const APPLY_BUTTON = "apply";
export const APPLY_MODAL = "application_submit";
export const ACCEPT_PREFIX = "application_accept:";
export const REJECT_PREFIX = "application_reject:";
export const REJECT_MODAL_PREFIX = "application_reject_modal:";
export const EVALUATE_PREFIX = "application_eval:";
export const INTERVIEW_PREFIX = "application_interview:";
export const INTERVIEW_CLOSE_PREFIX = "application_interview_close:";
export const VOTE_REACTIONS = ["👍", "👎"];

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
 * @param {string} [url] profile page, added as a link button when given
 * @return {ActionRowBuilder<ButtonBuilder>}
 */
export const decisionComponents = function(id, disabled, url){
    const row = /** @type {ActionRowBuilder<ButtonBuilder>} */ (new ActionRowBuilder()).addComponents(
        new ButtonBuilder().setCustomId(ACCEPT_PREFIX + id).setLabel("Accept").setStyle(ButtonStyle.Success).setDisabled(disabled),
        new ButtonBuilder().setCustomId(REJECT_PREFIX + id).setLabel("Reject").setStyle(ButtonStyle.Danger).setDisabled(disabled),
    );
    row.addComponents(new ButtonBuilder().setCustomId(EVALUATE_PREFIX + id).setLabel("Show Evaluation").setStyle(ButtonStyle.Secondary));
    row.addComponents(new ButtonBuilder().setCustomId(INTERVIEW_PREFIX + id).setLabel("Start Interview").setStyle(ButtonStyle.Secondary));
    if (url) row.addComponents(new ButtonBuilder().setLabel("Profile").setStyle(ButtonStyle.Link).setURL(url));
    return row;
};

/**
 * Discord channel name for a follow-up channel: lowercase, dashes, at most 100 chars
 *
 * @param {number} id
 * @param {string} playerName
 * @return {string}
 */
export const interviewChannelName = function(id, playerName){
    const slug = playerName.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
    return `app-${id}${slug ? `-${slug}` : ""}`.slice(0, 100);
};

const INTERVIEW_ALLOW = [
    PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.UseExternalEmojis,
    PermissionFlagsBits.UseExternalStickers, PermissionFlagsBits.AddReactions,
];

/**
 * Permission overwrites of a follow-up channel: hidden from everyone, open to the applicant, both application roles and the bot
 *
 * @param {{ guildId: string, applicantId: string, botId: string, roleIds: string[] }} input
 * @return {Array<{ id: string, allow?: bigint[], deny?: bigint[] }>}
 */
export const interviewOverwrites = function({ guildId, applicantId, botId, roleIds }){
    return [
        { id: guildId, deny: [PermissionFlagsBits.ViewChannel] },
        { id: applicantId, allow: INTERVIEW_ALLOW },
        { id: botId, allow: [...INTERVIEW_ALLOW, PermissionFlagsBits.ManageChannels] },
        ...roleIds.filter(Boolean).map(id => ({ id, allow: INTERVIEW_ALLOW })),
    ];
};

/**
 * Role ids pinged on new applications and given access to follow-up channels
 *
 * @return {string[]}
 */
const reviewerRoleIds = () => [config.ids.clan.applications_role, config.ids.clan.applications_role_review].filter(Boolean);

/**
 * Application embed, with the decision when there is one
 *
 * @param {import("./applications.js").Application} app
 * @param {any} profile player profile or null
 * @param {{ status: string, reviewerId: string, reason: string | null, decidedAt: number, rolesOk?: boolean, dmOk?: boolean, rolesError?: string | null } | null} decision
 * @param {any} [turf=null] result of getTurfPlayer for the applicant, or null
 * @param {string} [clanName] clan the application is for, defaults to the main server's clan
 * @return {EmbedBuilder}
 */
export const buildApplicationEmbed = function(app, profile, decision, turf = null, clanName = mainClan()?.name ?? ""){
    const a = app.answers;

    let color = defaults.embed_color;
    if (decision) color = decision.status === "accepted" ? "Green" : "Red";

    const embed = new EmbedBuilder()
        .setTitle(`📨┃Application #${app.id}: ${app.playerName}`)
        .setURL(profileUrl(app.playerName))
        .setColor(color)
        .setDescription(`Applicant: <@${app.discordId}>\nIGN: \`${app.playerName}\` (id ${app.playerId}) · [profile](${profileUrl(app.playerName)})`)
        .addFields(
            { name: "Stats", value: statsText(profile, clanName) },
            { name: "Turf (this season)", value: turfText(turf) },
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

    /** @type {any} */
    let profile;
    try {
        profile = await api.getPlayer(answers.ign);
    }
    catch (e){
        Log.error("[CLAN] application submit: Krunker API error: ", e instanceof Error ? e : new Error(String(e)));
        await whisper(interaction, "The Krunker API is unavailable right now, please try again later.");
        return;
    }
    if (!profile?.player_id){
        const suggestions = await suggestIgns(api, answers.ign);
        const hint = suggestions.length ? ` Did you mean: ${suggestions.map(s => `\`${s}\``).join(", ")}?` : "";
        await whisper(interaction, `There is no Krunker player named \`${answers.ign}\`.${hint}`);
        return;
    }

    const clan = mainClan();
    if (!clan){
        await whisper(interaction, "No clan is configured, please tell a mod.");
        return;
    }
    const roster = await fetchRoster(db, api, { clanName: clan.name }).catch(() => null);
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
        const turf = await api.getTurfPlayer(profile.player_id).catch(() => null);
        const roleIds = reviewerRoleIds();
        const message = await channel.send({
            content: `${roleIds.map(r => `<@&${r}>`).join(" ")} New application from <@${interaction.user.id}>`.trim(),
            allowedMentions: { roles: roleIds, users: [] },
            embeds: [buildApplicationEmbed(app, profile, null, turf, clan.name)],
            components: [decisionComponents(id, false, profileUrl(app.playerName))],
        });
        // informal vote only, nothing reads these
        for (const emoji of VOTE_REACTIONS) await message.react(emoji).catch(() => null);
        setApplicationMessage(db, id, channel.id, message.id);
        // a thread per application for the reviewers to talk in; failures (missing permission) do not block the application
        await message.startThread({ name: `#${id} ${app.playerName}`.slice(0, 100), autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek })
            .catch(e => Log.warn(`[CLAN] Could not start a thread for application #${id}: ${e instanceof Error ? e.message : String(e)}`));
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
    const turf = profile ? await api.getTurfPlayer(profile.player_id).catch(() => null) : null;

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
                    const inClan = profile?.player_clan === mainClan()?.name;
                    const next = inClan
                        ? " Welcome, you are already in the clan in game."
                        : " If you have not done it yet, request to join in game: profile → clan → search `cute`. Your Discord roles update automatically once you are in.";
                    text = `🎉 Your application to **[cute]** was accepted!${next}`;
                }
                else {
                    const why = reason ? `\nReason: ${reason}` : "";
                    text = `Sadly your application to **[cute]** was not accepted, sorry.${why}`;
                }
                await user.send(text);
            },
            editEmbed: async(decided, result) => {
                const channel = await guild.channels.fetch(decided.channelId ?? "").catch(() => null);
                const message = channel?.isTextBased() ? await channel.messages.fetch(decided.messageId ?? "").catch(() => null) : null;
                if (!message) return;
                await message.edit({
                    embeds: [buildApplicationEmbed(decided, profile, { status, reviewerId: decided.reviewerId ?? "", reason, decidedAt: decided.decidedAt ?? Date.now(), ...result }, turf)],
                    components: [decisionComponents(decided.id, true, profileUrl(decided.playerName))],
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
    try {
        await decide(interaction, app, "accepted", null);
    }
    catch (e){
        Log.warn(`[CLAN] Could not accept application #${id}: ${e instanceof Error ? e.message : String(e)}`);
        await whisper(interaction, "Could not record the decision: " + (e instanceof Error ? e.message : String(e)));
        return;
    }
    await whisper(interaction, `Accepted #${id}.`);
};

/**
 * Evaluation button: a would-be verdict for the applicant, visible only to the clicker, open to everyone
 *
 * @param {import("discord.js").ButtonInteraction} interaction
 */
export const handleApplicationEvaluate = async function(interaction){
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
    const id = Number(interaction.customId.slice(EVALUATE_PREFIX.length));
    const app = getApplication(getClanDb(), id);
    if (!app){
        await whisper(interaction, "Unknown application.");
        return;
    }
    let profile;
    try {
        profile = await api.getPlayer(app.playerName);
    }
    catch {
        await whisper(interaction, "The Krunker API is unavailable right now, please try again later.");
        return;
    }
    if (!profile?.player_id){
        await whisper(interaction, `No Krunker player named \`${app.playerName}\` any more.`);
        return;
    }
    const clan = mainClan();
    if (!clan){
        await whisper(interaction, "No clan is configured, please tell a mod.");
        return;
    }
    try {
        const evaluation = await evaluatePlayer({ db: getClanDb(), api, guildId: interaction.guildId ?? "", clan, profile });
        await interaction.editReply({ embeds: [buildEvaluationEmbed({ ...evaluation, profile })] });
    }
    catch (e){
        Log.warn(`[CLAN] evaluation of application #${id} failed: ${e instanceof Error ? e.message : String(e)}`);
        await whisper(interaction, `Could not evaluate: ${e instanceof Error ? e.message : String(e)}`);
    }
};

/**
 * Interview button: open a private follow-up channel for the applicant and the application roles
 *
 * @param {import("discord.js").ButtonInteraction} interaction
 */
export const handleInterviewOpen = async function(interaction){
    const { member, guild } = /** @type {{ member: import("discord.js").GuildMember | null, guild: import("discord.js").Guild | null }} */ (interaction);
    if (!guild || !mayDecide(member, interaction.channelId)){
        await whisper(interaction, "You are not allowed to open follow-up channels.");
        return;
    }
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
    const db = getClanDb();
    const id = Number(interaction.customId.slice(INTERVIEW_PREFIX.length));
    const app = getApplication(db, id);
    if (!app){
        await whisper(interaction, "Unknown application.");
        return;
    }
    if (app.interviewChannelId){
        const existing = await guild.channels.fetch(app.interviewChannelId).catch(() => null);
        if (existing){
            await whisper(interaction, `There is already a follow-up channel: <#${existing.id}>`);
            return;
        }
        setInterviewChannel(db, id, null);
    }
    if (!config.ids.clan.clan_category){
        await whisper(interaction, "No category configured for follow-up channels (ids.clan.clan_category).");
        return;
    }
    const roleIds = reviewerRoleIds();
    try {
        const created = await guild.channels.create({
            name: interviewChannelName(id, app.playerName),
            type: ChannelType.GuildText,
            parent: config.ids.clan.clan_category,
            topic: `Follow-up for application #${id} (${app.playerName})`,
            permissionOverwrites: interviewOverwrites({ guildId: guild.id, applicantId: app.discordId, botId: interaction.client.user.id, roleIds }),
            reason: `application #${id} follow-up opened by ${interaction.user.tag}`,
        });
        setInterviewChannel(db, id, created.id);
        await created.send({
            content: `${roleIds.map(r => `<@&${r}>`).join(" ")} <@${app.discordId}>\nFollow-up for application **#${id}** (\`${app.playerName}\`). Ask your questions here; a reviewer closes this channel with the button when done.`,
            allowedMentions: { roles: roleIds, users: [app.discordId] },
            components: [/** @type {ActionRowBuilder<ButtonBuilder>} */ (new ActionRowBuilder()).addComponents(
                new ButtonBuilder().setCustomId(INTERVIEW_CLOSE_PREFIX + id).setLabel("Close channel").setStyle(ButtonStyle.Danger),
            )],
        });
        await whisper(interaction, `Opened <#${created.id}>`);
    }
    catch (e){
        Log.error("[CLAN] Could not open a follow-up channel: ", e instanceof Error ? e : new Error(String(e)));
        await whisper(interaction, `Could not open the channel: ${e instanceof Error ? e.message : String(e)}`);
    }
};

/**
 * Close button inside a follow-up channel: deletes the channel
 *
 * @param {import("discord.js").ButtonInteraction} interaction
 */
export const handleInterviewClose = async function(interaction){
    const { member } = /** @type {{ member: import("discord.js").GuildMember | null }} */ (interaction);
    if (!member?.roles.cache.has(config.ids.clan.applications_role)){
        await whisper(interaction, "You are not allowed to close this channel.");
        return;
    }
    const id = Number(interaction.customId.slice(INTERVIEW_CLOSE_PREFIX.length));
    await interaction.deferUpdate().catch(() => null);
    const { channel } = interaction;
    if (channel && "delete" in channel){
        await channel.delete(`application #${id} follow-up closed by ${interaction.user.tag}`).catch(e => Log.warn(`[CLAN] Could not delete follow-up channel: ${e instanceof Error ? e.message : String(e)}`));
    }
    setInterviewChannel(getClanDb(), id, null);
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
    try {
        await decide(interaction, app, "rejected", reason);
    }
    catch (e){
        Log.warn(`[CLAN] Could not reject application #${id}: ${e instanceof Error ? e.message : String(e)}`);
        await whisper(interaction, "Could not record the decision: " + (e instanceof Error ? e.message : String(e)));
        return;
    }
    await whisper(interaction, `Rejected #${id}.`);
};
