# Cute-Bot
[![NullDev/DiscordJS-Template](https://img.shields.io/badge/Template%3A-NullDev%2FDiscordJS--Template-green?style=flat-square&logo=github)](https://github.com/NullDev/DiscordJS-Template) [![Deployment](https://github.com/NullDev/Cute-Bot/actions/workflows/cd.yml/badge.svg)](https://github.com/NullDev/Cute-Bot/actions/workflows/cd.yml)

<p align="center"><img height="250" width="auto" src="/assets/icon.png" /></p>
<p align="center"><b>Cute Bot</b></p>
<hr>

## :question: What does it do?

Discord bot for the Cute Krunker Clan.

- Links Discord users to Krunker player ids via the verify button (`/clan-link` for manual fixes).
- Syncs the clan roles with the in-game roster every day at 03:30 UTC (`/clan-sync` for a manual or dry run).
- Snapshots every member daily and rates them with `/clan-review`.
- Takes clan applications through a button + modal, reviewed in a channel with Accept / Reject.
- Can serve other clans' Discord servers with the review and evaluate commands only (`clan.clans`); commands are registered per server, nothing is global.

#### Rollout

1. Deploy with `clan.sync_enabled: false`.
2. Run `/clan-link migrate` and ask the unresolved users to re-verify.
3. Run `/clan-sync dry_run:true` and read the "Had clan roles without a link" field.
4. Set `sync_enabled: true` in `config.custom.js` and restart.

<hr>

## :diamond_shape_with_a_dot_inside: Feature requests & Issues

Feature request or discovered a bug? Please [open an Issue](https://github.com/NullDev/Cute-Bot/issues/new/choose) here on GitHub.

<hr>

## :wrench: Setup

0. Open up your favourite terminal (and navigate somewhere you want to download the repository to). <br><br>
1. Make sure you have NodeJS installed (>= v22.0.0). Test by entering <br>
$ `node -v` <br>
If this returns a version number, NodeJS is installed. **If not**, get NodeJS <a href="https://nodejs.org/en/download/package-manager/">here</a>. <br><br>
2. Clone the repository and navigate to it. If you have Git installed, type <br>
$ `git clone https://github.com/NullDev/Cute-Bot.git && cd Cute-Bot` <br>
If not, download it <a href="https://github.com/NullDev/Cute-Bot/archive/master.zip">here</a> and extract the ZIP file.<br>
Then navigate to the folder.<br><br>
3. Install all dependencies by typing <br>
$ `npm install`<br><br>
4. Copy [config/config.template.js](https://github.com/NullDev/Cute-Bot/blob/master/config/config.template.js) and paste it as `config/config.custom.js` OR use `npm run generate-config`. <br><br>
5. Configure it in your favourite editor by editing `config/config.custom.js`. <br><br>
6. [LINUX ONLY]: Install LaTeX dependencies: <br>
$ `sudo ./setup_latex.sh` <br><br>
7. Start it in development mode by running <br>
$ `npm start` <br>
or start in production mode <br>
$ `npm run start:prod` <br>
or (recommended), use PM2 <br>
$ `pm2 start pm2.ecosystem.json` <br><br>

<hr>

## :nut_and_bolt: Configuration

Once the config has been copied like described in [Step 4](#wrench-setup), it can be changed to your needs:

| Config Key | Description | Data Type | Default value |
| ---------- | --------- | ------------------ | ------------ |
| discord: <br> `bot_token` | Auth Token of the Discord bot. Can be created [here](https://discordapp.com/developers/). | String | N/A |
| discord: <br> `bot_owner_ids` | OPTIONAL: Discord IDs of Bot owners | String-Array | [] |
| discord: <br> `total_shards` | Number of shards to use or "auto" for automatic sharding | number \| "auto" | 1 |
| ids: <br> `verified_role` | ID of the verified role | string | N/A |
| ids: <br> `bot_channel` | ID of the bot channel | string | N/A |
| ids: <br> `general_channel` | ID of the general channel | string | N/A |
| ai_included_channels | Array of channel IDs that the AI should learn from | string-array | [] |
| ids: <br> `log_channel` | ID of the log channel (sync reports go here) | string | N/A |
| ids: clan: <br> `recruit`, `soldier`, `captain` | Clan rank roles, applied cumulatively from the in-game rank | string | N/A |
| ids: clan: <br> `applications_role` | Role that may accept or reject applications | string | N/A |
| ids: clan: <br> `applications_channel` | Channel where applications are posted and decided | string | N/A |
| ids: clan: <br> `applications_role_review` | Second role that is pinged on new applications and gets access to follow-up channels (cannot decide) | string | N/A |
| ids: clan: <br> `clan_category` | Category where the Interview button creates follow-up channels for an applicant and the application roles | string | N/A |
| clan: <br> `main_server` | Guild id of the server where everything runs (verify, applications, role sync, AI) | string | N/A |
| clan: <br> `clans` | One entry per clan: `{ discord, id, name, target_size? }` with the clan's Discord server id, Krunker clan id and tag. Servers other than `main_server` only get `/clan-review`, `/clan-evaluate`, `/help` and `/info`; everything else answers "This command is not available here." | object-array | [] |
| clan: review: <br> `grace_days` | Members first seen on the roster fewer than this many days ago are kept regardless of stats | number | 7 |
| clan: <br> `sync_enabled` | Enable the automatic daily role sync; keep false until the migration and a dry run are done | boolean | false |
| clan: <br> `api_proxy` | Optional proxy URL for all Krunker API calls, for hosts whose IP Krunker's edge blocks (Cloudflare 403): `http://`, `https://`, `socks4://` or `socks5://`, for example Cloudflare WARP in proxy mode as `socks5://127.0.0.1:40000`. Empty = direct | string | "" |
| clan: <br> `target_size` | Member count the review aims for | number | 100 |
| clan: <br> `cooldown_days` | Days before a rejected applicant may apply again | number | 7 |
| clan: <br> `join_reminder_days`, `join_expire_days` | Days until an accepted applicant is reminded / expired for not joining in game | number | 3, 14 |
| clan: <br> `review` | Weights, protection rules and thresholds of `/clan-review` | object | see template |

<hr>
