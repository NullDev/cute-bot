import path from "node:path";
import Database from "better-sqlite3";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

const SCHEMA = `
create table if not exists players (
    guild_id    text    not null,
    discord_id  text    not null,
    player_id   integer not null,
    player_name text    not null,
    linked_at   integer not null,
    source      text    not null,
    primary key (guild_id, discord_id),
    unique (guild_id, player_id)
);
create table if not exists player_names (
    player_id   integer primary key,
    player_name text    not null,
    seen_at     integer not null
);
create index if not exists player_names_name on player_names (player_name collate nocase);
create table if not exists snapshots (
    player_id   integer not null,
    day         integer not null,
    taken_at    integer not null,
    player_name text    not null,
    in_clan     integer not null default 0,
    clan_role   integer,
    s7          integer,
    score       integer,
    kills       integer,
    deaths      integer,
    wins        integer,
    games       integer,
    timeplayed  integer,
    nukes       integer,
    ranked_rank integer,
    online      integer,
    created_at_game text,
    primary key (player_id, day)
);
create table if not exists turf_days (
    player_id integer not null,
    day       integer not null,
    kills     integer not null default 0,
    deaths    integer not null default 0,
    games     integer not null default 0,
    primary key (player_id, day)
);
create table if not exists applications (
    id          integer primary key autoincrement,
    guild_id    text    not null,
    discord_id  text    not null,
    player_id   integer not null,
    player_name text    not null,
    answers     text    not null,
    status      text    not null,
    channel_id  text,
    message_id  text,
    reviewer_id text,
    reason      text,
    created_at  integer not null,
    decided_at  integer,
    joined_at   integer,
    reminded_at integer,
    interview_channel_id text
);
create index if not exists applications_lookup on applications (guild_id, discord_id, status);
`;

/**
 * Open (or create) a clan database at the given path
 *
 * @param {string} filePath
 * @return {import("better-sqlite3").Database}
 */
export const createClanDb = function(filePath){
    const db = new Database(filePath);
    if (filePath !== ":memory:"){
        db.pragma("journal_mode = WAL");
        db.pragma("synchronous = NORMAL");
    }
    db.exec(SCHEMA);
    // columns added after the first release, for databases created before them
    const applicationColumns = db.pragma("table_info(applications)").map((/** @type {{ name: string }} */ c) => c.name);
    if (!applicationColumns.includes("interview_channel_id")) db.exec("alter table applications add column interview_channel_id text");
    return db;
};

/** @type {import("better-sqlite3").Database | null} */
let shared = null;

/**
 * Shared clan database instance
 *
 * @return {import("better-sqlite3").Database}
 */
export const getClanDb = function(){
    if (!shared) shared = createClanDb(path.resolve("./data/clan.sqlite"));
    return shared;
};
