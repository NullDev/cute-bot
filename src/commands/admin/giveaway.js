import path from "node:path";
import {
    SlashCommandBuilder,
    PermissionFlagsBits,
    MessageFlags,
    InteractionContextType,
} from "discord.js";
import Log from "../../util/log.js";
import {
    giveawayDb,
    computeDrawTime,
    buildGiveawayEmbed,
    buildGiveawayComponents,
} from "../../service/giveaway.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

const commandName = import.meta.url.split("/").pop()?.split(".").shift() ?? "";

export default {
    data: new SlashCommandBuilder()
        .setName(commandName)
        .setDescription("(ADMIN) Start a giveaway in this channel. Winner is drawn at 13:37 on the last day.")
        .setContexts([InteractionContextType.Guild])
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addIntegerOption((option) =>
            option.setName("days")
                .setDescription("Duration in days")
                .setMinValue(1)
                .setMaxValue(365)
                .setRequired(true))
        .addStringOption((option) =>
            option.setName("description")
                .setDescription("What's being given away. Use \\n for line breaks.")
                .setMaxLength(3500)
                .setRequired(true))
        .addAttachmentOption((option) =>
            option.setName("image")
                .setDescription("Optional image for the embed")
                .setRequired(false))
        .addRoleOption((option) =>
            option.setName("role")
                .setDescription("Optional role participants must have (on top of being verified)")
                .setRequired(false)),

    /**
     * @param {import("discord.js").ChatInputCommandInteraction} interaction
     */
    async execute(interaction){
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const days = interaction.options.getInteger("days", true);
        const description = interaction.options.getString("description", true).replaceAll("\\n", "\n");
        const image = interaction.options.getAttachment("image");
        const role = interaction.options.getRole("role");

        const { channel } = interaction;
        if (!channel || !channel.isSendable()){
            return await interaction.editReply({
                content: "I can't send messages in this channel.",
            });
        }

        if (image && !image.contentType?.startsWith("image/")){
            return await interaction.editReply({
                content: "The attachment needs to be an image.",
            });
        }

        const imageName = image ? `giveaway${path.extname(image.name).toLowerCase() || ".png"}` : null;

        /** @type {import("../../service/giveaway.js").Giveaway} */
        const gw = {
            guildId: interaction.guildId ?? "",
            channelId: channel.id,
            hostId: interaction.user.id,
            hostName: interaction.user.displayName,
            description,
            image: imageName,
            requiredRoleId: role?.id ?? null,
            endsAt: computeDrawTime(days),
            participants: [],
            ended: false,
        };

        const files = [
            {
                attachment: "assets/icon.png",
                name: "icon.png",
            },
        ];
        // re-upload instead of linking, because interaction attachment URLs expire
        if (image && imageName) files.push({ attachment: image.url, name: imageName });

        const message = await channel.send({
            files,
            embeds: [buildGiveawayEmbed(gw)],
            components: buildGiveawayComponents(false),
        });

        await giveawayDb.set(message.id, gw);

        Log.done(`Giveaway ${message.id} started by ${interaction.user.displayName}, drawn at ${new Date(gw.endsAt).toISOString()}`);

        return await interaction.editReply({
            content: `Giveaway started! Winner is drawn <t:${Math.floor(gw.endsAt / 1000)}:F>.`,
        });
    },
};
