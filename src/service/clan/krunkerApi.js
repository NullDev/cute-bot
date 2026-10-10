// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

export const BASE_URL = "https://gapi.svc.krunker.io";
export const TURF_EPOCH_UTC = Date.UTC(2026, 2, 17);

const RETRY_STATUSES = new Set([408, 500, 502, 503, 504, 522, 524]);
const MAX_ATTEMPTS = 4;
const BACKOFF_MS = 300;
const RATE_LIMIT_PAUSE_MS = 5000;

/**
 * Whole UTC days since the turf season epoch
 *
 * @param {Date} [date=new Date()]
 * @return {number}
 */
export const turfDay = function(date = new Date()){
    return Math.floor((date.getTime() - TURF_EPOCH_UTC) / 86400000);
};

/**
 * In-game level from total score
 *
 * @param {number} score
 * @return {number}
 */
export const levelFromScore = function(score){
    return Math.floor(0.03 * Math.sqrt(Math.max(0, Number(score) || 0)));
};

/**
 * Error thrown when gapi does not answer with a usable status
 *
 * @class KrunkerApiError
 * @extends {Error}
 */
export class KrunkerApiError extends Error {
    /**
     * @param {string} message
     * @param {number} status
     */
    constructor(message, status){
        super(message);
        this.name = "KrunkerApiError";
        this.status = status;
    }
}

/**
 * Minimal client for the public Krunker gapi
 *
 * @class KrunkerApi
 */
export class KrunkerApi {
    /**
     * @param {{ fetchFn?: typeof fetch, sleep?: (ms: number) => Promise<void>, spacingMs?: number }} [options]
     */
    constructor({ fetchFn = globalThis.fetch, sleep = ms => new Promise(r => setTimeout(r, ms)), spacingMs = 200 } = {}){
        this.fetchFn = fetchFn;
        this.sleep = sleep;
        this.spacingMs = spacingMs;
        this.lastCall = 0;
    }

    /**
     * Wait so that consecutive calls are at least spacingMs apart
     *
     * @return {Promise<void>}
     */
    async #space(){
        const wait = this.lastCall + this.spacingMs - Date.now();
        if (wait > 0) await this.sleep(wait);
        this.lastCall = Date.now();
    }

    /**
     * GET a gapi path
     *
     * @param {string} path
     * @return {Promise<{ status: number, data: any, error: any }>}
     */
    async get(path){
        let lastStatus = 0;
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++){
            await this.#space();
            let res;
            try {
                res = await this.fetchFn(BASE_URL + path, { headers: { Accept: "application/json" } });
            }
            catch {
                lastStatus = 0;
                await this.sleep(BACKOFF_MS * (2 ** attempt));
                continue;
            }
            lastStatus = res.status;
            if (res.status === 429){
                await this.sleep(RATE_LIMIT_PAUSE_MS);
                continue;
            }
            if (RETRY_STATUSES.has(res.status)){
                await this.sleep(BACKOFF_MS * (2 ** attempt));
                continue;
            }
            const body = await res.json().catch(() => ({}));
            if (res.status === 404) return { status: 404, data: null, error: body?.error ?? null };
            if (res.status < 200 || res.status >= 300) throw new KrunkerApiError(`gapi ${path} answered ${res.status}`, res.status);
            return { status: res.status, data: body?.data ?? null, error: body?.error ?? null };
        }
        throw new KrunkerApiError(`gapi ${path} failed after ${MAX_ATTEMPTS} attempts (last status ${lastStatus})`, lastStatus);
    }

    /**
     * Public clan profile
     *
     * @param {string} name
     * @return {Promise<any | null>}
     */
    async getClan(name){
        return (await this.get(`/clans/by-name/${encodeURIComponent(name)}`)).data;
    }

    /**
     * Player profile, case-insensitive name
     *
     * @param {string} name
     * @return {Promise<any | null>}
     */
    async getPlayer(name){
        return (await this.get(`/players/${encodeURIComponent(name)}`)).data;
    }

    /**
     * Player name search
     *
     * @param {string} query
     * @param {number} [limit=5]
     * @return {Promise<Array<{ player_id: number, player_name: string, player_clan?: string }>>}
     */
    async searchPlayers(query, limit = 5){
        const res = await this.get(`/players/search?q=${encodeURIComponent(query)}&limit=${limit}`);
        return res.data?.results ?? [];
    }

    /**
     * Turf rows of a clan for one day
     *
     * @param {number} clanId
     * @param {number} day
     * @return {Promise<Array<{ player_id: number, player_name: string, kills: number, deaths: number, games: number, kd: number }>>}
     */
    async getTurfPlayers(clanId, day){
        return (await this.get(`/territorial-wars/clan/${clanId}/players?day=${day}`)).data ?? [];
    }

    /**
     * Season turf payouts of a clan
     *
     * @param {number} clanId
     * @return {Promise<{ payouts: Array<{ player_id: number, player_name: string, total_kr: number }>, total: number }>}
     */
    async getTurfPayouts(clanId){
        return (await this.get(`/territorial-wars/clan/${clanId}/payouts`)).data ?? { payouts: [], total: 0 };
    }

    /**
     * Turf profile of a player, resolves an id to the current name
     *
     * @param {number} playerId
     * @return {Promise<any | null>}
     */
    async getTurfPlayer(playerId){
        return (await this.get(`/territorial-wars/player/${playerId}`)).data;
    }
}

export const api = new KrunkerApi();
