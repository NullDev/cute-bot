import path from "node:path";
import { QuickDB } from "quick.db";
import sendVerifyModal from "../service/sendVerifyModal.js";
import handleVerification from "../service/handleVerification.js";
import handleGiveawayJoin from "../service/handleGiveawayJoin.js";
import handleGiveawayParticipants from "../service/handleGiveawayParticipants.js";
import Log from "../util/log.js";
import {
    APPLY_BUTTON, APPLY_MODAL, ACCEPT_PREFIX, REJECT_PREFIX, REJECT_MODAL_PREFIX,
    sendApplicationModal, handleApplicationSubmit, handleApplicationDecision, handleRejectModal,
} from "../service/clan/applicationFlow.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

const statDb = new QuickDB({
    filePath: path.resolve("./data/cmd_stats.sqlite"),
});

/**
 * Handle command Interaction events
 *
 * @param {import("discord.js").ChatInputCommandInteraction} interaction
 * @return {Promise<void>}
 */
const handleCommandInteraction = async function(interaction){
    const command = /** @type {import("../service/client.js").default} */ (interaction.client)
        .commands.get(interaction.commandName);

    if (!command){
        Log.warn(`No command matching ${interaction.commandName} was found.`);
        await interaction.reply({ content: `I don't seem to know the command "${interaction.commandName}"`, ephemeral: true });
        return;
    }

    try {
        await statDb.add(interaction.commandName, 1);
        await command.execute(interaction);
    }
    catch (error){
        const err = error instanceof Error ? error : new Error(String(error));
        Log.error("Error during command execution: ", err);
        if (interaction.replied || interaction.deferred){
            await interaction.followUp({ content: "There was an error while executing this command! =(", ephemeral: true });
        }
        else {
            await interaction.reply({ content: "There was an error while executing this command! =(", ephemeral: true });
        }
    }
};

/**
 * Handle modal submit events
 *
 * @param {import("discord.js").ModalSubmitInteraction} interaction
 */
const handleModalSubmit = async function(interaction){
    if (interaction.customId === "submit_into") await handleVerification(interaction);
    if (interaction.customId === APPLY_MODAL) await handleApplicationSubmit(interaction);
    if (interaction.customId.startsWith(REJECT_MODAL_PREFIX)) await handleRejectModal(interaction);
};

/**
 * Handle button interactions
 *
 * @param {import("discord.js").ButtonInteraction} interaction
 */
const handleButtonInteraction = async function(interaction){
    if (interaction.customId === "verify") await sendVerifyModal(interaction);
    if (interaction.customId === APPLY_BUTTON) await sendApplicationModal(interaction);
    if (interaction.customId.startsWith(ACCEPT_PREFIX) || interaction.customId.startsWith(REJECT_PREFIX)) await handleApplicationDecision(interaction);
    if (interaction.customId === "giveaway_join") await handleGiveawayJoin(interaction);
    if (interaction.customId.startsWith("giveaway_participants")) await handleGiveawayParticipants(interaction);
};

/**
 * Handle interactionCreate event
 *
 * @param {import("discord.js").Interaction} interaction
 * @return {Promise<void>}
 */
const interactionCreateHandler = async function(interaction){
    if (interaction.isChatInputCommand()) await handleCommandInteraction(interaction);
    if (interaction.isModalSubmit()) await handleModalSubmit(interaction);
    if (interaction.isButton()) await handleButtonInteraction(interaction);
};

export default interactionCreateHandler;
