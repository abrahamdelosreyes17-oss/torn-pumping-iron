# HANDOFF: Torn Pumping Iron

Read this first. Then `docs/BUILD-PLAN.md` (what to build, in order), `docs/ENGINE-SPEC.md` (the maths), `docs/DESIGN.md` (the look), and open `mockups/K-home.html` and `mockups/J-blueprint.html` in a browser.

---

## 1. Start here

- **What it is:** one Tampermonkey userscript for Torn City. It includes:
  - a **gym planner**: what to take, when, what to train and how many trains, and the cheapest place to buy;
  - **Torn Eye**: whether you beat a player and how much HP you keep, plus war mode;
  - a **webpage** the script opens (GitHub Pages host page);
  - an optional **Discord pinger** (a Cloudflare Worker).
- **Users:** the owner (13B networth, ~1B total stats, Private Island) and a returning friend (low stats, under $200M liquid, Private Island).
- **Where it stands (2026-09-29):** research done. Design settled on `mockups/K-home.html` ("make every page similar"). **No code yet.** Next step: **M0** in BUILD-PLAN.
- **The owner checks in only at the first release (1.0.0).** Build M0–M8 without asking. Stop at the end of M8 and ask before any commit to GitHub, push or release.
- **Release repo:** https://github.com/abrahamdelosreyes17-oss/torn-pumping-iron. Release like the trading app (one file at the repo root, `@updateURL` on `main`, a `gh-pages` host page, pinned `<sha>` install links). Not like the poker app: the owner says poker "uninstalls itself from Tampermonkey every release". Its headers were stable, so the cause is unknown. Never change `@name`/`@namespace`.

### Milestones (update as you go)

| | Milestone | Status |
|---|---|---|
| M0 | Scaffold from the trading app | ☑ 29 tests, 2026-09-29 |
| M1 | Mockups for every page in K's style | ☑ 7 mockups, checked, 2026-09-29 |
| M2 | Core engine + tests | ☑ 135 tests, 2026-09-29 |
| M3 | API and data layer | ☑ 157 tests, 2026-09-29 |
| M4 | Webpage tabs | ☑ 160 tests + ux-check, 2026-09-29 |
| M5 | Overlay + marks on Torn pages | ☑ 165 tests + torn-check 31/31, 2026-09-29 |
| M6 | Torn Eye | ☐ |
| M7 | Discord service (Worker) | ☐ |
| M8 | Hardening, README, release prep → ask the owner | ☐ |

---

## 2. How the owner works (follow exactly)

1. **Nothing goes to GitHub** (commit to the release repo, push, tag, release, gh-pages) until the owner says so. Local `git init` and local commits as checkpoints are fine. Never add the remote before the go-ahead.
2. They think out loud, sometimes in Taglish. Restate what they asked in plain English before acting.
3. They want research before building, from real sources (GreasyFork/GitHub script source, Torn API spec, community guides). Don't guess mechanics. Put confidence tags ([code], [snippet], [calibrate]) in the docs.
4. They hate generic "AI-looking" design. Round 1 was "almost there but too much, cramped"; round 2 was "almost nothing, dead space". K is the answer: dense but grouped, one primary thing per page. Every page follows K.
5. They want the app to **recommend** (with alternatives and warnings), not ask them to reason about diminishing returns.
6. Everything must link to the exact Torn page (train → gym, buy → that bazaar or listing).
7. Plain words, the player's terms (Xanax, refill, trains, IM, bazaar). No "FF" anywhere (that's FFScouter's). Our bands: Stomp / Good / Tough / Can't win.
8. "Tests pass ≠ it works" (from the trading HANDOFF). Prove behaviour in the harness with fixtures.
9. On torn.com, the agent only reads. Never click, type or navigate there with browser tools.

## 3. Settled decisions (don't reopen)

