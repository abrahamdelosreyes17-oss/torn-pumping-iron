# Discord pings and the bot

Pumping Iron can tell you in Discord when a step is due ("Drug cooldown ends in 5 min · Xanax #2, then DEX × 27", "Energy is full", "Refill unused", "Jump in 5 min"), and, in a war, ahead of time about enemies you can beat ("Soon_Out out of hospital in 3 min · Good · win 95%", "Flyer lands in Torn in ~3 min"). A small service (a Cloudflare Worker) reads your Torn timers once a minute and the bot sends the ping as a DM. It works with your PC off. Nothing is ever sent from a Torn tab.

**The normal way:** the owner runs one service for everyone (set up once, below). You only:

1. join the owner's Discord server (ask the owner for an invite);
2. in Pumping Iron → Settings → Discord, press **Log in with Discord**, and allow it on Discord's page;
3. back in Pumping Iron it says **Connected as @you**. Press **Send a test ping**.

Being a member of the owner's server is what lets you in: no invite code, no form. The bot DMs you from then on (Done, Snooze 10 min, Skip step and Open in Torn under each ping; `/help` for the commands).

## Your key on the service (Torn's API terms)

After you log in, Pumping Iron sends the service your **main Pumping Iron key** (a Limited key), so the bot can read your timers, your faction's wars and the players you watch.

| Data storage | Data sharing | Purpose of use | Key storage & sharing | Key access level |
|---|---|---|---|---|
| On the owner's Cloudflare Worker (D1), the key encrypted (AES-GCM), until you press Disconnect (Forget), type `/unlink` in Discord, or 30 days without a sync | Nobody: pings and replies only you can see (DMs, replies only you see). The service's owner runs it and could read its database. | Personal gain (gym pings and timers); Competitive advantage (`/war`, `/chain`, war and watch-list pings) | Stored / Used only for automation and the commands you type | Limited (your main Pumping Iron key) |

One person's key is only ever used for that person's own pings and commands. Third party: `/buy` and price watches also read bazaar prices from **TornW3B** (weav3r.dev). No key is sent there.

## For the owner: set the service up once

What you need: a Cloudflare account (free), Node.js 18 or newer, your Discord server. About 30 minutes.

### 1. The Worker

In a terminal, in this `worker` folder:

```bash
npx wrangler login
npx wrangler d1 create pumping-iron
```

