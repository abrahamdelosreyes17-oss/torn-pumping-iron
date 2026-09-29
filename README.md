# Torn Pumping Iron

A Tampermonkey script for [Torn](https://www.torn.com) that plans your gym training and scouts your fights. It reads the Torn API and the page you're on; it never trains, buys, uses or attacks for you.

- **Plan:** **Auto** (the default) picks how to train from what your income affords: steady Xanax + refill, a daily candy boost, a happy jump or a console jump, and switches for events like World Diabetes Day when that wins. It names every item to take (which candy, how many), shows the other plans against it, and warns you before you pick one that isn't worth it. Auto needs a Full key (only for your money log); without one you set a budget yourself.
- **Today:** what to take and when, which stat and how many trains, and in which gym, in Torn time. Each session trains whatever moves you toward your build fastest (one stat or several). When you're late, the rest of the day moves with you.
- **Buy:** the cheapest Xanax, points, candy and EDVDs across the Item Market, every bazaar and the points market, how many to take from each seller, and a link straight to the listing.
- **Gym page:** the stat to train is outlined with the number of trains and the expected gain. **Fill** types that number into Torn's box; you press TRAIN. When the session goes on in another gym, that gym's button is outlined with what to train there ("Next: Frontline · DEX × 8"). It stops you before a train would lose a specialist gym.
- **Torn Eye:** on profiles, faction lists, wars and the attack page, a chip says **Stomp**, **Good**, **Tough** or **Can't win**, with your chance to win, the HP you'd keep and the respect. Targets lists only players you can beat, most respect first. War mode finds your faction's war by itself and shows everyone: online or offline, hospital out-times, where travellers are flying and when they land. **☆ Watch** any player and see when they're out. You choose where each colour starts.
- **Receipts:** energy, items and money you trained with, and what other plans would have given for the same energy.
- **Discord (optional):** **Log in with Discord** and the Pumping Iron bot DMs you when a step is due, even with your PC off, and warns you ahead of time when war enemies you can beat come out of hospital or land.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) (Chrome, Edge, Firefox).
   - **Chrome 138 and newer:** open `chrome://extensions`, find Tampermonkey → Details, and turn on **Allow User Scripts**. Without it no user script runs.