- One script, one release; the overlay opens the webpage in a new tab (GM_openInTab), like trading's Torn Bids.
- The attack, targets and war side is called **Torn Eye** (the owner said "call this one Torn Eye (kinda like a spy)"; read as the fight side inside Pumping Iron).
- **Plan types:** Steady, Goal (unlock gym / reach build / stat numbers), Jump (choco, EDVD, 99k). Jump plans are strict (warn before a timing, then re-time). Steady and goal plans re-time silently. There is no strict/adaptive switch; buying re-prices daily.
- The app recommends, with a dropdown of alternatives. A worse pick shows a warning ("not worth it; train natural energy and drug cooldown instead, unless you have Ignorance Is Bliss").
- **Property:** just read the property's max happy; no rental finder.
- **Builds:** presets (Balanced, Baldr's, Baldr's defensive, Hank's, Hank's defensive, Tank, Offense) + per-session split in trains per stat. Default Balanced until George's.
- **Gym page:** no buttons of our own. Outline the stat, show trains + gain, **Fill N** types into Torn's reps box on click, and the user presses TRAIN. Warn before a train breaks a specialist gym.
- **Buy:** the cheapest across the item market, all bazaars (TornW3B) and the points market; qty per seller; an Open link to that listing.
- **Torn Eye:** a one-line chip (mix of round 1's A and C) with a hover card; user-set colour bands (green stomp, light green good, orange tough, red can't win); war mode (attackable now, next out of hospital, early outs, travel); attack-page panel; gear captured read-only from the attack page.
- **FFScouter:** use their data, credited, with a link to their data policy. The owner registers at ffscouter.com and pastes the same key; we call `/api/v1/get-stats`.
- **Discord:** the owner will create the server later; the app must be ready. Webhook pings from the Worker (never from the Torn tab). The bot comes later.
- **Look:** K's tokens, chalk accent, weight-plate stat colours (STR red, SPD yellow, DEF blue, DEX green), Arial + Barlow Condensed (webpage only).

## 4. Defaults I chose where the owner didn't answer (flag them at the release review)

| Question | Default in 1.0 |
|---|---|
| Density | Compact default, Comfortable in settings |
| Fill N on the gym page | Yes |
| Main number after the chip's colour | "keep ~62%" (HP kept) |
| Share captured gear with the friend | No (local only in 1.0) |
| Target list page in 1.0 | Yes, basic (FFScouter get-targets + our estimate) |
| One Discord Worker or one each | One Worker supporting several users; the docs explain both |
| Keys | One Limited Torn key for the userscript; a separate custom Minimal key for the Worker |
| Pill on every Torn page | Yes (setting to limit) |

## 5. Key findings (details in docs/)

- **The friend should NOT choco jump.** Stacking stops natural energy and Ecstasy eats a drug cooldown. Steady training (Xanax on cooldown + refill) wins at his stats; his Private Island's happy is the big lever. EDVD jumps beat steady only with far more money.
- **For the owner at ~250M per stat,** one EDVD jump adds ~12% (+297k DEF for $18.6M). Over a month steady still wins, unless **Ignorance Is Bliss** (item 770: happy regenerates above max for 31 days) is active.
- **Opponent gear:** no API exposes it. Torn sends `defenderItems` to the attack page via `page.php?sid=attackData` after Start Fight (before it with the Gun Shop job perk). KAL and S&R Loadout Revealer crowdsource this. KAL also rewrites Torn's page (grey area); we only read.
- **FFScouter** knows only a combined score (no build split, gear or HP). Its colours and difficulty text are fixed. Our edge: build-aware fight sim, HP kept, gear, user-set bands, war mode.
- **Discord:** no maintained tool pings personal timers in Discord. Cloudflare Worker cron every minute: free and reliable.
- **Design:** see `docs/research-design-pipeline.md`. Jobs → moments → priority → priority guides → click map → calibrate one screen → build the rest.

