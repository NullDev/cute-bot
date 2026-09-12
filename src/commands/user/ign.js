import path from "node:path";
import { QuickDB } from "quick.db";
import { SlashCommandBuilder, InteractionContextType } from "discord.js";
import defaults from "../../util/defaults.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

const commandName = import.meta.url.split("/").pop()?.split(".").shift() ?? "";

const db = new QuickDB({
    filePath: path.resolve("./data/guild_data.sqlite"),
});

export default {
    data: new SlashCommandBuilder()
        .setName(commandName)
        .setDescription("Get the IGN of a Discord user")
        .setContexts([InteractionContextType.Guild])
        .addUserOption(option =>
            option.setName("username")
                .setDescription("The Discord username of the user you want to get the IGN for.")
                .setRequired(true),
        ),
    /**
     * @param {import("discord.js").ChatInputCommandInteraction} interaction
     */
    async execute(interaction){
        if (!interaction.deferred && !interaction.replied){
            await interaction.deferReply();
        }

        const username = interaction.options.getUser("username");
        if (!username){
            await interaction.editReply("❌ Could not find that user.");
            return;
        }

        const ign = await db.get(`guild-${interaction.guildId}.user-${username.id}.username`).catch(() => null);


        const embed = {
            color: defaults.embed_color,
            title: ":sparkles:┃Krunker Username",
            description: `:heavy_minus_sign::heavy_minus_sign::heavy_minus_sign: \n${
                username.displayName
            }'s Krunker IGN is ${
                (!!ign ? "`" + ign + "`" : "not set")
            }. \n:heavy_minus_sign::heavy_minus_sign::heavy_minus_sign:`,
            footer: {
                text: `Requested by ${interaction.user.displayName ?? interaction.user.tag}`,
                icon_url: interaction.user.displayAvatarURL(),
            },
        };

        if (interaction.deferred){
            await interaction.editReply({ embeds: [embed] });
            return;
        }

        await interaction.reply({ embeds: [embed] });
        return;
    },
};
