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
        id: 561461,
        name: "cute",
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
        },
    },
    ai_included_channels: [
        "",
    ],
};
