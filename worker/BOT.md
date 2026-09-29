# The Discord bot (not in 1.0): design note

1.0 pings through a channel webhook. A bot adds direct messages and buttons. Same Worker, nothing to redo.

## What it adds

- **DMs** instead of a channel post (a webhook can't DM).
- **/plan**: today's steps with times (from the synced plan).
- **/timers**: drug, booster, refill and energy right now (one Torn read).
- **Done / Snooze 10 min** buttons under each ping. Done only hides the reminder; the plan still marks steps done from Torn's own state (a cooldown that started, a stat that rose), never from a click.

## How

- A Discord application with a bot user; its token as a Worker secret (`BOT_TOKEN`), its public key as `DISCORD_PUBLIC_KEY`.
- DMs: `POST /users/@me/channels {recipient_id}` then `POST /channels/{id}/messages` with the same body the webhook uses (`content` with the mention, one embed, `allowed_mentions`).
- Slash commands and buttons: Discord's HTTP interactions to a new route `POST /interactions` on this Worker; verify the Ed25519 signature on every request; answer within 3 seconds (type 4) or defer (type 5).
- Snooze: a row in `sent` with a future `at` so the alert re-arms after 10 minutes.
- Linking a Discord user to a Pumping Iron user: a one-time `/link <code>` where the code is shown in Settings (derived from the user's secret), so no Torn key ever travels through Discord.

## Rules it keeps

Reading only (the same custom key), no alerts from a Torn tab, nothing done in Torn from Discord.
