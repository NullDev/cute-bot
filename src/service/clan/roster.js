import { rememberName } from "./identity.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

export const RANK = Object.freeze({ RECRUIT: 0, SOLDIER: 1, CAPTAIN: 2, COMMANDER: 3 });

/**
 * @typedef {Object} RosterMember
 * @property {number} playerId
 * @property {string} playerName
 * @property {number} rank
 * @property {number} score
 * @property {number} s7
 * @property {boolean} hacker
 */

/**
 * @typedef {Object} Roster
 * @property {number} clanId
 * @property {string} clanName
 * @property {RosterMember[]} members
 * @property {string[]} unresolved
 */

/**
 * Look a name up in the local cache
 *
 * @param {import("better-sqlite3").Database} db
 * @param {string} name
 * @return {number | null}
 */
const cachedId = function(db, name){
    return db.prepare("select player_id from player_names where player_name = ? collate nocase").get(name)?.player_id ?? null;
};

/**
 * Fetch the clan roster and attach player ids
 *
 * @param {import("better-sqlite3").Database} db
 * @param {import("./krunkerApi.js").KrunkerApi} api
 * @param {{ clanName: string, now?: number }} options
 * @return {Promise<Roster>}
 */
export const fetchRoster = async function(db, api, { clanName, now = Date.now() }){
    const clan = await api.getClan(clanName);
    if (!clan?.members?.length) throw new Error(`Roster of clan "${clanName}" is empty or unavailable`);

    /** @type {RosterMember[]} */
    const members = [];
    /** @type {string[]} */
    const unresolved = [];

    for (const m of clan.members){
        let playerId = cachedId(db, m.p);
        if (!playerId){
            const profile = await api.getPlayer(m.p).catch(() => null);
            if (!profile?.player_id){
                unresolved.push(m.p);
                continue;
            }
            playerId = profile.player_id;
            rememberName(db, playerId, profile.player_name, now);
        }
        members.push({
            playerId,
            playerName: m.p,
            rank: m.p === clan.creator_name ? RANK.COMMANDER : Number(m.r) || 0,
            score: Number(m.s) || 0,
            s7: Number(m.s7) || 0,
            hacker: !!m.h,
        });
    }

    return { clanId: clan.clan_id, clanName: clan.clan_name, members, unresolved };
};

/**
 * Index a roster by player id
 *
 * @param {{ members: Array<{ playerId: number }> }} roster
 * @return {Map<number, any>}
 */
export const rosterByPlayerId = function(roster){
    return new Map(roster.members.map(m => [m.playerId, m]));
};
