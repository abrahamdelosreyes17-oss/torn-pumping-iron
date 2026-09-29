# The Discord bot: what's built

Same Worker as the 1.0 webhook pings, plus Discord's HTTP interactions at `POST /interactions` (no gateway). Setup: `SETUP.md` (part 2 is the owner's B0). Design and Torn's rules: `docs/discord-bot-design.md`. What the userscript must add: `USERSCRIPT-INTERFACE.md`.

## Rules it keeps

- Reads Torn only through `api.torn.com`, with each user's own custom key, for that user's own view. Never a torn.com page, never another user's key.
- Never acts in Torn. Every Torn button is a link the user clicks. Done / Snooze / Skip only change the reminder.
- Stops on a dead key (errors 2, 13, 18) until a new key arrives. Keys are encrypted in D1 (AES-GCM, `KEY_ENC`).
- Only three hosts are ever called: `api.torn.com`, `discord.com`, `weav3r.dev` (`src/net.js` blocks anything else; every test checks it).
- Free plan: at most 45 outside calls and 45 D1 queries per run, both enforced (a call past them stops the run; a ping is only sent when there's room to record it, so it is never sent twice). Users are taken oldest-run first, the rest go next minute; only users a ping can reach are picked. The schema is checked once per Worker instance. No fight simulation here: the userscript syncs its results.
- Every reply is ephemeral (only the asker sees it) and pings nobody.

## Commands

| Command | Answers from | Torn calls |
|---|---|---|
| `/help` | text | none |
| `/link CODE`, `/unlink` | D1 (code from `POST /link`, 10 min, single use, stored hashed) | none |
| `/status` | D1: key, plan age, pings this hour/day vs caps, quiet hours, mutes | none |
| `/next`, `/plan` | the synced plan, Torn time | none |
| `/timers` | drug, booster, medical, energy, refill, travel | 1 (deferred) |
| `/buy [item]` | cheapest Item Market + TornW3B bazaar, links to buy | 1 (+ TornW3B), cached 60 s |
| `/watch [item] [price]` | add / change / stop / list (at most 3) | none (cron checks every 5 min) |
| `/targets` | last synced Torn Eye list, Attack links | none |
| `/target id` | status now + synced estimate | 1 (`user/{id}/basic`) |
| `/war [faction]` | hit now / out of hospital next / travelling, by band | 2 (wars, enemy members) |
| `/chain` | count and timeout | 1 |
| `/snooze minutes [kind]` | mute a kind or all | none |
| `/settings` | quiet hours, DM or channel, caps, kinds on/off | none |

Commands that read Torn: at most one per user every 5 seconds.

## Pings (cron, every minute)

Existing: drug cooldown ≤ 5 min, energy full (not while stacking), refill unused 2 h before Torn midnight, strict jump steps 5 min before their tick.
Added: booster cooldown over (booster step next), drug ready 15 min and unused (one nudge), back from travel with a step waiting, jump sequence steps without a tick, plan out of date after 12 h (then only state pings and strict jump steps still ahead; "plan out of date" once per synced plan), price watches (5 minutes after the user's last check), war targets, chain timeout (off by default).

- **Delivery:** a DM from the bot (DM channel kept); on 50007 or 403, the channel webhook (mention, no buttons) and DMs rest 6 h. `/settings delivery:channel` forces the webhook.
- **Buttons:** Done, Snooze 10 min, Skip step (when there's a step), Open in Torn. On a ping already closed (done, skipped, seen in Torn) they answer "already done" and store nothing. War and chain: Done and Attack links.
- **Anti-spam:** stable alert ids (kept 2 days); pings due the same minute share one message (5 at most); quiet hours and caps (default 10 an hour, 60 a day; strict jump steps still go); `/snooze`; per-kind on/off.
- **Auto-close:** when Torn shows it done (a new drug started, booster used, energy trained, refill used), the message is edited to "Seen in Torn" and loses its buttons.
- **War:** wars checked every 10 minutes; during one, the enemy faction once a minute; Stomp or Good targets out now or within 2 minutes get one message, edited in place. Note: it is not one message for the whole war: a new message (which notifies) starts every 30 minutes while there are targets, because edits don't notify. Done stops them for that war.
- **Chain:** 10+ hits and under 60 s left: one message per 10 minutes, edited.

`DRY_RUN=1`: Torn is read, nothing is posted; every Discord body goes to the `outbox` table.

## Files

`src/index.js` routes · `src/cron.js` the minute · `src/alerts.js` what's due (pure) · `src/deliver.js` DM / webhook / edits · `src/interactions.js` dispatch · `src/cmd-core.js` D1 commands, linking · `src/cmd-torn.js` Torn commands · `src/buttons.js` Done / Snooze / Skip, acks · `src/market.js` prices, watches · `src/war.js` war, chain · `src/keys.js` AES-GCM · `src/torn.js` Torn reads · `src/discord.js` signature, replies, DRY_RUN · `src/db.js` SQL and schema · `src/net.js` allowed hosts, budget · `scripts/register.mjs` command registration.

Tests: `worker/test/*.test.js` (node --test, in-memory D1 that fails on unknown SQL, recorded fetches, an Ed25519 key pair made in the test).

## Not verified (needs the live test, B10)

- A bot may need one gateway login before it can DM (older guides say so). If the first DM fails with an error other than 50007, that's the likely cause.
- The exact shape of `v2/faction/wars` for raids, and whether a Custom key needs `user: basic` for `user/{id}/basic`. The code reads both defensively; the live test confirms.
- Torn's rules page (rules.php, scripting section): the owner reads it before B10.
