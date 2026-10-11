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
            applications_role_review: "",
            applications_channel: "",
            clan_category: "",
            clan_general: "",
            turf_role: "",
        },
    },
    clan: {
        main_server: "",
        clans: [
            // { discord: "", id: 0, name: "", target_size: 100 },
        ],
        sync_enabled: false,
        api_proxy: "",
        target_size: 100,
        cooldown_days: 7,
        join_reminder_days: 3,
        join_expire_days: 14,
        // turf reminders in ids.clan.clan_general: checks every check_minutes, status reports at these UTC hours, instant alerts on changes
        turf: {
            check_minutes: 30,
            report_hours_utc: [12, 18, 21, 23],
            hold_position: 2,
            close_margin: 100,
            max_pings_per_day: 2,
        },
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
