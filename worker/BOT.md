# The Discord bot: what's built

Same Worker as the 1.0 webhook pings, plus Discord's HTTP interactions at `POST /interactions` (no gateway) and "Log in with Discord" (`/login…`, `src/login.js`). Setup: `SETUP.md` ("For the owner" is B0). Design and Torn's rules: `docs/discord-bot-design.md`. What the userscript must add: `USERSCRIPT-INTERFACE.md`.

## Log in with Discord (1.2.0)

The normal way in: the owner runs one Worker; a player presses **Log in with Discord** in Pumping Iron. `POST /login/start` (the browser's secret) → the userscript opens `GET /login?id=…` → Discord's authorize page (scope `identify` only, `prompt=none` so a returning player isn't asked again) → `GET /login/callback`: the code is exchanged (Basic auth with `DISCORD_CLIENT_SECRET`), `/users/@me` says who it is, and the bot checks membership of `GUILD_ID` (`GET /guilds/{id}/members/{user}`). A member gets a user row (no invite code; `MAX_USERS` still applies) linked to their Discord account. A link never moves silently: if that Discord account is linked to another browser's row, the login is refused (`elsewhere`: "Press Disconnect there, or type /unlink in Discord, then log in here again") unless that row hasn't synced for 7 days, in which case it is forgotten (all its data, as Forget) and this login takes over. The same browser logging in again is fine. The userscript asks `POST /login/status` every few seconds (`open` → `done` / `not_member` / `denied` / `full` / `failed` / `elsewhere` / `expired`), then sends the main Pumping Iron key in `PUT /plan`; `POST /login/cancel` drops a login it gave up on. Logins last 15 minutes and are single use; at most 50 open at once (past that the oldest open one makes room, so a flood can't lock people out) and 5 per address (`CF-Connecting-IP`, stored only as a sha256 with the day). Status and cancel bodies: 1 kB at most. Discord's error text is never echoed on the landing page. The landing page has no scripts (CSP `default-src 'none'`), escapes the Discord name, and can't be framed. Missing `DISCORD_CLIENT_SECRET` or `GUILD_ID`: 501. The invite code and `/link` stay for "your own service".

## Rules it keeps

- Reads Torn only through `api.torn.com`, with each user's own key (the main Pumping Iron key after a Discord login, or a custom key on your own service), for that user's own view. Never a torn.com page, never another user's key.
- Never acts in Torn. Every Torn button is a link the user clicks. Done / Snooze / Skip only change the reminder.
- Stops on a dead key (errors 2, 13, 18) until a new key arrives. Keys are encrypted in D1 (AES-GCM, `KEY_ENC`).
- Only three hosts are ever called: `api.torn.com`, `discord.com`, `weav3r.dev` (`src/net.js` blocks anything else; every test checks it).
- Free plan: at most 45 outside calls and 45 D1 queries per run, both enforced (a call past them stops the run; a ping is only sent when there's room to record it, so it is never sent twice). Users are taken oldest-run first, the rest go next minute; only users a ping can reach are picked. The schema is checked once per Worker instance. No fight simulation here: the userscript syncs its results.
- Every reply is ephemeral (only the asker sees it) and pings nobody.
- Nothing is kept forever: a user nobody has synced for 30 days is forgotten by the 10-minute cleanup (at most 2 per run; once an hour room for one is always kept), and logins older than 15 minutes are deleted, finished ones too.

## Commands

| Command | Answers from | Torn calls |
|---|---|---|
| `/help` | text | none |
| `/link CODE` | D1 (code from `POST /link`, 10 min, single use, stored hashed) | none |
| `/unlink` | the Discord side of Forget: the linked user's row, key, plan, pings, acks, watches and logins are deleted ("Unlinked and forgotten…") | none |
| `/status` | D1: key, plan age, pings this hour/day vs caps, quiet hours, mutes | none |
| `/next`, `/plan` | the synced plan, Torn time | none |
| `/timers` | drug, booster, medical, energy, refill, travel | 1 (deferred) |
| `/buy [item]` | cheapest Item Market + TornW3B bazaar, links to buy | 1 (+ TornW3B), cached 60 s |
| `/watch [item] [price]` | add / change / stop / list (at most 3) | none (cron checks every 5 min) |
| `/targets` | last synced Torn Eye list, Attack links | none |
| `/target id` | status now + synced estimate | 1 (`user/{id}/basic`) |
| `/war [page] [faction]` | the whole enemy faction, page by page: band and win %, online / idle / offline, hospital out-at, flights with the estimated landing, jail, fallen | 2 (wars, enemy members) |
| `/chain` | count and timeout | 1 |
| `/snooze minutes [kind]` | mute a kind or all | none |
| `/settings` | quiet hours, DM or channel, caps, war cap and lead time, kinds on/off | none |

Commands that read Torn: at most one per user every 5 seconds.

## Pings (cron, every minute)

Existing: drug cooldown ≤ 5 min, energy full (not while stacking; since 2026-09-30 ahead of time: when Torn's `full_time` is ≤ 90 s the ping goes then, 30–90 s before the tick, id = the hour it fills so the "full" read after is the same ping, and it isn't closed as seen in Torn before the fill time; runs land ~52 s into each minute, so the old full-only ping came up to a minute late), refill unused 2 h before Torn midnight, strict jump steps 5 min before their tick.
Added: booster cooldown over (booster step next), drug ready 15 min and unused (one nudge), back from travel with a step waiting, jump sequence steps without a tick, plan out of date after 12 h (then only state pings and strict jump steps still ahead; "plan out of date" once per synced plan), price watches (kind `price`, 5 minutes after the user's last check), war pings (kind `war`), watch list (kind `watch`), chain timeout (off by default).

- **Delivery:** a DM from the bot (DM channel kept); on 50007 or 403, the channel webhook (mention, no buttons) and DMs rest 6 h. `/settings delivery:channel` forces the webhook.
- **Buttons:** Done, Snooze 10 min, Skip step (when there's a step), Open in Torn. On a ping already closed (done, skipped, seen in Torn) they answer "already done" and store nothing. War and chain: Done and Attack links.
- **Anti-spam:** stable alert ids (kept 2 days; war and watch-list ids 6 hours); pings due the same minute share one message (5 at most); quiet hours and caps (default 10 an hour, 60 a day; strict jump steps still go; war pings have their own cap); `/snooze`; per-kind on/off.
- **Auto-close:** when Torn shows it done (a new drug started, booster used, energy trained, refill used), the message is edited to "Seen in Torn" and loses its buttons.
- **War (1.2.0):** wars (ranked, territory, raids) checked every 10 minutes; during one, the enemy faction is read once a minute (one call) and compared with the last read, kept per enemy in `users.war` (state, until, online status, travel, first seen, whether the start was seen). Pings go out **ahead of time and only about enemies you can beat** (band Stomp, Good or Tough from the synced war list, else Torn Eye's bands; never Can't win or no data):
  - out of hospital within the lead time (`/settings war_lead`, default 3 min): "Soon_Out out of hospital in 3 min · Out 10:50 TCT · Good · win 95%";
  - landing in Torn within the lead time: "Returning to Torn from Mexico, lands ~15:05 TCT (est.)" (first seen + standard flight time; "by ~" when the flight was already under way at the first read);
  - out early (hospital ended before its time), came online while Okay (once per half hour per enemy);
  - the first read of a war: "War vs X: N you can beat are out now".
  Each ping has its own id (`war:<war>:<player>:<event>:<time>`) and goes as a **new message** so Discord notifies; the minute's pings share one (5 at most, at most 2 messages a minute). War pings have their own cap (`/settings war_per_hour`, default 30 an hour), apart from the normal one. A change that can't go out (cap, budget) waits up to 3 minutes. Under a war message: **Done: stop war pings** (no more pings or enemy reads for that war) and Attack links. `/snooze kind:war` mutes them; after a mute or a skipped minute an old read shows no "out early" or "came online".
- **Watch list (1.2.0):** up to 25 players synced by the userscript (with a reason tag). At most 5 are read a minute (`user/{id}/profile`), in turn, each at least every 5 minutes. Same pings (out of hospital soon and landing soon from the last read, came online), with the tag and win %; only players you can beat, or with no estimate ("No estimate"). Kind `watch` (on by default; `/settings kind:watch on:False`), under the normal cap. No Snooze on war or watch-list pings.
- **Chain:** 10+ hits and under 60 s left: one message per 10 minutes, edited.

`DRY_RUN=1`: Torn is read, nothing is posted; every Discord body goes to the `outbox` table.

## Files

`src/index.js` routes · `src/login.js` Log in with Discord · `src/cron.js` the minute · `src/alerts.js` what's due (pure) · `src/deliver.js` DM / webhook / edits · `src/interactions.js` dispatch · `src/cmd-core.js` D1 commands, linking · `src/cmd-torn.js` Torn commands, synced lists · `src/buttons.js` Done / Snooze / Skip, acks · `src/market.js` prices, watches · `src/war.js` war, watch list, chain · `src/keys.js` AES-GCM · `src/torn.js` Torn reads · `src/discord.js` signature, replies, DRY_RUN · `src/db.js` SQL and schema · `src/net.js` allowed hosts, budget · `scripts/register.mjs` command registration.

Tests: `worker/test/*.test.js` (node --test, in-memory D1 that fails on unknown SQL, recorded fetches, an Ed25519 key pair made in the test).

## Not verified (needs the live test, B10)

- A bot may need one gateway login before it can DM (older guides say so). If the first DM fails with an error other than 50007, that's the likely cause.
- The exact shape of `v2/faction/wars` for raids and territory wars, whether a Custom key needs `user: basic` for `user/{id}/basic`, and that `v2/user/{id}/profile` carries `status` and `last_action` (the watch list). The code reads them defensively; the live test confirms.
- Discord's answer to `prompt=none` on a first login (the code handles `consent_required` by showing the authorize page).
- Flight times are standard class; an airstrip or business class lands earlier, so landings say "(est.)".
- Torn's rules page (rules.php, scripting section): the owner reads it before B10.