2. Open **https://raw.githubusercontent.com/abrahamdelosreyes17-oss/torn-pumping-iron/main/torn-pumping-iron.user.js**. Tampermonkey offers to install it and keeps it up to date from that same address.
3. On any Torn page, point at the round Pumping Iron pill (right of Torn's content) → **Open Pumping Iron**, or use Tampermonkey's menu → *Open Pumping Iron*. The webpage opens at `abrahamdelosreyes17-oss.github.io/torn-pumping-iron/app.html`.
4. In **Settings**, paste a Torn API key (see below). Home fills in within a few seconds.

## The pages

| Tab | What's on it |
|---|---|
| **Home** | The next step with a countdown and links to Torn's Items and Gym pages; today's steps (done ones ticked from your own stats and cooldowns) with the gym for each part; your stats against your build and which gym trains what; what to buy today; heads-up (refill unused, next gym, events, war, plan still best). |
| **Plan** | The Plan dropdown (Auto from your income · Most stats in my budget · Best value · Max gains), the recommended plan with the candy it picked, the other plans against it, a warning before a worse pick, "if you were hired at…" company what-ifs when they'd win, the unlock-a-gym goal with the days and stats each plan costs, the build and why it trains what it trains. |
| **Buy** | Today / 3 days / a week, always with your next jump in full: each item, what you hold, the cheapest listings to take from (city shops too, once you tick the ones that sell to you) and a 7-day price check. |
| **Progress** | Your stats over time, what you gained against the plan each day, receipts (energy, items, money), what other plans would have given, and the gyms ahead. |
| **Torn Eye** | Targets (only players you beat, most respect first), Chain, War (everyone, with online status, hospital and landing times) and Watched; your colour bands; where the numbers come from. |
| **Settings** | Keys (Torn, Full key for Auto, FFScouter, TornStats), Discord (Log in with Discord), energy kept for war days, Torn Eye colours, what shows on Torn, time, Developer (export your learning data as a .zip), diagnostics, and your stored data with a clear button for each part. |

On Torn: a small panel on every page, in the empty margin beside Torn's page (left of it first, so the trading script's NPC Arbitrage keeps the right; drag it by its bar, **Alt+`** collapses or expands it), the gym page marks, outlines on the items page and on the listing the Buy list chose, and Torn Eye chips.

## Keys and what each one does

Torn's API terms ask every tool to say how it uses a key, where you enter it. The same tables are in Settings.

**Your Torn key (Limited):** Torn → Preferences → API → a **Limited** key.

| Data storage | Data sharing | Purpose of use | Key storage & sharing | Key access level |
|---|---|---|---|---|
| In this browser; if you log in with Discord, also on the Pumping Iron service (the owner's Cloudflare Worker), encrypted, until you press Disconnect | Nobody | Personal gain: gym planning and fight estimates | Stored locally / With Discord pings: stored encrypted on the Pumping Iron service, used only for your own pings and the bot commands you type | Limited (user: bars, cooldowns, refills, battlestats, gym, perks, property, equipment, inventory, attacks, personalstats, discord, profile, job, jobpoints, money; torn: gyms, items, itemdetails, attacklog, logcategories, calendar; market: itemmarket, pointsmarket; faction: members, wars; key: info) |

It goes to `api.torn.com`, and to the Pumping Iron service only if you log in with Discord. FFScouter, TornStats and TornW3B never receive it.

**Full key (Auto mode):** a **Full** key, used for one thing only: reading your money log, so Auto can size your gym spending to your income.

| Data storage | Data sharing | Purpose of use | Key storage & sharing | Key access level |
|---|---|---|---|---|
| Only locally, in this browser: the key, and a summary of your money log (titles, amounts, times; 30 days) | Nobody. Never sent to the Pumping Iron service, FFScouter, TornStats or TornW3B | Personal gain: Auto mode sizes your gym plan to your income | Stored locally / Not shared | Full (used only for user: log, the money categories) |

**FFScouter (optional):** stat estimates for players you haven't fought. Sign up at [ffscouter.com](https://ffscouter.com/) (their data policy is on that page) and paste the same key. Sent only to ffscouter.com, which already has it, with the player ids you look at. Every estimate from it says "FFScouter".

**TornStats (optional):** if your faction shares spies there, exact stats beat every estimate. The key on your TornStats account; sent only to tornstats.com.

**Your own Discord service (advanced):** if you run your own Worker instead of the Pumping Iron one, the key you paste in Settings › Discord › Advanced is stored encrypted on your own Cloudflare Worker. See [worker/SETUP.md](worker/SETUP.md).

Bazaar prices come from [TornW3B](https://weav3r.dev) (item ids only, never a key).

## Discord pings

Settings › Discord › **Log in with Discord**. You need to be in the Pumping Iron Discord server; Discord asks you to allow Pumping Iron (your name only), and pings start. They come as DMs from the bot, like `Drug cooldown ends in 5 min · Xanax #2, then DEX × 27`, with Done / Snooze / Skip buttons, and `/plan`, `/next`, `/timers`, `/buy`, `/targets`, `/war` answer in the server. In a faction war the bot warns you ahead of time about enemies you can beat ("out of hospital in 3 min · win 95%", "lands in Torn in 3 min"), and the same for players you watch. Buttons never act in Torn: Skip only re-times your plan, Done only hides the ping. Running your own service instead: [worker/SETUP.md](worker/SETUP.md).

## Rules it keeps

Torn allows scripts that use the API or the page you loaded yourself, and that never act for you. Pumping Iron is built around that:

1. **Only the API or the page you're viewing.** It never loads a Torn page by itself, in the background, a hidden tab or a frame. Network calls go to `api.torn.com`, `weav3r.dev` (bazaar prices, no key), `ffscouter.com` and `www.tornstats.com` (only if you add their keys), and the Pumping Iron `*.workers.dev` Discord service (only if you log in with Discord).
2. **It never acts for you.** No train, buy, use, attack or click on Torn's buttons. **Fill** types one number into the gym's box when you click it; you press TRAIN. Outlines and labels never cover Torn's buttons. In war mode the enemy rows are only re-ordered on your screen.
3. **No alerts from a Torn tab.** No pop-ups, sounds or title changes. Discord pings come only from your own service, which reads the API.
4. **One key's worth of calls, and taking turns with Torn Trading.** All Torn calls share one limit of 70 a minute across every open tab (Torn allows 100 per player), and nothing is asked from a tab you aren't looking at. Pumping Iron and Torn Trading (NPC Arbitrage, Torn Bids) never run together: while Torn Trading is on, Pumping Iron pauses (no Torn or TornW3B calls, nothing drawn on Torn's pages, a warning sign on its panel) and starts again by itself about a minute after Torn Trading is turned off. To notice a Torn Bids tab it also runs, read only, on that page. War mode reads the enemy faction at most every 10 seconds while that tab is open. FFScouter, TornStats and TornW3B each have their own, lower limits.
5. **Each key only where it belongs** (see above), never written to a log or an error message, and masked in its box.
6. **Stops on a dead key.** If Torn says a key is invalid, disabled or paused, nothing more is sent until you save a new one.
7. **The attack page is only read.** To remember the gear Torn shows you after Start Fight, the script reads a copy of Torn's answer; Torn gets its own answer untouched, and nothing is changed on the page or in Torn's data.
8. **Your data stays on your computer**, except what goes to the Pumping Iron service when you log in with Discord (your Torn key, encrypted; your plan's next steps; your player and faction id; Torn Eye's target, war and watch lists: player ids, names, levels, colour bands, win % and watch tags). Settings → Your data shows it and clears it; Disconnect removes it from the service.

## For development

```bash
npm run build
npm run check
```

`npm run build` writes `dist/torn-pumping-iron.user.js` and the released copy `torn-pumping-iron.user.js`. `npm run check` builds, checks the bundle parses and runs every unit test (the userscript's and the Worker's). The browser checks (`test/ux-check.mjs`, `test/torn-check.mjs`) run the built script against canned data and saved pages with Playwright; nothing loads from torn.com.
