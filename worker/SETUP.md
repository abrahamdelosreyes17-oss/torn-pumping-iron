# Discord pings and the bot: set up the service

Pumping Iron can tell you in Discord when a step is due: "Drug cooldown ends in 5 min · Xanax #2, then DEX × 27", "Energy is full", "Refill unused", "Jump in 5 min". A small service on **your own** free Cloudflare account reads your Torn timers once a minute and sends the ping. It works with your PC off. Nothing is ever sent from a Torn tab.

Two ways to get pings:

- **The bot (recommended):** DMs with **Done**, **Snooze 10 min**, **Skip step** and **Open in Torn** buttons, plus commands (`/timers`, `/next`, `/buy`, `/war`…). About 25 minutes once (part 1 + part 2).
- **A channel webhook only:** a post in one channel that tags you, no buttons, no commands. About 10 minutes (part 1 only). The bot also uses this webhook when it can't DM you.

What you need: a Cloudflare account (free), Node.js 18 or newer, a Discord server where you can make a webhook or add a bot, and two minutes in Torn's API settings.

## Part 1. The Worker (once)

In a terminal, in this `worker` folder:

```bash
npx wrangler login
npx wrangler d1 create pumping-iron
```

Copy the `database_id` it prints into `wrangler.toml` (replace `PASTE-THE-ID-FROM-wrangler-d1-create`).

Two secrets:

```bash
npx wrangler secret put INVITE_CODE
npx wrangler secret put KEY_ENC
```

- `INVITE_CODE`: any word you'll share only with people you trust. The first connect from Pumping Iron needs it.
- `KEY_ENC`: the key that encrypts Torn keys in the database. Make one with
  `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` and paste it. Keep a copy somewhere safe. If you change it later, every stored Torn key stops opening: pings pause until each user pastes their key again.

Deploy:

```bash
npx wrangler deploy
```

It prints your service address, like `https://pumping-iron.<you>.workers.dev`. Open `<address>/health` in a browser: it should say `{"ok":true}`.

The free plan is enough: one cron run a minute; each run reads at most about 10 users (50 outside calls and 50 database queries per run), and the rest go the next minute.

**Updating from 1.0:** deploy as above after adding `KEY_ENC`. The database gets its new tables and columns by itself on the first request, and keys stored by 1.0 are encrypted the first time they're read.

## Part 2. The bot (B0: the owner, about 15 minutes)

1. Go to <https://discord.com/developers/applications> → **New Application** → name it "Pumping Iron".
2. **General Information:** copy the **Application ID** and the **Public Key**.
3. **Installation:** Install Link → **None** (so only you can add it). **Bot:** turn **Public Bot** off. **Reset Token** → copy the token (shown once). No privileged intents are needed.
4. Store the three as Worker secrets, then deploy again:

   ```bash
   npx wrangler secret put DISCORD_APP_ID
   npx wrangler secret put DISCORD_PUBLIC_KEY
   npx wrangler secret put BOT_TOKEN
   npx wrangler deploy
   ```

5. **General Information → Interactions Endpoint URL:** `https://pumping-iron.<you>.workers.dev/interactions` → **Save**. Discord checks it right away (a signed PING); if it won't save, the public key secret is wrong.
6. **OAuth2 → URL Generator:** scopes `bot` and `applications.commands`; bot permissions: **Send Messages**. Open the link and add the bot to your server.
7. Register the commands in your server (Discord → Settings → Advanced → Developer Mode on; right-click the server → **Copy Server ID**):

   ```bash
   # macOS / Linux
   DISCORD_APP_ID=… BOT_TOKEN=… node scripts/register.mjs --guild <server id>
   # Windows PowerShell
   $env:DISCORD_APP_ID="…"; $env:BOT_TOKEN="…"; node scripts/register.mjs --guild <server id>
   ```

   `node scripts/register.mjs --print` shows the list without sending it. Run the register step again whenever the commands change. `--global` makes them work in DMs with the bot too (Discord takes up to an hour to show them).
