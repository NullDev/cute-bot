import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { KrunkerApi, KrunkerApiError, createDispatcher, turfDay, levelFromScore, TURF_EPOCH_UTC } from "../src/service/clan/krunkerApi.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

/**
 * Build a fake fetch that replays the given responses in order
 *
 * @param {Array<{ status: number, body?: any, throws?: boolean }>} responses
 * @return {{ fetchFn: Function, calls: string[] }}
 */
const fakeFetch = function(responses){
    const calls = [];
    const fetchFn = async(url, init) => {
        calls.push(url);
        const next = responses.shift();
        if (!next) throw new Error("no more responses");
        if (next.throws) throw new Error("network down");
        assert.equal(init.headers.Authorization, undefined);
        return {
            status: next.status,
            ok: next.status >= 200 && next.status < 300,
            json: async() => next.body ?? {},
        };
    };
    return { fetchFn, calls };
};

const noSleep = async() => {};

test("turfDay counts whole UTC days since 2026-03-17", () => {
    assert.equal(turfDay(new Date(TURF_EPOCH_UTC)), 0);
    assert.equal(turfDay(new Date(Date.UTC(2026, 9, 10, 12))), 207);
});

test("levelFromScore matches the in-game formula", () => {
    assert.equal(levelFromScore(19450609), 132);
    assert.equal(levelFromScore(0), 0);
});

test("getPlayer returns data on 200 and null on 404", async() => {
    const { fetchFn } = fakeFetch([
        { status: 200, body: { data: { player_id: 1, player_name: "NulPing" }, error: null } },
        { status: 404, body: { error: { code: "PLAYERS_NOT_FOUND" } } },
    ]);
    const api = new KrunkerApi({ fetchFn, sleep: noSleep });
    assert.deepEqual(await api.getPlayer("nulping"), { player_id: 1, player_name: "NulPing" });
    assert.equal(await api.getPlayer("nobody"), null);
});

test("getPlayer encodes names", async() => {
    const { fetchFn, calls } = fakeFetch([{ status: 200, body: { data: {} } }]);
    const api = new KrunkerApi({ fetchFn, sleep: noSleep });
    await api.getPlayer("영구기♥동혀니");
    assert.equal(calls[0], "https://gapi.svc.krunker.io/players/" + encodeURIComponent("영구기♥동혀니"));
});

test("get retries network errors and 5xx then throws KrunkerApiError", async() => {
    const { fetchFn, calls } = fakeFetch([
        { status: 0, "throws": true },
        { status: 503 },
        { status: 500 },
        { status: 502 },
    ]);
    const api = new KrunkerApi({ fetchFn, sleep: noSleep });
    await assert.rejects(() => api.get("/clans/by-name/cute"), KrunkerApiError);
    assert.equal(calls.length, 4);
});

test("get waits and retries on 429", async() => {
    const slept = [];
    const { fetchFn } = fakeFetch([
        { status: 429, body: { error: "Rate limit exceeded. Try again later." } },
        { status: 200, body: { data: { ok: true } } },
    ]);
    const api = new KrunkerApi({ fetchFn, sleep: async ms => { slept.push(ms); } });
    const res = await api.get("/x");
    assert.deepEqual(res.data, { ok: true });
    assert.ok(slept.includes(5000));
});

test("getTurfPlayers passes the day as query", async() => {
    const { fetchFn, calls } = fakeFetch([{ status: 200, body: { data: [] } }]);
    const api = new KrunkerApi({ fetchFn, sleep: noSleep });
    await api.getTurfPlayers(561461, 207);
    assert.equal(calls[0], "https://gapi.svc.krunker.io/territorial-wars/clan/561461/players?day=207");
});

test("concurrent get calls are spaced apart", async() => {
    const sleeps = [];
    const { fetchFn } = fakeFetch([{ status: 200, body: { data: 1 } }, { status: 200, body: { data: 2 } }]);
    const client = new KrunkerApi({ fetchFn, sleep: async ms => { sleeps.push(ms); }, spacingMs: 200 });
    await Promise.all([client.get("/a"), client.get("/b")]);
    assert.equal(sleeps.length, 1);
    assert.ok(sleeps[0] > 0 && sleeps[0] <= 200);
});

test("proxyUrl routes requests through a proxy dispatcher", async() => {
    const inits = [];
    const fetchFn = async(url, init) => {
        inits.push(init);
        return { status: 200, ok: true, json: async() => ({ data: {} }) };
    };
    const direct = new KrunkerApi({ fetchFn, sleep: noSleep });
    await direct.get("/x");
    assert.equal(inits[0].dispatcher, undefined);

    const proxied = new KrunkerApi({ fetchFn, sleep: noSleep, proxyUrl: "http://proxy.example:3128" });
    await proxied.get("/x");
    assert.ok(inits[1].dispatcher, "dispatcher set when proxyUrl is given");
    assert.equal(inits[1].dispatcher.constructor.name, "ProxyAgent");
});

/**
 * Minimal SOCKS5 server (no auth, CONNECT only) that records the destinations it was asked for
 *
 * @return {Promise<{ port: number, seen: string[], close: () => void }>}
 */
const startSocks5 = async function(){
    /** @type {string[]} */
    const seen = [];
    const server = net.createServer(client => {
        client.once("data", greeting => {
            if (greeting[0] !== 5) return client.destroy();
            client.write(Buffer.from([5, 0]));
            client.once("data", req => {
                if (req[0] !== 5 || req[1] !== 1) return client.destroy();
                let host;
                let offset;
                if (req[3] === 1){
                    host = [...req.subarray(4, 8)].join(".");
                    offset = 8;
                }
                else if (req[3] === 3){
                    const len = req[4];
                    host = req.subarray(5, 5 + len).toString();
                    offset = 5 + len;
                }
                else return client.destroy();
                const port = req.readUInt16BE(offset);
                seen.push(`${host}:${port}`);
                const upstream = net.connect(port, host, () => {
                    client.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
                    upstream.pipe(client);
                    client.pipe(upstream);
                });
                upstream.on("error", () => client.destroy());
                return undefined;
            });
            return undefined;
        });
    });
    await new Promise(r => server.listen(0, "127.0.0.1", r));
    return { port: /** @type {net.AddressInfo} */ (server.address()).port, seen, close: () => server.close() };
};

test("createDispatcher picks the agent by scheme", () => {
    assert.equal(createDispatcher(""), undefined);
    assert.equal(createDispatcher("http://proxy.example:3128")?.constructor.name, "ProxyAgent");
    assert.equal(createDispatcher("socks5://127.0.0.1:40000")?.constructor.name, "Agent");
    assert.throws(() => createDispatcher("ftp://nope"), /proxy/i);
});

test("a socks5 proxy url tunnels the request through the proxy", async() => {
    const target = http.createServer((req, res) => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ data: { path: req.url } }));
    });
    await new Promise(r => target.listen(0, "127.0.0.1", r));
    const targetPort = /** @type {net.AddressInfo} */ (target.address()).port;
    const socks = await startSocks5();

    const dispatcher = createDispatcher(`socks5://127.0.0.1:${socks.port}`);
    const res = await fetch(`http://127.0.0.1:${targetPort}/players/x`, { dispatcher });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.deepEqual(body, { data: { path: "/players/x" } });
    assert.deepEqual(socks.seen, [`127.0.0.1:${targetPort}`]);

    await dispatcher.close();
    socks.close();
    target.close();
});