Copy the `database_id` it prints into `wrangler.toml` (already done for the owner's service).

The key that encrypts Torn keys in the database:

```bash
npx wrangler secret put KEY_ENC
```

Make one with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` and paste it. Keep a copy somewhere safe. If you change it later, every stored Torn key stops opening: pings pause until each user logs in again.

Deploy:

```bash
npx wrangler deploy
```

It prints the service address, like `https://pumping-iron.<you>.workers.dev`. Open `<address>/health` in a browser: it should say `{"ok":true}`.

The free plan is enough: one cron run a minute, at most 45 outside calls and 45 database queries per run. A user costs a few of each (more in a war or with a watch list), so with many users each is read every minute or two; the rest go the next minute.

**Updating:** deploy again. The database gets its new tables and columns by itself on the first request.

### 2. The bot

1. <https://discord.com/developers/applications> → **New Application** → name it "Pumping Iron".
2. **General Information:** copy the **Application ID** and the **Public Key**.
3. **Installation:** Install Link → **None**. **Bot:** turn **Public Bot** off. **Reset Token** → copy the token (shown once). No privileged intents are needed.
4. Store them as Worker secrets:

   ```bash
   npx wrangler secret put DISCORD_APP_ID
   npx wrangler secret put DISCORD_PUBLIC_KEY
   npx wrangler secret put BOT_TOKEN
   ```

5. **General Information → Interactions Endpoint URL:** `<address>/interactions` → **Save**. Discord checks it right away (a signed PING); if it won't save, the public key secret is wrong.
6. **OAuth2 → URL Generator:** scopes `bot` and `applications.commands`; bot permissions: **Send Messages**. Open the link and add the bot to your server. (The bot must be in the server: it checks who is a member.)
7. Register the commands in your server (Discord → Settings → Advanced → Developer Mode on; right-click the server → **Copy Server ID**):

   ```bash
   # macOS / Linux
   DISCORD_APP_ID=… BOT_TOKEN=… node scripts/register.mjs --guild <server id>
   # Windows PowerShell
   $env:DISCORD_APP_ID="…"; $env:BOT_TOKEN="…"; node scripts/register.mjs --guild <server id>
   ```

   `node scripts/register.mjs --print` shows the list without sending it. Run it again whenever the commands change. `--global` makes them work in DMs with the bot too (Discord takes up to an hour to show them).

### 3. "Log in with Discord"

1. Same application → **OAuth2** → **Client Secret** → **Reset Secret** → copy it:

   ```bash
   npx wrangler secret put DISCORD_CLIENT_SECRET
   ```

2. **OAuth2 → Redirects → Add Redirect:** `<address>/login/callback`, exactly (for the owner's service: `https://pumping-iron.pumping-iron-worker.workers.dev/login/callback`) → **Save Changes**.
3. `GUILD_ID` under `[vars]` in `wrangler.toml` is your server's id (already set: `1551784561237561344`).
4. `npx wrangler deploy`.

The login asks Discord only who you are (scope `identify`); the bot then checks the person is a member of `GUILD_ID`. A member gets a user row linked to their Discord account; anyone else sees "Not in the server" and nothing is stored. A Discord account already connected in another browser is refused ("Press Disconnect there, or type /unlink in Discord") unless that browser hasn't synced for 7 days. Until `DISCORD_CLIENT_SECRET` and `GUILD_ID` are set, the button answers "Log in with Discord isn't set up on this service yet" (the Worker answers 501).

How many people: up to 10 (`MAX_USERS = "20"` under `[vars]` changes it). Past that, a login says "The service is full".

### Test mode

Add `DRY_RUN = "1"` under `[vars]` in `wrangler.toml` and deploy. Torn is still read, but no message is sent: each one is written to the `outbox` table instead. See them with
`npx wrangler d1 execute pumping-iron --remote --command "SELECT * FROM outbox ORDER BY n DESC LIMIT 10"`.
Remove the line and deploy again to go live.

Not checked yet (tell the developer if you hit it): older guides say a bot must connect to Discord's gateway once before it can send DMs. If the first DM fails with an error other than 50007 (DMs closed), that's the likely reason.

## Advanced: your own service

For someone who wants their own copy instead of the owner's (nothing shared): deploy with steps 1 and 2 above on your own Cloudflare account, plus an invite code:

```bash
npx wrangler secret put INVITE_CODE
```

(any word you'll share only with people you trust). Then in Pumping Iron → Settings → Discord → **Run your own service**: paste the service address, the invite code, a Torn key for the Worker and (optional) a channel webhook → **Connect** → **Send a test ping**. With the bot: **Get a link code** and type `/link CODE` in Discord (10 minutes, single use). Step 3 (the login) is optional on your own service.

The address must be a `*.workers.dev` one: the script may only talk to `workers.dev` (its `@connect` line).

A Torn key for your own Worker: Torn → Settings → API → a **Custom** key named "Pumping Iron bot" with only:

- user → `basic`, `profile`, `bars`, `cooldowns`, `refills`, `travel` (`profile` for the watch list)
- faction → `members`, `chain`, `wars` (for `/war`, `/chain` and war pings; leave out if you don't fight)
- market → `itemmarket` (for `/buy` and price watches)

| Data storage | Data sharing | Purpose of use | Key storage & sharing | Key access level |
|---|---|---|---|---|
| On your own Cloudflare Worker (D1), the key encrypted (AES-GCM), until you press Forget, type `/unlink`, or 30 days without a sync | Nobody: pings and replies only you can see (DMs, replies only you see, or your own webhook channel) | Personal gain (gym pings and timers); Competitive advantage (`/war`, `/chain`, war and watch-list pings) | Stored / Used only for automation and the commands you type | Custom (user: basic, profile, bars, cooldowns, refills, travel · faction: members, chain, wars · market: itemmarket) |

A channel webhook (optional with the bot, the only way without it): channel settings → Integrations → Webhooks → New Webhook → Copy Webhook URL. Treat it like a password. Without a bot, pings are a post in that channel that tags you (no buttons, no commands); with a bot, the webhook is the fallback when a DM can't reach you.

## Turning it off

Pumping Iron → Settings → Discord → **Disconnect** (Forget) removes you from the service (your key, plan, pings, watches, war and watch lists). `/unlink` in Discord does the same from the Discord side ("Unlinked and forgotten"). A user nobody has synced for 30 days is forgotten by itself. To remove the whole service: `npx wrangler delete`, and delete the application in Discord's developer portal.

## What it does each minute

For each connected user: one call to `https://api.torn.com/v2/user?selections=bars,cooldowns,refills,travel` with the key in the `Authorization: ApiKey …` header, then at most one message for what's new (it remembers what it sent for two days). With price watches: one item market read per watched item every 5 minutes. In a war (war pings on): one read of the enemy faction a minute, and a check for wars every 10 minutes. With a watch list: at most 5 watched players a minute, each at least every 5 minutes. Chain pings (off unless you switch them on): one chain read a minute. Commands you type add one or two reads each, at most one command every 5 seconds. That stays far under Torn's 100 calls a minute per user.

If Torn says the key is invalid, disabled or paused (errors 2, 13, 18), that user is paused and nothing more is asked until a new key arrives (log in again, or paste one on your own service).

The bot never trains, buys, uses items or attacks, and never opens a Torn page: every Torn button is a link you click yourself. Done, Snooze and Skip only change the reminder; your plan still learns what you did from Torn's own data.
