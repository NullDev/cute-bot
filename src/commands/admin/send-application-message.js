import path from "node:path";
import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, InteractionContextType, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { QuickDB } from "quick.db";
import defaults from "../../util/defaults.js";
import { APPLY_BUTTON } from "../../service/clan/applicationFlow.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

const db = new QuickDB({
    filePath: path.resolve("./data/guild_data.sqlite"),
});

const commandName = import.meta.url.split("/").pop()?.split(".").shift() ?? "";

export default {
    data: new SlashCommandBuilder()
        .setName(commandName)
        .setDescription("(ADMIN) Send the clan application prompt + button to a channel. (OLD MESSAGE WILL BE DELETED)")
        .setContexts([InteractionContextType.Guild])
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addChannelOption(o => o.setName("channel").setDescription("The channel to send the message to.").setRequired(true)),

    /**
     * @param {import("discord.js").ChatInputCommandInteraction} interaction
     */
    async execute(interaction){
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const channel = interaction.options.getChannel("channel", true);
        if (!("send" in channel)) return await interaction.editReply("That is not a text channel.");

        const embed = new EmbedBuilder()
            .setColor(defaults.embed_color)
            .setTitle("📨┃Apply to [cute]")
            .setDescription("### Wanna join?\n⚔️┃Click the button and fill out the form.\n🛡️┃A mod will review it and DM you the result.\n🌐┃If accepted, request to join in game too (profile → clan → search `cute`).")
            .setFooter({ text: "if u need help just ask a mod or smth idk" });

        const row = /** @type {ActionRowBuilder<ButtonBuilder>} */ (new ActionRowBuilder()).addComponents(
            new ButtonBuilder().setCustomId(APPLY_BUTTON).setLabel("📝 Apply").setStyle(ButtonStyle.Primary),
        );

        const message = await /** @type {import("discord.js").TextChannel} */ (channel).send({ embeds: [embed], components: [row] });

        const old = await db.get(`guild-${interaction.guildId}.application_message`);
        if (old) await /** @type {import("discord.js").TextChannel} */ (channel).messages.delete(old).catch(() => null);
        await db.set(`guild-${interaction.guildId}.application_message`, message.id);

        return await interaction.editReply(`Message has been sent to <#${channel.id}>`);
    },
};
