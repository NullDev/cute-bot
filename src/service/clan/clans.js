import { config } from "../../../config/config.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

/**
 * @typedef {Object} ClanEntry
 * @property {string} discord guild id of the Discord server that belongs to this clan
 * @property {number} id Krunker clan id
 * @property {string} name Krunker clan tag
 * @property {number} [target_size] optional override of clan.target_size
 */

/**
 * @typedef {{ main_server?: string, clans?: Array<{ discord: string | number, id: string | number, name: string, target_size?: number }>, target_size?: number }} ClanConfig
 */

/**
 * All configured clans
 *
 * @param {ClanConfig} [clanCfg=config.clan]
 * @return {ClanEntry[]}
 */
export const allClans = function(clanCfg = config.clan){
    return (clanCfg.clans ?? []).map(c => ({ ...c, discord: String(c.discord), id: Number(c.id), name: String(c.name) }));
};

/**
 * Guild id of the main server, empty when not configured
 *
 * @param {ClanConfig} [clanCfg=config.clan]
 * @return {string}
 */
export const mainGuildId = function(clanCfg = config.clan){
    return String(clanCfg.main_server ?? "");
};

/**
 * Whether a guild is the main server. Without a configured main server every guild counts as main (single-server mode).
 *
 * @param {string | null | undefined} guildId
 * @param {ClanConfig} [clanCfg=config.clan]
 * @return {boolean}
 */
export const isMainGuild = function(guildId, clanCfg = config.clan){
    const main = mainGuildId(clanCfg);
    return !main || String(guildId ?? "") === main;
};

/**
 * The clan that belongs to a guild, or null
 *
 * @param {string | null | undefined} guildId
 * @param {ClanConfig} [clanCfg=config.clan]
 * @return {ClanEntry | null}
 */
export const clanForGuild = function(guildId, clanCfg = config.clan){
    return allClans(clanCfg).find(c => c.discord === String(guildId ?? "")) ?? null;
};

/**
 * The main server's clan, or null when not configured
 *
 * @param {ClanConfig} [clanCfg=config.clan]
 * @return {ClanEntry | null}
 */
export const mainClan = function(clanCfg = config.clan){
    return clanForGuild(mainGuildId(clanCfg), clanCfg);
};

/**
 * Member count a clan aims for
 *
 * @param {ClanEntry} clan
 * @param {ClanConfig} [clanCfg=config.clan]
 * @return {number}
 */
export const clanTargetSize = function(clan, clanCfg = config.clan){
    return Number(clan.target_size ?? clanCfg.target_size ?? 100);
};

/**
 * Guild ids of every configured clan server
 *
 * @param {ClanConfig} [clanCfg=config.clan]
 * @return {string[]}
 */
export const clanGuildIds = function(clanCfg = config.clan){
    return allClans(clanCfg).map(c => c.discord);
};

/** Commands every configured clan server gets; the main server gets all of them */
export const SHARED_COMMANDS = Object.freeze(["clan-review", "clan-evaluate", "help", "info"]);
