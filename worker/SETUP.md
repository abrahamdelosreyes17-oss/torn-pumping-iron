# Discord pings: set up the service (about 10 minutes)

Pumping Iron can tag you in Discord when a step is due: "Drug cooldown ends in 5 min · Xanax #2, then DEX × 27", "Energy is full", "Refill unused", "Jump in 5 min". A small service on **your own** free Cloudflare account reads your Torn timers once a minute and posts to **your own** Discord channel. It works with your PC off. Nothing is ever sent from a Torn tab.

What you need: a Cloudflare account (free), Node.js 18 or newer, a Discord server where you can make a webhook, and two minutes in Torn's API settings.

## 1. Deploy the Worker (once)

In a terminal, in this `worker` folder:

```bash
npx wrangler login
npx wrangler d1 create pumping-iron
```

Copy the `database_id` it prints into `wrangler.toml` (replace `PASTE-THE-ID-FROM-wrangler-d1-create`).

Choose an invite code (any word you'll share only with people you trust) and store it as a secret:

```bash
npx wrangler secret put INVITE_CODE
```

Deploy:

```bash
npx wrangler deploy
```

It prints your service address, like `https://pumping-iron.<you>.workers.dev`. Open `<address>/health` in a browser: it should say `{"ok":true}`.

The free plan is enough: one cron run a minute, a few requests per user per minute, one small database.

## 2. Make a Discord webhook

In your Discord server: channel settings → Integrations → Webhooks → New Webhook → Copy Webhook URL. Treat it like a password: anyone with it can post in that channel.

Your Discord user id (so the ping tags you): if your Discord is linked in Torn, Pumping Iron reads it for you. Otherwise, Discord → Settings → Advanced → Developer Mode on, then right-click your name → Copy User ID.

## 3. Make a Torn key for the Worker

Torn → Preferences → API → create a **Custom** key with only: user → `bars`, `cooldowns`, `refills`, `travel`. Name it "Pumping Iron pings". This key lives on your Worker; your main Pumping Iron key never goes there.

How the Worker's key is used (Torn's API terms):

| Data storage | Data sharing | Purpose of use | Key storage & sharing | Key access level |
|---|---|---|---|---|
| On your own Cloudflare Worker (D1) until you press Forget | Nobody; pings go to your own webhook | Personal: Discord pings for your gym plan | Stored / Used only for automation | Custom (user: bars, cooldowns, refills, travel) |

## 4. Connect Pumping Iron

Pumping Iron → Settings → Discord pings: paste the service address, the invite code, the webhook URL and the Worker's Torn key → **Connect** → **Send a test ping**. From then on your plan's next steps are sent to the Worker whenever they change (at most once a minute, from an open Pumping Iron or Torn tab).

The address must be the `*.workers.dev` one: the script may only talk to `workers.dev` (its `@connect` line).

## Sharing one Worker, or one each

- **One Worker for both of you (default):** give your friend the service address and the invite code. They connect with *their own* webhook and *their own* custom Torn key. Their key is stored on your Worker, so tell them, and show them the table above.
- **One each:** your friend deploys their own copy with these same steps. Nothing is shared.

## Turning it off

Settings → Discord pings → **Forget** removes you from the Worker (your key, webhook and plan). To remove the whole service: `npx wrangler delete`.

## What it does each minute

For each connected user: one call to `https://api.torn.com/v2/user?selections=bars,cooldowns,refills,travel` with the key in the `Authorization: ApiKey …` header, then at most one ping per event (it remembers what it sent for two days). If Torn says the key is invalid, disabled or paused (errors 2, 13, 18), that user is paused and nothing more is asked until they connect again.
