export default {
    discord: {
        bot_token: "",
        bot_owner_ids: [],
        total_shards: /** @type {number | "auto" | undefined} */ (1),
    },
    ids: {
        general_channel: "",
        bot_channel: "",
        log_channel: "",
        verified_role: "",
        clan: {
            recruit: "",
            soldier: "",
            captain: "",
            applications_role: "",
            applications_channel: "",
        },
    },
    clan: {
        // guild id of the server where everything runs (verify, applications, sync); other servers in `clans` only get the review commands
        main_server: "",
        // one entry per clan: its Discord server, Krunker clan id and tag; optional target_size per clan
        clans: [
            // { discord: "", id: 0, name: "", target_size: 100 },
        ],
        sync_enabled: false,
        api_proxy: "",
        target_size: 100,
        cooldown_days: 7,
        join_reminder_days: 3,
        join_expire_days: 14,
        review: {
            weights: { level: 1.0, nukes: 1.5, kdr: 1.0, kpg: 0.5, rank: 0.5, s7: 1.5, turf: 1.0, delta: 1.0 },
            penalties: { unlinked: 0.3 },
            roleBonus: { 0: 0, 1: 0.3, 2: 0.6, 3: 0.6 },
            protect: { nukes: 50, level: 100, rank: 2 },
            thresholds: { kick: 1.0, watch: 2.0 },
            grace_days: 7,
        },
    },
    ai_included_channels: [
        "",
    ],
};
