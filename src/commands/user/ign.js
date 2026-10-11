import { SlashCommandBuilder, InteractionContextType } from "discord.js";
import defaults from "../../util/defaults.js";
import { api } from "../../service/clan/krunkerApi.js";
import { getClanDb } from "../../service/clan/db.js";
import { getLinkByDiscord, getLinkByPlayer } from "../../service/clan/identity.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

const commandName = import.meta.url.split("/").pop()?.split(".").shift() ?? "";

/**
 * Player id for an IGN: the local name cache first, the Krunker API as fallback
 *
 * @param {import("better-sqlite3").Database} db
 * @param {string} ign
 * @return {Promise<{ playerId: number, playerName: string } | null>}
 */
const resolvePlayer = async function(db, ign){
    const cached = db.prepare("select player_id, player_name from player_names where player_name = ? collate nocase").get(ign);
    if (cached) return { playerId: cached.player_id, playerName: cached.player_name };
    const profile = await api.getPlayer(ign).catch(() => null);
    return profile?.player_id ? { playerId: profile.player_id, playerName: profile.player_name } : null;
};

export default {
    data: new SlashCommandBuilder()
        .setName(commandName)
        .setDescription("Look up the IGN of a Discord user, or the Discord user behind an IGN")
        .setContexts([InteractionContextType.Guild])
        .addUserOption(option =>
            option.setName("username")
                .setDescription("The Discord user you want to get the IGN for.")
                .setRequired(false),
        )
        .addStringOption(option =>
            option.setName("ign")
                .setDescription("The Krunker IGN you want to find the Discord user for.")
                .setRequired(false),
        ),
    /**
     * @param {import("discord.js").ChatInputCommandInteraction} interaction
     */
    async execute(interaction){
        if (!interaction.deferred && !interaction.replied){
            await interaction.deferReply();
        }

        const db = getClanDb();
        const guildId = interaction.guildId ?? "";
        const username = interaction.options.getUser("username");
        const ignOption = interaction.options.getString("ign")?.trim() ?? "";

        let description;
        if (username){
            const ign = getLinkByDiscord(db, guildId, username.id)?.playerName ?? null;
            description = `${username.displayName}'s Krunker IGN is ${ign ? "`" + ign + "`" : "not set"}.`;
        }
        else if (ignOption){
            const player = await resolvePlayer(db, ignOption);
            if (!player){
                description = `There is no Krunker player named \`${ignOption}\`.`;
            }
            else {
                const link = getLinkByPlayer(db, guildId, player.playerId);
                description = link
                    ? `\`${player.playerName}\` is linked to <@${link.discordId}>.`
                    : `\`${player.playerName}\` is not linked to any Discord user.`;
            }
        }
        else {
            await interaction.editReply("❌ Give a Discord user or an IGN.");
            return;
        }

        const embed = {
            color: defaults.embed_color,
            title: ":sparkles:┃Krunker Username",
            description: `:heavy_minus_sign::heavy_minus_sign::heavy_minus_sign: \n${description} \n:heavy_minus_sign::heavy_minus_sign::heavy_minus_sign:`,
            footer: {
                text: `Requested by ${interaction.user.displayName ?? interaction.user.tag}`,
                icon_url: interaction.user.displayAvatarURL(),
            },
        };

        await interaction.editReply({ embeds: [embed], allowedMentions: { users: [] } });
    },
};
