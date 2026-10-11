import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Collection, REST, Routes } from "discord.js";
import Log from "../util/log.js";
import { clanGuildIds, mainGuildId, SHARED_COMMANDS } from "../service/clan/clans.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

/**
 * Register all slash commands
 *
 * @param {import("./client.js").default} client
 * @returns {Promise<Collection<string, import("discord.js").ApplicationCommand>>}
 */
const commandRegister = async function(client){
    client.commands = new Collection();
    const foldersPath = path.resolve("src", "commands");
    const commandFolders = await fs.readdir(foldersPath);

    for (const folder of commandFolders){
        if (folder.startsWith(".") || folder.toLowerCase() === "disabled"){
            Log.info(`Skipping folder ${folder}.`);
            continue;
        }
        const commandsPath = path.join(foldersPath, folder);
        const commandFiles = (await fs.readdir(commandsPath)).filter(file => file.endsWith(".js"));

        for (const file of commandFiles){
            const filePath = path.join(commandsPath, file);
            const prefix = os.platform() === "win32" ? "file://" : "";
            const command = (await import(prefix + filePath)).default;

            if ("data" in command && "execute" in command){
                client.commands.set(command.data.name, command);
            }
            else {
                Log.warn(`The command at ${filePath} is missing a required "data" or "execute" property.`);
            }
        }

        Log.done(`Registered ${commandFiles.length} commands in ${folder}.`);
    }

    const rest = new REST().setToken(client.token || "");
    const appId = client.user?.id || "";
    const cmdMap = client.commands.map(command => command.data.toJSON());
    const guilds = clanGuildIds();
    const main = mainGuildId();
    try {
        if (!guilds.length || !main){
            // single-server mode: everything global, as before
            Log.info("Started refreshing global application (/) commands.");
            const data = await rest.put(Routes.applicationCommands(appId), { body: cmdMap });
            Log.done("Successfully reloaded " + /** @type {Array<any>} */ (data).length + " global application (/) commands.");
        }
        else {
            // multi-server mode: nothing global, the main server gets everything, other clan servers only the shared commands
            Log.info("Started refreshing per-guild application (/) commands.");
            await rest.put(Routes.applicationCommands(appId), { body: [] });
            for (const guildId of new Set([main, ...guilds])){
                const body = guildId === main ? cmdMap : cmdMap.filter(c => SHARED_COMMANDS.includes(c.name));
                const data = await rest.put(Routes.applicationGuildCommands(appId, guildId), { body }).catch(e => {
                    Log.error(`Could not register commands in guild ${guildId}: ` + e);
                    return null;
                });
                if (data) Log.done(`Registered ${/** @type {Array<any>} */ (data).length} (/) commands in guild ${guildId}.`);
            }
        }
    }
    catch (error){
        Log.error("Error during registering of application (/) commands: " + error);
    }

    return client.commands;
};

export default commandRegister;
