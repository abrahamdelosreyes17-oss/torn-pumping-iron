# HANDOFF: Torn Pumping Iron

**Released: 1.0.1 (2026-09-29; 1.0.0 the same day).** Local `main` is 2+ commits ahead (not released: faster plan changes, first read in 0.5 s, why-not lines).
- Install (pinned 1.0.1): https://raw.githubusercontent.com/abrahamdelosreyes17-oss/torn-pumping-iron/9fda20d860586259412d26701986fc40ce67bfad/torn-pumping-iron.user.js
- Auto-update URL (`@updateURL`): https://raw.githubusercontent.com/abrahamdelosreyes17-oss/torn-pumping-iron/main/torn-pumping-iron.user.js
- Webpage: https://abrahamdelosreyes17-oss.github.io/torn-pumping-iron/app.html (gh-pages branch; without the script it shows the placeholder)
- Repo: https://github.com/abrahamdelosreyes17-oss/torn-pumping-iron (public; `main` + `gh-pages`)

**Next session, start here:** the owner answered every round-3 decision, so build (R1 → R7; the Discord bot in parallel by an agent). Read this file, then **`docs/ROUND3-PLAN.md`**: every request from the owner's live check (and their friend's), what is built / mockup only / designed / not started, the open decisions, and the build order R0–R7. Then `docs/bugs-after-1.0.1.md`, `docs/discord-bot-design.md`, the round-3 mockups (`mockups/round3/index.html`, served by the `harness` launch config at http://127.0.0.1:8785/mockups/round3/index.html). Background: `docs/BUILD-PLAN.md` (history), `docs/ENGINE-SPEC.md` (maths), `docs/DESIGN.md` (look; round 3 adds cards + more room, see `mockups/round3/r3.css`), `docs/audit-1.0.md`.

---

## 1. Start here

- **What it is:** one Tampermonkey userscript for Torn City. It includes:
  - a **gym planner**: what to take, when, what to train and how many trains, and the cheapest place to buy;
  - **Torn Eye**: whether you beat a player and how much HP you keep, plus war mode;
  - a **webpage** the script opens (GitHub Pages host page);
  - an optional **Discord pinger** (a Cloudflare Worker).
- **Users:** the owner (13B networth, ~1B total stats, Private Island) and a returning friend (low stats, under $200M liquid, Private Island).
- **Where it stands (2026-09-29, end of the build session):** M0–M8 built and **1.0.0 released** on the owner's yes ("commit and publish the page"): `main` and `gh-pages` pushed, links at the top. Next: the owner's live check (§8), then fixes as a 1.0.x.
- **Releases from now on:** only when the owner asks ("asking for the link means release", trading's rule): bump the version, `npm run check` + both browser checks, commit, push `main`, verify the pinned raw file's `@version`, give the pinned link. `gh-pages` only changes if `site/` does.
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
| M6 | Torn Eye | ☑ 183 tests + torn-check 45/45 + ux-check, 2026-09-29 |
| M7 | Discord service (Worker) | ☑ 204 tests (14 Worker), 2026-09-29 |
| M8 | Hardening, README, release prep → ask the owner | ☑ 220 tests + ux-check + torn-check, 1.0.0 built; waiting for the owner |

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
- **One layout (owner, after 1.0.0):** Compact only; no density switch.
- **The panel on Torn (owner, after 1.0.0):** docked like NPC Arbitrage, collapsed/expanded with Alt+`, living beside the trading script's panels (left margin first), never over them.
- **Taking turns with Torn Trading (owner, end of 2026-09-29):** Pumping Iron and Torn Trading never run together: while Torn Trading runs, Pumping Iron pauses (no Torn calls, nothing on Torn's pages, a warning-sign panel); so Pumping Iron may use Torn Trading's limits (70 Torn, 80 TornW3B). Replaces the 1.0.1 "share the limit" idea.
- **Learning is a developer thing (owner):** "What it learned" lives on Settings › Developer, not on Progress or Torn Eye; export learning data as .zip for everyone; a developer key (owner + Claude) unlocks the rest.
- **Round-3 answers (owner, 2026-09-29, end of session):** six tabs stay; goals become "Train toward" on Plan; special refills default 0 until set (and "use N of X in this plan", never per day); Progress before history = planned line + today; Torn Eye Chain = only green/light green, most respect first; War = everyone coloured by risk, hospital-out times, travel destination + estimated landing; the plan chooser is a stand-out **"Plan"** dropdown, default **Most stats in my budget** (also Best value for money, Max gains no budget); bug fixes ship **with** the redesign; the developer key lives in `.claude/dev-key.txt` (git-ignored; read it back when the owner asks); while Torn Trading runs keep showing the last plan (no calls), update by itself afterwards with one catch-up entry.
- **Round 3 (owner, 2026-09-29):** the round-3 mockups are liked (with more breathing room and cards, done); no UI code until the open decisions in ROUND3-PLAN §3 are answered. Plan must say why other plans lost and show price vs gains; show only what fits the player (tick to show the rest); the app improves itself from the player's own trains and fights; energy from cans/FHC/special refills and a spend-per-day from income; company jump variants; upcoming Torn events; one click, no thinking.
- The attack, targets and war side is called **Torn Eye** (the owner said "call this one Torn Eye (kinda like a spy)"; read as the fight side inside Pumping Iron).
- **Plan types:** Steady, Goal (unlock gym / reach build / stat numbers), Jump (choco, EDVD, 99k). Jump plans are strict (warn before a timing, then re-time). Steady and goal plans re-time silently. There is no strict/adaptive switch; buying re-prices daily.
- The app recommends, with a dropdown of alternatives. A worse pick shows a warning ("not worth it; train natural energy and drug cooldown instead, unless you have Ignorance Is Bliss").
- **Property:** just read the property's max happy; no rental finder.
- **Builds (owner, 2026-09-29, replaces "Balanced until George's"):** "balanced is never really the way to go, it's not meta, better to be a specialist as we can even put merits there"; the app calculates from the build type you want. You pick Baldr's or Hank's with a high stat (DEF/DEX high = their defensive versions), Tank or Offense; Balanced is last. Until you pick, plans use Baldr's STR high and Home asks you to pick. Before George's, trains still move toward the build. Torn Eye uses your effective stats (merits and passives from the battlestats modifier).
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
| Buy window | 3 days (Today / Week on the switch) |
| Budget for the recommendation | $150M over 30 days (Plan › Plan for) |
| Specialist gyms | Assumed to open once George's is unlocked [calibrate] |
| War mode | Enemy faction read every 10 s while that tab is visible; rows re-ordered on screen only |
| Public-stats estimate | TornTools' rank buckets, labelled rough |
| Discord for two | One Worker with an invite code; the friend's own webhook and custom key stored on it (disclosed) |
| The 99k jump | Hidden unless the booster cap is above 24 h (it equals the EDVD jump otherwise) |

## 5. Key findings (details in docs/)

- **(2026-09-29, from the engine)** With all four stats trained toward a build (not STR alone as the first sims did), happy boosts pay more at ~100k per stat: for the friend over 30 days, steady +338k/$126M, daily choco +9% for +$35M, EDVD jump +86% for +$387M, choco jump −2% for +$15M. On a $150M budget steady stays recommended; the choco jump is still warned against.

- **All friend figures here and in the mockups use EXAMPLE stats** (118k/111k/96k/83k); the owner: "you don't even know his stats yet". The app works from his real stats once his key is in.
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

## 8. Release 1.0.0 (done 2026-09-29; the steps, for the next release)

Done on the owner's yes. For later releases, the same steps minus the one-time remote and gh-pages set-up:

1. `npm run check` (all green) and the two browser checks:
   `PWPATH=<scratchpad>/node_modules/playwright-core node test/ux-check.mjs` and `… node test/torn-check.mjs` (install playwright-core into the session scratchpad with `npm i playwright-core@1`; they drive the installed Edge).
2. (done once) `git remote add origin https://github.com/abrahamdelosreyes17-oss/torn-pumping-iron.git`; Pages serves `gh-pages` /.
3. `git add src test worker site build.mjs package.json README.md HANDOFF.md CLAUDE.md torn-pumping-iron.user.js .gitignore` (never `docs/`, `mockups/`, `.claude/`; they're ignored) → commit → `git push -u origin main`.
4. gh-pages: `git checkout --orphan gh-pages`, keep only `site/app.html` and `site/.nojekyll` moved to the root, commit, `git push origin gh-pages`, back to `main`. Check https://abrahamdelosreyes17-oss.github.io/torn-pumping-iron/app.html shows the placeholder.
5. Verify: `curl -s https://raw.githubusercontent.com/abrahamdelosreyes17-oss/torn-pumping-iron/<sha>/torn-pumping-iron.user.js | grep -m1 @version` → `1.0.0`.
6. Give the owner the pinned install link (`…/<sha>/torn-pumping-iron.user.js`) and the `@updateURL` link (`…/main/torn-pumping-iron.user.js`), plus a second commit putting the pinned link at the top of this file.

**What the owner should look at first (live, read only), in order:**
1. Settings → paste a Limited key → "Connected · Limited". Home fills in: do the Energy/Happy/Drug/Refill cells match Torn's bars? (`refills.energy` = "used today" is an assumption.)
2. Gym page: the strip, the outline and **Fill N**. Does Fill put the number in Torn's box so TRAIN uses it? (React may need something other than the native setter; no reference script writes this box.) Is the outlined gym (`selected___`) the one you're in?
3. Items page and a bazaar/Item Market/points page after opening Buy: are the right rows outlined?
4. A profile, a faction page and a ranked war: chips, hover card, the war order and summary.
5. An attack page: the panel; after Start Fight, "saved for next time".
6. Read https://www.torn.com/rules.php (scripting section): our tools could never fetch it. Confirm the page hook (read-only) and the Discord Worker fit.
7. When the Discord server exists: worker/SETUP.md.

**Calibrations that need real data** (all named exports marked [calibrate]): post-50M damping (`POST_50M_MODE`), happy loss per train, fight base damage/zones/accuracy/default gear, life by level, respect base, SSL drug limit, specialist gyms needing George's. Torn Eye's replay test uses FFScouter's published difficulty scale, not real logs: once installed, the owner's own attacks (`myAttacks`) are the data to check it against.

## 9. Open items after 1.0.0

**Superseded by `docs/ROUND3-PLAN.md` (the live check's requests, bugs and order). The items below are still true; they are folded into that plan.**

- **Live check pending** (§8 list). The things most likely wrong, because no source could confirm them: Fill on the gym box (React may need more than the native setter + input event); `selected___` = the gym you're in; `refills.energy` = "used today"; `bars.*.full_time` semantics; the items page Use row; the attack page's armour field (`arm`?); the first attackData answer is missed at `@run-at document-idle` (later polls are read).
- **Calibrate with real data** (named exports marked [calibrate]): post-50M damping, happy loss per train, fight base damage / hit zones / accuracy / default gear, life by level, respect base, SSL drug limit, specialist gyms needing George's. Progress › Gain model collects predicted-vs-actual from the owner's trains (`calibration` in GM storage); Torn Eye can be checked against `myAttacks` (the replay test uses FFScouter's published scale, not real logs).
- **Audit items left as low risk** (`docs/audit-1.0.md`): the panel floats over Torn's content only when neither margin holds 220 px (≈ ≤ 1440 px wide; it collapses to a bar with Alt+`); `.pi-on`/`.pi-outlined` set `position:relative` on Torn's rows; the Worker has no rate limit on invite guesses (constant-time compare only).
- **Owner decisions still open** (defaults in §4): one Discord Worker or one each, sharing captured gear with the friend, the pill on every page.
- **Not built (by plan):** the Discord bot (worker/BOT.md); goal "unlock gym" only re-labels the plan (it doesn't change the split); the 99k jump needs a booster-cap setting (no UI yet; `settings.boosterCapH`).
- **The friend's numbers:** every friend figure in docs/mockups is from EXAMPLE stats. Real ones come when his key is in.

---

## What each session did (newest first)

### 2026-09-29 (night): round-3 build (R1 →)
- Owner: build R1 → R5 without waiting between milestones; Discord bot (R6 B1–B9) by a background agent in a worktree (only `worker/`; the userscript side after the interface is agreed); research on events/job perks by a read-only agent (`docs/research-events-perks.md`).
- **R1 ☑** (243 tests; ux-check and torn-check pass, both with a new pause/resume scenario):
  - **Taking turns with Torn Trading**: `src/core/turns.js` (pure: 60 s grace, 15 s marks, catch-up label) + `src/turns.js` (looks for `#ttv2-host` / `#ttv2-sell-host`, writes `tradingSeenAt`, `onPauseChange`). New read-only `@match` on Torn Bids' `traders.html` (boots only the watcher). While paused: `TornApiClient` sends nothing (`isPaused` → error with `takingTurns`, no code), the feed and slow reads stop, Buy prices and TornW3B stop, Torn pages lose every mark/chip/attack panel and the panel shows "Paused · Torn Trading is on" with a warning sign (amber), the webpage shows the Z-paused banner and "Paused · last read" and keeps the plan moving. Back by itself; the first read after a pause writes one `catchup` log entry ("While paused: +2.1M SPD, Xanax taken"). Limits now Torn 70/min, TornW3B 80/min (Diagnostics too).
  - Bugs: #1 stored price rows → `livePrices()`/`unitPrice()` (10 units from the cheapest up, never $0); #2/#3 jump stack and daily-choco hold read from energy above the maximum (survives midnight); #4 points from `/user/money` into inventory; #6 Steady with Bliss adds EDVD to Xanax steps + projection at today's happy; #7 failed slow reads retry in 5 min and keep old data; #8 refill warning 2 h (was 12 h); #10 comparison key follows all stats, prices, perks, gyms, booster cap; #12 Item Market `limit=100`; #14 held Xanax counts in the numbering; #15 booster cap in the day ctx; #16 only the leader writes day totals; #17 the gym observer follows a replaced root. TornW3B bazaar listings older than 2 min (`last_checked`) dropped.
  - Release note: the new `@match` may make Tampermonkey ask again on update.

### 2026-09-29 (evening): round 3 (mockups, bug hunt, Discord design; see docs/ROUND3-PLAN.md)
- Owner watched with Claude in Chrome (they navigate, we read): the key works after 1.0.1; plan changes froze the page 0.5–1 s (181 ms measured per change on 1.0.1). Built locally: indexed gym lookups (3–5× faster, same answers), first read in 0.5 s, a why-not line per other plan (commits 0bec459, d8b5dc6; not released).
- Fable critiqued the UI (dead space, repeats, Plan's four competing blocks, empty states as paragraphs); round-3 mockups for all six pages with the owner's and the friend's asks; owner: "i like the mockups" + more room and cards (done).
- A read-only bug hunt (17 items, docs/bugs-after-1.0.1.md: live prices make items free in the comparison, jumps stuck at Xanax #1, points always on Buy, Buy hides held Xanax…). A Discord bot design with Torn's rules and sources (docs/discord-bot-design.md).
- Found: the trading script uses up to 70 Torn/min and 80 TornW3B/min, so ours must drop to 25/15 (1.0.1 said 40 and assumed trading used 30).
- Answered: why Daily choco loses (−20% energy trained: the Ecstasy takes a Xanax slot, candy happy lasts one session without Bliss); price per stat for every energy source at today's prices; FHC and cans add on top of Xanax (booster cooldown) at ~$520/stat vs Xanax ~$19.
- The friend sent the console jump guide: docs/research-console-jump.md (a daily cheap happy jump for low stats, with 5★ Toy/Game Shop doubling the console's happy; details to verify).

### 2026-09-29 (later): owner's first live check → 1.0.1
- Owner's notes: stuck on "Reading your state…" after saving a key, nothing opens; wants ONE layout (Compact); must sit beside the trading script's NPC Arbitrage panel (`#ttv2-host`, bottom-right) and Torn Bids window; overlay should dock/collapse like NPC Arbitrage, toggled with **Alt+`** (Arbitrage uses backtick). "finish all first", then release.
- Cause (from the owner's Tampermonkey storage): they pasted their FFScouter **Custom** key; it lacks `bars` and `gym`, so the state call got Torn error 16 on every try. 1.0.0 hid it: the loading screen covered every tab (Settings too), the save warning was swapped away, and the feed retried every 3 s heartbeat.
- Key fix: `stateError` in storage; the feed asks once on error 16 and waits for a new key (other errors: every 30 s); `missingSelections(keyInfo)` names what a custom key can't read; one warning (`src/ui/key-status.js`) on the loading screen (Open Settings), in Settings and on the panel ("Key too limited · open Settings", its button opens `#settings`); Settings always opens; the page stays on Settings after a key is saved; the feed's own error redraws at once (GM change events only fire for other tabs). Harness: `&access=1` answers 16.
- One layout: the Compact/Comfortable switch and `.comfy` are gone (top bar, Settings › Display, store default).
- Overlay → a docked panel (`src/ui/overlay.js`): header bar (plate, countdown, step, –/+) you drag by; body = the old card; collapses to the bar; Alt+` (e.code Backquote) toggles; collapsed state (`overlayCollapsed`) and spot (`overlayPos` = {side, off, y}; 1.0.0's {x,y} is ignored) remembered. It lives in the empty margin beside Torn's page (sidebar + content), LEFT first, so NPC Arbitrage keeps the right; drags are held inside a margin; floats only when neither margin holds 220 px. In the right column its body stops above NPC Arbitrage (read-only look at `#ttv2-host`'s open shadow root). z-index just under trading's. No hover-open, no Alt+P.
- Market/gym labels (`.pi-label`) moved to the top-LEFT of the row; trading's `.ttv2-trader` labels sit top-right.
- Torn API cap 70 → 40 a minute (`TORN_PER_MINUTE`), so with trading's 30 both stay under Torn's 100.
- Checks: 225 tests, ux-check, torn-check (panel: bar, body, Open, Alt+`, click-to-expand, drag), a Playwright check of the error-16 path, a side-by-side render at 1528×784 with a stand-in NPC Arbitrage.

### 2026-09-29: build session (M0 → M8, released 1.0.0)
- Built every milestone in order, researched unknowns with subagents (API shapes, Torn page DOM + fixtures, FFScouter/TornStats/TornW3B), backed numbers with sims, tests first, pages to K. An independent audit before release (`docs/audit-1.0.md`); both FAILs and the day-one bugs fixed.
- Owner feedback mid-M8: "balanced is never really the way to go… better to be a specialist as we can even put merits there"; "you don't even know his stats yet". Built: you pick the build and high stat, specialist first; fights use effective stats; friend figures labelled as examples.
- Released on the owner's "commit and publish the page": `main` (33c89f4) and `gh-pages` pushed; pinned raw file checked at `@version 1.0.0`.
- Tools that worked: Playwright core installed in the session scratchpad (`npm i playwright-core@1`) driving the installed Edge (`channel: 'msedge'`) for `test/mockup-check.mjs`, `test/ux-check.mjs`, `test/torn-check.mjs`. Python edit scripts written to the scratchpad (bash heredocs mangled some quoting).
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
- **M6 ☑** Torn Eye. Core: `src/core/eye/fight.js` (hit chance, mitigation, [calibrate] base damage/zones/accuracy/default gear, seeded Monte Carlo over 5 likely builds or the spy's exact stats, respect, Torn's fair fight), `estimate.js` (spy ≤ 30 d → your fights' FF inverted (1.05–3; 3 = lower bound) → FFScouter (its FF against you, else `bss_public`, else total) → public stats via TornTools' rank triggers, labelled rough), `bands.js`, `gear.js` (attackData → weapons/bonuses/armour; /user/equipment for yours), `war.js` (out early → Okay by band/respect → Hospital by time → Traveling → Abroad; summary). `src/platform/page-hook.js` wraps the page's fetch once and returns Torn's own promise and response (tested: same object; we read a clone). `src/eye-service.js` (FFScouter batched, 5 min memory/1 h stored; spies; profiles; public stats; your attacks hourly; gear in IndexedDB), `src/eye-page.js` + `src/ui/eye/eye-ui.js` (profile chip after the title, hover card with HP-by-build and FFScouter credit, mini-profile chip, faction list chips, war mode: rows re-ordered + summary, enemy faction read every 10 s while visible; attack-page panel that saves gear from attackData), `src/ui/app/eye-tab.js` (targets from FFScouter get-targets ranked by our estimate with the easy↔respect slider, band settings, sources, gear count).
  - Tests: round-2 H band ordering (Stomp/Good/Tough/Can't win) reproduced; war sort on a canned faction; the hook-identity test; a replay of 10 fights described by FFScouter's published difficulty scale (≥ 8 right). **[calibrate]** No real attack logs were available (torn.com is off limits and there is no owner key here): replace the scale replay with the owner's own attacks after install (the app already stores them as `myAttacks`).
  - The "public stats" layer uses TornTools' rank buckets; an energy→stats model was tried (sim) and dropped: the gain formula compounds, so energy alone can't place a player within 10×.
  - `@run-at document-idle` means the first attackData answer may pass before the hook is in; Torn polls it every ~3 s during a fight, so the next one is read.
- **M7 ☑** `worker/` (Cloudflare Worker, no dependencies): `src/alerts.js` (pure: drug cooldown ≤ 5 min with the next drug step, energy full unless stacking for a jump, refill unused 2 h before Torn midnight, strict jump steps 5 min before their tick; the mention in `content`, `allowed_mentions` = that user only; Discord webhook URLs only), `src/index.js` (`GET /health`, `PUT /plan` (bearer secret, stored as SHA-256; the first sync needs `X-Invite` = the `INVITE_CODE` secret), `POST /test`, `DELETE /plan`; cron: one Torn read per user with `Authorization: ApiKey`, one ping per alert id (kept 2 days), dead key 2/13/18 pauses the user), `wrangler.toml` (cron every minute, D1 `DB`), `SETUP.md` (10 minutes, with the Worker key's ToS table, one Worker or one each), `BOT.md` (DMs, /plan, /timers, Done/Snooze later). Tests: `worker/test/worker.test.js` with an in-memory D1 (`fake-d1.js`, fails on unknown SQL); `npm run check` now runs them too.
  - Userscript: `src/api/worker.js` (only `https://*.workers.dev`, bearer secret, invite on first connect), `src/discord.js` (connect keeps only the address, secret and Discord id here: never the webhook or the Worker's key; plan steps synced when they change, ≤ once a minute, visible tab only), Settings › Discord (masked fields, Connect/Send a test ping/Forget, the Worker key's ToS table). `test/worker-client.test.js`: the main Torn key never reaches the Worker.
- **M8 ☑** Hardening and release prep. `README.md` written (install incl. Chrome 138+ "Allow User Scripts", pages, keys with ToS tables, Discord, rules it keeps). Model work cut from ~30 ms/s to ~1 ms/s per tab (projection memoised, model every 5 s; countdowns tick alone). Progress › Gain model now checks itself against your own trains (`src/core/calibration.js`). Screenshots of every tab and Torn page in `.claude/guide/`.
  - Independent audit (`docs/audit-1.0.md`) found 2 FAILs + risks, all fixed: a dead key now stops every Torn call in every tab (`TornApiClient.onDeadKey` + `getKey` returns nothing while dead; "no key yet" is no longer read as "key refused"); the Worker keeps a dead-key pause until a new key arrives and tells Settings; war rows are ordered with CSS `order` (Torn's React rows are never moved); the attack panel never takes the pointer; the TornStats client shares a window across tabs; static refreshes can't overlap or overwrite each other; GM keys are really deleted (the old `set(null)` leaked one key per tab); leaving a page hands the feed lead over at once; the page hook uses `exportFunction` on Firefox; `window.__pi` only on localhost; the Worker key can't be the main key and secret boxes always clear; FFScouter credited on every chip (title), the war summary and the attack panel; the ToS table's wording is exact; TornW3B can be switched off; the Worker has no CORS, no user count, a constant-time invite check and a 5-minute dedupe bucket for drug pings.
  - Owner feedback mid-M8 (builds, above) built and tested (`test/builds.test.js`, ux-check picks DEF high then Hank's).

### 2026-09-28/29: research, three mockup rounds, specs (no code)
- The owner asked for a gym planner ("searches market, makes a plan, recalculates daily, happiness, choco/EDVD jumps, pings on Discord") for themselves and a returning friend, plus an FFScouter-like fight helper that's better ("sometimes it says I win but I end at 1 HP").
- Research: the trading app's conventions, gym mechanics and tools, FFScouter and stat estimation, Torn→Discord, builds and the gym page, attack/war tools and opponent gear, calm dashboards, the design pipeline.
- Simulations: 30-day strategies and build splits (`docs/sims`).
- Mockups: round 1 (A/B/C/T), round 2 (D–I, too empty), then J blueprint + K home (approved: "make every page similar").
- Wrote ENGINE-SPEC, DESIGN, BUILD-PLAN, this HANDOFF, CLAUDE.md, README draft. Saved memory.
