import path from "node:path";
import {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ChannelType,
    MessageFlags,
    InteractionContextType,
    EmbedBuilder,
} from "discord.js";
import { QuickDB } from "quick.db";
import defaults from "../../util/defaults.js";

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
        .setDescription("(ADMIN) Send the verify prompt + verify btn to a specific channel. (OLD MESSAGE WILL BE DELETED)")
        .setContexts([InteractionContextType.Guild])
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption((option) =>
            option.setName("channel")
                .setDescription("The channel to send the message to.")
                .setRequired(true)),

    /**
     * @param {import("discord.js").ChatInputCommandInteraction} interaction
     */
    async execute(interaction){
        interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const channel = interaction.options.get("channel");
        if (!channel){
            return await interaction.editReply({
                content: "A channel is required.",
            });
        }

        let val = String(channel.value)?.match(/^<#(\d+)>$/)?.[1];

        if (!val) val = (await interaction.guild?.channels.fetch().catch(() => null))?.find(ch => ch?.name === channel.value && ch?.type === ChannelType.GuildText)?.id;
        if (!val){
            return await interaction.editReply({
                content: "I can't find the specified channel.",
            });
        }

        const ch = /** @type {import("discord.js").TextChannel} */ (await interaction.guild?.channels.fetch(val).catch(() => null));
        if (!ch){
            return await interaction.editReply({
                content: "I can't find the specified channel.",
            });
        }

        const embed = new EmbedBuilder()
            .setColor(defaults.embed_color)
            .setTitle("🔷┃Verification")
            .setDescription("### Hey cutie!\n⚔️┃Welcome to the **`[cute]` Discord**!\n🛡️┃To gain access to the server,\n🌐┃please **click the button** below and **fill out the form**.")
            .setImage("attachment://upsell.gif")
            .setFooter({
                text: "if u need help just ask a mod or smth idk",
                iconURL: "attachment://icon.png",
            });

        const message = await ch.send({
            files: [
                {
                    attachment: "assets/banner-crop.jpg",
                    name: "banner-crop.jpg",
                },
                {
                    attachment: "assets/upsell.gif",
                    name: "upsell.gif",
                },
                {
                    attachment: "assets/icon.png",
                    name: "icon.png",
                },
            ],
            embeds: [embed],
            components: [
                {
                    type: 1,
                    components: [
                        {
                            type: 2,
                            style: 3,
                            label: "Verify",
                            custom_id: "verify",
                        },
                    ],
                },
            ],
        });

        const oldMessage = await db.get(`guild-${interaction.guildId}.verify_message`);
        if (oldMessage){
            await ch.messages.delete(oldMessage).catch(() => null);
        }

        await db.set(`guild-${interaction.guildId}.verify_message`, message.id);

        return await interaction.editReply({
            content: "Message has been sent to <#" + val + ">",
        });
    },
};
