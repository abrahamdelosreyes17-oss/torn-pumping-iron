# Torn Pumping Iron

A Tampermonkey script for [Torn](https://www.torn.com) that plans your gym training and scouts your fights. It reads the Torn API and the page you're on; it never trains, buys, uses or attacks for you.

- **Plan:** it recommends how to train for your stats and money (steady Xanax + refill, a daily candy boost, or a happy jump), shows the others against it, and warns you before you pick one that isn't worth it.
- **Today:** what to take and when, which stat and how many trains, in Torn time. When you're late, the rest of the day moves with you.
- **Buy:** the cheapest Xanax, points, candy and EDVDs across the Item Market, every bazaar and the points market, how many to take from each seller, and a link straight to the listing.
- **Gym page:** the stat to train is outlined with the number of trains and the expected gain. **Fill** types that number into Torn's box; you press TRAIN. It stops you before a train would lose a specialist gym.
- **Torn Eye:** on profiles, faction lists, wars and the attack page, a chip says **Stomp**, **Good**, **Tough** or **Can't win**, with your chance to win, the HP you'd keep and the respect. War mode sorts the enemy by who you can hit now and who's out of hospital next. You choose where each colour starts.
- **Discord (optional):** a small free service on your own Cloudflare account tags you in Discord when a step is due, even with your PC off.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) (Chrome, Edge, Firefox).
   - **Chrome 138 and newer:** open `chrome://extensions`, find Tampermonkey → Details, and turn on **Allow User Scripts**. Without it no user script runs.
2. Open **https://raw.githubusercontent.com/abrahamdelosreyes17-oss/torn-pumping-iron/main/torn-pumping-iron.user.js**. Tampermonkey offers to install it and keeps it up to date from that same address.
3. On any Torn page, point at the round Pumping Iron pill (right of Torn's content) → **Open Pumping Iron**, or use Tampermonkey's menu → *Open Pumping Iron*. The webpage opens at `abrahamdelosreyes17-oss.github.io/torn-pumping-iron/app.html`.
4. In **Settings**, paste a Torn API key (see below). Home fills in within a few seconds.

## The pages

| Tab | What's on it |
|---|---|
| **Home** | The next step with a countdown and links to Torn's Items and Gym pages; today's steps (done ones ticked from your own stats and cooldowns); your stats against your build; what to buy today; heads-up (refill unused, next gym, plan still best). |
| **Plan** | The recommended way to train for your stats and budget, the other plans against it (stats and cost), a warning before a worse pick, the build (Balanced, Baldr's, Hank's and their defensive versions, Tank, Offense) and the next 7 days of trains per stat. |
| **Buy** | Today / 3 days / a week: each item, what you hold, the cheapest listings to take from and a 7-day price check. |
| **Progress** | Your stats over time, what you gained against the plan each day, and the gyms ahead. |
| **Torn Eye** | Targets (from FFScouter) ranked by our fight estimate, from easiest to most respect; your colour bands; where the numbers come from. |
| **Settings** | Keys, FFScouter, TornStats, Discord, what shows on Torn, spacing and time, diagnostics, and your stored data with a clear button for each part. |

On Torn: a small panel on every page, in the empty margin beside Torn's page (left of it first, so the trading script's NPC Arbitrage keeps the right; drag it by its bar, **Alt+`** collapses or expands it), the gym page marks, outlines on the items page and on the listing the Buy list chose, and Torn Eye chips.

## Keys and what each one does

Torn's API terms ask every tool to say how it uses a key, where you enter it. The same tables are in Settings.

**Your Torn key (Limited):** Torn → Preferences → API → a **Limited** key.

| Data storage | Data sharing | Purpose of use | Key storage & sharing | Key access level |
|---|---|---|---|---|
| Only locally, in this browser | Nobody | Personal gain: gym planning and fight estimates | Stored locally / Not shared | Limited (user: bars, cooldowns, refills, battlestats, gym, perks, property, equipment, inventory, attacks, personalstats, discord, profile; torn: gyms, items, itemdetails, attacklog; market: itemmarket, pointsmarket; faction: members; key: info) |

It goes to `api.torn.com` and nowhere else. FFScouter, TornStats, TornW3B and the Discord service never receive it.

**FFScouter (optional):** stat estimates for players you haven't fought. Sign up at [ffscouter.com](https://ffscouter.com/) (their data policy is on that page) and paste the same key. Sent only to ffscouter.com, which already has it, with the player ids you look at. Every estimate from it says "FFScouter".

**TornStats (optional):** if your faction shares spies there, exact stats beat every estimate. The key on your TornStats account; sent only to tornstats.com.

**The Discord service's key (optional):** a separate **custom** key with only user → bars, cooldowns, refills, travel, stored on your own Cloudflare Worker. See [worker/SETUP.md](worker/SETUP.md).

Bazaar prices come from [TornW3B](https://weav3r.dev) (item ids only, never a key).

## Discord pings

[worker/SETUP.md](worker/SETUP.md) takes about 10 minutes: deploy the Worker to your free Cloudflare account, make a Discord webhook and a small Torn key for it, and connect it in Settings. Pings look like `@you drug cooldown ends in 5 min · Xanax #2, then DEX × 27`. The bot (DMs, /plan, Done and Snooze buttons) is planned: [worker/BOT.md](worker/BOT.md).

## Rules it keeps

Torn allows scripts that use the API or the page you loaded yourself, and that never act for you. Pumping Iron is built around that:

1. **Only the API or the page you're viewing.** It never loads a Torn page by itself, in the background, a hidden tab or a frame. Network calls go to `api.torn.com`, `weav3r.dev` (bazaar prices, no key), `ffscouter.com` and `www.tornstats.com` (only if you add their keys), and your own `*.workers.dev` Discord service.
2. **It never acts for you.** No train, buy, use, attack or click on Torn's buttons. **Fill** types one number into the gym's box when you click it; you press TRAIN. Outlines and labels never cover Torn's buttons. In war mode the enemy rows are only re-ordered on your screen.
3. **No alerts from a Torn tab.** No pop-ups, sounds or title changes. Discord pings come only from your own service, which reads the API.
4. **One key's worth of calls.** All Torn calls share one limit of 40 a minute across every open tab (Torn allows 100 per player; this leaves room for the trading script and another tool), and nothing is asked from a tab you aren't looking at. War mode reads the enemy faction at most every 10 seconds while that tab is open. FFScouter, TornStats and TornW3B each have their own, lower limits.
5. **Each key only where it belongs** (see above), never written to a log or an error message, and masked in its box.
6. **Stops on a dead key.** If Torn says a key is invalid, disabled or paused, nothing more is sent until you save a new one.
7. **The attack page is only read.** To remember the gear Torn shows you after Start Fight, the script reads a copy of Torn's answer; Torn gets its own answer untouched, and nothing is changed on the page or in Torn's data.
8. **Your data stays on your computer**, except what you send to your own Discord service. Settings → Your data shows it and clears it.

## For development

```bash
npm run build
npm run check
```

`npm run build` writes `dist/torn-pumping-iron.user.js` and the released copy `torn-pumping-iron.user.js`. `npm run check` builds, checks the bundle parses and runs every unit test (the userscript's and the Worker's). The browser checks (`test/ux-check.mjs`, `test/torn-check.mjs`) run the built script against canned data and saved pages with Playwright; nothing loads from torn.com.
