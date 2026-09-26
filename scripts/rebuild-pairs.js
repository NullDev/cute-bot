#!/usr/bin/node
import fs from "node:fs";
import { MessageLearner } from "../src/ai/MsgLearn.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

const DB_PATH = "./data/brain.sqlite";

if (!fs.existsSync(DB_PATH)){
    console.error(`No database at ${DB_PATH}`);
    process.exit(1);
}

const brain = new MessageLearner();
await brain.init();
const { db } = brain;

// flush WAL into the main file so the backup is complete
db.pragma("wal_checkpoint(TRUNCATE)");
const backup = `${DB_PATH}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
fs.copyFileSync(DB_PATH, backup);
console.log(`Backup written to ${backup}`);

const before = /** @type {{ n: number }} */ (db.prepare("SELECT COUNT(*) AS n FROM pairs").get()).n;

/** @type {Array<{ id: string, channelId: string, content: string, authorId: string, replyToId: string | null, ts: number }>} */
const rows = db.prepare(
    "SELECT id, channelId, content, authorId, replyToId, ts FROM messages WHERE content != '' ORDER BY channelId, ts, id",
).all();
console.log(`Loaded ${rows.length} messages.`);

const byId = new Map(rows.map((r) => [r.id, r]));

/** @type {Array<[string, string, number]>} */
const pairs = [];
let skippedJunk = 0;

let channel = null;
/** @type {typeof rows[0] | null} */
let last1 = null; // most recent message in channel
/** @type {typeof rows[0] | null} */
let last2 = null; // most recent message in channel by an author other than last1's

for (const msg of rows){
    if (msg.channelId !== channel){
        channel = msg.channelId;
        last1 = null;
        last2 = null;
    }

    const junk = brain.isBotCommand(msg.content) || brain.isLatex(msg.content);
    if (junk) skippedJunk++;

    if (!junk){
        let parent = null;

        if (msg.replyToId){
            const ref = byId.get(msg.replyToId);
            if (ref?.content && !brain.isBotCommand(ref.content) && !brain.isLatex(ref.content)){
                parent = ref;
            }
        }
        else {
            const prev = last1 && last1.authorId !== msg.authorId ? last1 : last2;
            if (prev?.content){
                const dt = Math.max(0, msg.ts - prev.ts);
                if (brain.shouldPairAdjacent(prev.content, msg.content, dt)) parent = prev;
            }
        }

        if (parent && parent.content !== msg.content){
            pairs.push([parent.content, msg.content, msg.ts]);
        }
    }

    // junk messages are not eligible as parents either, so they never enter the window
    if (junk) continue;
    if (last1 && last1.authorId !== msg.authorId) last2 = last1;
    last1 = msg;
}

console.log(`Derived ${pairs.length} pairs (skipped ${skippedJunk} bot-command/LaTeX messages).`);

const insert = db.prepare("INSERT INTO pairs (parentKey, reply, ts) VALUES (?, ?, ?)");
db.transaction(() => {
    db.exec("DELETE FROM pairs");
    db.exec("DELETE FROM sqlite_sequence WHERE name = 'pairs'");
    for (const p of pairs) insert.run(...p);
})();

console.log("Vacuuming…");
db.exec("VACUUM");

const after = /** @type {{ n: number }} */ (db.prepare("SELECT COUNT(*) AS n FROM pairs").get()).n;
const top = db.prepare(
    "SELECT parentKey, COUNT(*) AS n FROM pairs GROUP BY parentKey ORDER BY n DESC LIMIT 5",
).all();

console.log(`pairs: ${before} -> ${after}`);
console.log("Most common parents now:");
for (const t of top) console.log(`  ${t.n}x  ${String(t.parentKey).slice(0, 60)}`);

db.close();
console.log("Done. Restart the bot (or send a reload) so the brain picks up the new pairs.");