8. In Discord: `/help`. Then in Pumping Iron → Settings → Discord → **Get a link code**, and type `/link CODE` (the code lasts 10 minutes and works once).

A test mode: add `DRY_RUN = "1"` under `[vars]` in `wrangler.toml` and deploy. Torn is still read, but no message is sent: each one is written to the `outbox` table instead. See them with
`npx wrangler d1 execute pumping-iron --remote --command "SELECT * FROM outbox ORDER BY n DESC LIMIT 10"`.
Remove the line and deploy again to go live.

Not checked yet (tell the developer if you hit it): older guides say a bot must connect to Discord's gateway once before it can send DMs. If the first DM fails with an error other than 50007 (DMs closed), that's the likely reason.

## Part 3. A Torn key for the Worker

Torn → Settings → API → create a **Custom** key with only these selections, and name it "Pumping Iron bot":

- user → `basic`, `bars`, `cooldowns`, `refills`, `travel`
- faction → `members`, `chain`, `wars` (for `/war`, `/chain` and war pings; leave out if you don't fight)
- market → `itemmarket` (for `/buy` and price watches)

This key lives on the Worker; your main Pumping Iron key never goes there.

How the Worker's key is used (Torn's API terms):

| Data storage | Data sharing | Purpose of use | Key storage & sharing | Key access level |
|---|---|---|---|---|
| On your own Cloudflare Worker (D1), the key encrypted (AES-GCM), until you press Forget | Nobody: pings and replies only you can see (DMs, replies only you see, or your own webhook channel) | Personal gain (gym pings and timers); Competitive advantage (`/war`, `/chain`, war pings) | Stored / Used only for automation and the commands you type | Custom (user: basic, bars, cooldowns, refills, travel · faction: members, chain, wars · market: itemmarket) |

Third party: `/buy` and price watches also read bazaar prices from **TornW3B** (weav3r.dev). No key is sent there.

## Part 4. Connect Pumping Iron

Pumping Iron → Settings → Discord: paste the service address, the invite code, the Worker's Torn key and (optional) the webhook URL → **Connect** → **Send a test ping**. With the bot: **Get a link code** and `/link CODE` in Discord. From then on your plan's next steps are sent to the Worker when they change (at most once a minute, from an open Pumping Iron or Torn tab).

The address must be the `*.workers.dev` one: the script may only talk to `workers.dev` (its `@connect` line).

A webhook (optional with the bot): in your Discord server, channel settings → Integrations → Webhooks → New Webhook → Copy Webhook URL. Treat it like a password: anyone with it can post in that channel.

## Sharing one Worker, or one each

- **One Worker for both of you (default):** give your friend the service address and the invite code. They connect with *their own* Torn key (and webhook), and `/link` their own Discord account. Their key is stored, encrypted, on your Worker, so tell them, and show them the table above. One person's key is only ever used for that person's own pings and commands.
- **One each:** your friend deploys their own copy with these same steps. Nothing is shared.

## Turning it off

`/unlink` in Discord stops DMs. Settings → Discord → **Forget** removes you from the Worker (your key, plan, pings, watches). To remove the whole service: `npx wrangler delete`, and delete the application in Discord's developer portal.

## What it does each minute

For each connected user: one call to `https://api.torn.com/v2/user?selections=bars,cooldowns,refills,travel` with the key in the `Authorization: ApiKey …` header, then at most one message for what's new (it remembers what it sent for two days). With price watches: one item market read per watched item every 5 minutes. In a war (war pings on): one read of the enemy faction a minute, and a check for wars every 10 minutes. Chain pings (off unless you switch them on): one chain read a minute. Commands you type add one or two reads each, at most one command every 5 seconds. That stays far under Torn's 100 calls a minute per user.

If Torn says the key is invalid, disabled or paused (errors 2, 13, 18), that user is paused and nothing more is asked until they send a new key.

The bot never trains, buys, uses items or attacks, and never opens a Torn page: every Torn button is a link you click yourself. Done, Snooze and Skip only change the reminder; your plan still learns what you did from Torn's own data.