Research index: `docs/research-gym.md`, `research-builds-gympage.md`, `research-targets.md`, `research-torn-eye.md`, `research-discord.md`, `research-calm-ui.md`, `research-design-pipeline.md`, `task-map.md`, `torn-openapi.json` (Torn API v2 spec 6.13.6; query with node, it's 1.4 MB), `docs/reference/` (downloaded source of FFScouter V2, KAL/S&R loadout revealers, TWSE, GTG+, GymIQ, TornTools bits, BSP, items dump), `docs/sims/` (the simulations behind the numbers).

## 6. How to work (the way the previous session did)

- **Parallel research with subagents** (Agent tool, general-purpose or Explore) for anything unknown. Give each a precise brief and save its report into `docs/research-*.md` straight away, since sessions can end.
- **Numbers from simulation, not intuition.** Before showing any gain or cost figure, compute it (`docs/sims/*.mjs` or the engine). Every mockup number traces to a sim.
- **Specs before code; code before UI; UI to the mockups.** Pure core first with tests, then API, then UI.
- **One milestone at a time.** Update the milestone table and add a dated "What this session did" entry at the bottom of this file after each one (newest first, like trading's HANDOFF).
- **Memory:** project memory lives in `C:\Users\Abraham De Los Reyes\.claude\projects\D--torn-gym\memory\` (MEMORY.md index). Update `project-status.md` when milestones move.
- **Browser checks:** the built-in browser pane often times out on screenshots when the window is hidden. Use `get_page_text`/`read_page` or Playwright via `test/ux-check.mjs`. Never open torn.com with browser tools. Use fixtures.
- **Environment:** Windows 11. PowerShell is the primary shell and Git Bash is available. Files are CRLF-sensitive in string replacements (a PowerShell `.Replace` on CRLF text silently failed once; prefer the Edit tool). Node 24 is installed. Python is available for `http.server`.

## 7. Rules (Torn ToS / scripting): inherited from trading, plus this app's

1. Use only the Torn API or the page the user loaded and is viewing. No fetching torn.com pages; no hidden tabs or iframes.
2. Never act for the user: no clicks on Torn buttons, no train, buy, use or attack. **Fill** only types a number.
3. No alerts, sounds or title flashing from the Torn tab. Discord pings come only from the Worker, which uses the API.
4. Rate limits: one shared 70/min budget across tabs for Torn; separate budgets for TornW3B, FFScouter and TornStats; nothing from hidden tabs.
5. Show the ToS table (Data storage, Data sharing, Purpose, Key storage & sharing, Key access level) wherever a key is entered.
6. Disclose third parties (TornW3B, FFScouter, TornStats, Cloudflare Worker). Never send a key to a service that didn't already get it from the user.
7. Stop on a dead key (errors 2, 13, 18).
8. The page hook is read-only: clone responses, never modify Torn's data or state.
9. The Torn rules page (torn.com/rules.php) could never be fetched by tools. Ask the owner to read the scripting section before release.

---

## What each session did (newest first)

### 2026-09-29: build session (M0 →)
- **M0 ☑** Scaffold: `build.mjs` (trading's bundler; header per BUILD-PLAN, `PI_BUILD_VERSION`, outputs `dist/` + root `torn-pumping-iron.user.js`), `src/platform/{gm,idb,tab-window}.js` (prefix `pumpingIron.v1.`; `gmFetch(url, {method, headers, body})` now does POST/PUT for the Worker), `src/core/leader.js`, `src/api/client.js` (`comment=PumpingIron`), `src/ui/mask.js`, a new `src/sources/route.js` (every page we mark + every Torn link), `site/app.html` + `.nojekyll`, `test/harness.html` (GM stubs; `?page=gym` etc. stands in for Torn pages off torn.com; `?pi=app` boots the webpage). Local `git init` on `main`, no remote. Harness server: `harness` in `.claude/launch.json` (127.0.0.1:8785).
- **M1 ☑** Mockups L–R in `mockups/` (Plan, Buy, Progress, Torn Eye tab, Settings, Overlay + gym/items/bazaar marks, Torn Eye on Torn's pages), all on the shared `mockups/pi.css` (K's CSS + new components; M4 lifts it into the userscript). Every number comes from `docs/sims/mockup-data.mjs` (→ `mockup-data.json`) and the new fight Monte Carlo `docs/sims/fight.mjs` (ENGINE §10). `test/mockup-check.mjs` (Playwright core + the installed Edge) passes for all 7: no sideways scroll at 1280, no text under 11px, the DESIGN section named on top.
  - Sim fix found on the way: `split.mjs` never let happy recover between sessions, so multi-day splits under-counted gains. With happy back up each session: day 2 = DEX 123 / DEF 39, SPD joins day 5, STR day 7, balanced in about 7 days (ENGINE §7's "129/33, day 6" was the old run).
  - Self-review vs J: daily jobs stay 0–1 clicks; ≤ 2 disclosure levels (only the ToS tables and "Not in your plan" fold); one chalk primary per page except Settings, where each key section's save is chalk (one action per section). Overlay card at 1280 px has only ~150 px of free space beside Torn's content, so the card overlaps while hovered; the pill never does.
  - Research saved: `docs/research-api-shapes.md` (Torn v2 shapes + ambiguities), `docs/research-third-party-api.md` (FFScouter v1 spec: `get-stats` rows carry `bss_public`, `bs_estimate`, `fair_fight`, `last_updated`; data policy lives on ffscouter.com's home page; TornStats spy shapes; TornW3B `GET /api/marketplace/{itemId}` → `listings[]{player_id, player_name, quantity, price, …}`).
- **M2 ☑** Engine in `src/core/` (pure, `node --test`): `gain.js` (Vladar V2, research table exact: 68/572/467/1,038), `perks.js` (API perk strings, Bliss from its item text, Music Store 30% gym experience, Goal Oriented happy loss), `gyms.js` (table + live merge, specialist rules at their boundaries, best gym per stat preferring the active gym on ties), `items.js` (Torn's item effects; 5 EDVD / 49 candy fill a 24 h booster cap), `bars.js` (regen, quarter ticks, Torn day, refill, `diffStates` for done steps), `builds.js` (7 presets, greedy split with specialist caps, `allowedTrains` → "stop at 18, Balboas"), `strategies.js` (6 strategies; reproduces sim30 exactly), `recommend.js` (budget-aware pick, deltas, warning text, re-check triggers), `plan.js` (day timeline re-timed from live state; jump steps strict with a T−5 min warning; refill always before midnight; done log from state diffs), `market.js` (need list, cheapest fill across sources, verdicts), `history.js` (daily lows, 7-day average; replaces trading's larger module), `format.js`.
  - [calibrate] constants are named exports: `POST_50M_MODE`, `HAPPY_LOSS_PER_ENERGY`, `SSL_DRUG_LIMIT`, `SPECIALIST_NEEDS_GYM` (George's, unconfirmed), `XANAX_CD_MIN`/`ECSTASY_CD_MIN`.
  - Finding: Apollo Gym (DEF 6.4) beats Gun Shop (6.2) for the friend's DEF; the plan says so once DEF starts (day 2).
- **M3 ☑** `src/api/torn.js` (every v2 call: user state in one call, perks, property, equipment, inventory cat-by-cat with 21/4 skipped, attacks, personalstats, discord, profile, gyms, items, itemdetails, attacklog, itemmarket, pointsmarket, faction members, key info + `keyIsEnough`), `src/api/w3b.js` (trading's client, `comment=PumpingIron`), `src/api/third.js` (keyed third-party base: one https host asserted, shared window, pause, dead key, redaction), `ffscouter.js` (get-stats batched 205, check-key, get-targets; 429 → `retry_after_seconds`; code 6 = dead), `tornstats.js` (key in the path; `status:false` = dead), `src/platform/store.js` (typed settings/plan/keys, data groups for "Your data"), `src/feed/state.js` (visible leader polls every 30 s; diffs → day log; daily stats history; slow data on its own clocks; dead key stops it), `src/core/model.js` (one pure pass → everything a page shows). `test/api.test.js` + `feed.test.js` use recording fetches: the Torn key only to api.torn.com, the FFScouter key only to ffscouter.com, TornStats' only to www.tornstats.com, nothing keyed to weav3r.dev.
  - `test/harness-live.html` (canned answers for every service; `?key=1&at=2026-09-29T10:48:00Z` pins the clock) shows the friend's day: 10:51 Xanax → DEX × 27 (+1,400), 10:56 refill, 15:56 natural, 17:51 Xanax, 22:41 natural; 9 requests on first load.
- **M4 ☑** The webpage: `src/ui/styles.js` (K + pi.css in the shadow root), `src/ui/dom.js` (textContent only), `src/ui/app/{app,common,home,plan,buy,progress,settings}.js`, `src/runtime.js` (shared client, feed, model, day totals), `src/app-page.js` (prices at most every 5 min for what Buy/Home show, key saves with key/info and FFScouter check-key, diagnostics). Menu: "Open Pumping Iron", "Diagnostics". `test/ux-check.mjs` (Playwright core + Edge, harness-live, torn.com blocked) passes: every tab renders its content, no text under 11 px (SVG measured as drawn), nothing overflows at 1280, every control on top, the choco-jump warning appears before anything is saved, density applies; no key → Settings with the ToS table open.
  - **Finding (engine vs the old sim):** training the friend's four stats toward Balanced (not STR alone, as sim30 did) makes happy boosts worth more at ~100k per stat: 30 days steady +338k/$126M, daily choco +9% for +$35M, EDVD jump +86% for +$387M, choco jump −2% for +$15M (still warned). On a $150M budget steady stays recommended. The 99k jump is hidden unless the booster cap is above 24 h (it equals the EDVD jump otherwise).
- **M5 ☑** `src/ui/overlay.js` (pill + card in a shadow root; right of Torn's content or the right edge; drag remembered; Alt+P; "Reset overlay position" menu), `src/sources/dom/gym.js` + `market.js` (read-only page readers; `fillTrains` = native setter + input/change events, never a click), `src/core/gympage.js` (pure: which stat here, trains, specialist stop, grey words, switch hint), `src/ui/marks/marks.js` (page CSS, strip/outline/panel/Fill, `pointer-events:none` labels), `src/torn-page.js` (gym observer re-draws after React re-renders; unlocked gyms + progress % stored from the gym list; items/bazaar/Item Market/points outlines from the Buy list; market pages refresh prices at most every 5 min). Fixtures from the DOM research (`test/fixtures/*.html`, `attackData.json`) plus `gym-friend.html` / `gym-owner.html`. `test/torn-check.mjs` passes 31/31: Fill 27 types 27 with an input event, makes no request and never clicks TRAIN; Hank's stop at 18 caps Fill; each market outlines the chosen listing; the pill/card/Alt+P work; a hidden tab asks nothing; torn.com never loaded.
  - [UNCERTAIN, check live] the gym input really needs the native setter; `selected___` marks the gym you're in; the "energy per train" text; items page Use button class (we don't touch it).

### 2026-09-28/29: research, three mockup rounds, specs (no code)
- The owner asked for a gym planner ("searches market, makes a plan, recalculates daily, happiness, choco/EDVD jumps, pings on Discord") for themselves and a returning friend, plus an FFScouter-like fight helper that's better ("sometimes it says I win but I end at 1 HP").
- Research: the trading app's conventions, gym mechanics and tools, FFScouter and stat estimation, Torn→Discord, builds and the gym page, attack/war tools and opponent gear, calm dashboards, the design pipeline.
- Simulations: 30-day strategies and build splits (`docs/sims`).
- Mockups: round 1 (A/B/C/T), round 2 (D–I, too empty), then J blueprint + K home (approved: "make every page similar").
- Wrote ENGINE-SPEC, DESIGN, BUILD-PLAN, this HANDOFF, CLAUDE.md, README draft. Saved memory.
