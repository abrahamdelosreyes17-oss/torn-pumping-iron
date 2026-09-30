# HANDOFF: Torn Pumping Iron

**Released: 1.3.0 (2026-09-30, round 6): the lag fix (Torn page load 2.0–2.3 s → 0.14–0.26 s of script at 4× CPU; no background re-planning; Tampermonkey store 696 → 58 KB), Create plan / Recalibrate on the Plan page (the owner's pick: mockup A's card + C's months; clicks verified in ux-check), long plans (gyms, events, a range), the certain income, Torn Eye asks only about the player viewed or attacked, the gym page never greyed. Pinned: https://raw.githubusercontent.com/abrahamdelosreyes17-oss/torn-pumping-iron/f0b448ab325e6d2bddb467a7ac7da617a1aefad3/torn-pumping-iron.user.js (the Worker and gh-pages didn't change).**

1.2.3 (2026-09-30): the lag fix (the plan comparison kept between pages), bot pings early (energy, booster) and without a plan, the synced plan used for up to 48 h, trains on your phone from Torn's log. Details in the newest session entry.**

1.2.2 (2026-09-29): the owner's reports 7–13 (booster cooldown planned for, candy pool, Sally's, real gains, Xanax cooldowns, candy words, why this mix).

1.2.1 fixes and additions:
- **Gym walk-through actually outlines gyms on live Torn:** the gym-icon class is hashed (`gym-1___Ij5f9`), and buttons carry no state class. Checked with the owner's console output.
- **Attack links use `page.php?sid=attack`:** Torn retired `loader.php` for attacks. This covers the Torn Eye button and the bot's links.
- **API lanes:**
  - 85 a minute; the plan's read first, then what's open (Torn Eye with the war first, or prices, or half each).
  - The side not in front keeps to 30% and steps aside in the queue.
  - Diagnostics shows what goes first.
- **Watch list up to 50,** one faction read covering watched players in the same faction.
- **The daily points refill only when it's worth it** under the Plan rule. Plan, Home, Buy and the bot follow.
- **No more lag on clicks** (e.g. ticking Sally's):
  - the plan comparison runs after the page paints, in slices;
  - price-only changes are batched (one run 5 s later);
  - Auto's event comparison runs off the redraw.

1.2.0 (round 4):
- Auto mode is the default plan (from your income; needs a Full key, header warning without it).
- Log in with Discord.
- Torn Eye: only players you beat, no respect cap.
- War mode with advance bot pings; the ☆ watch list.
- Best-split trainer with the gym walk-through.
- The engine names every item; Buy covers the full next jump; console jump under 250k; refills never above max.
- Company what-ifs, receipts and the what-if graph, unlock goal, war reserve.

Links:
- Install (pinned 1.3.0): https://raw.githubusercontent.com/abrahamdelosreyes17-oss/torn-pumping-iron/f0b448ab325e6d2bddb467a7ac7da617a1aefad3/torn-pumping-iron.user.js
- Bot: deployed with 1.2.3 (Worker version c96ec8b1), first run clean.
- Auto-update URL (`@updateURL`): https://raw.githubusercontent.com/abrahamdelosreyes17-oss/torn-pumping-iron/main/torn-pumping-iron.user.js
- Webpage: https://abrahamdelosreyes17-oss.github.io/torn-pumping-iron/app.html (gh-pages branch; unchanged since 1.0.0, `site/` didn't change)
- Repo: https://github.com/abrahamdelosreyes17-oss/torn-pumping-iron (public; `main` + `gh-pages`)
- Discord service: https://pumping-iron.pumping-iron-worker.workers.dev (the owner's Cloudflare; bot in the owner's server)

**Next session, start here (after 1.3.0, 2026-09-30 late):**
1. **Owner's report: "I switched tab to Torn Eye, took forever to load."** Not investigated yet. Likely cause: 1.3.0 moved every Torn Eye read to "only while the Torn Eye tab is open" (the owner's rule), so opening the tab now starts everything at once instead of it being warm:
   - the IndexedDB eye cache (up to 3,000 players) loads on first use;
   - `eyeTab()` asks FFScouter for every stored target (`wantPlayers`), and the 2 s interval starts `pollOwnWars`, `pollWarTab`, the watch list and `syncEye`;
   - `flushOnce` then reads your attacks and gear (`myAttacks`/`myEquipment`, webpage-only now);
   - the tab's render runs `eyeView` (the fight Monte Carlo) for every row;
   - and `eyeTab()` only fires from the 2 s interval after a click (the tab bar uses `replaceState`, no `hashchange`), so up to 2 s pass before anything starts.
   **Do first:** measure it (perf-check-style CDP profile on `harness-live.html?pi=app#eye` with the realistic seed, 4× CPU), then fix. Candidates: start the eye work the moment the tab is clicked (a PiApp tab-change callback instead of the 2 s poll); show the stored targets at once, then fill estimates in; forecast only the rows on screen, in slices; load the eye cache when the webpage opens (a local read, no API call, still within the owner's rule). Keep the rule: no Torn Eye API calls unless its tab is open.
2. The owner's live check of 1.3.0: is Torn still laggy? Do Create plan / Recalibrate / New plan make sense on real data?
3. Owner asked this session, answered (no change needed): the Plan dropdown's rule (Auto, Most stats, Max gains…) only applies at the next **Create plan** or **Recalibrate**; Recalibrate reads the rule as it is when clicked (checked: a 12-month Max-gains plan → Auto → Recalibrate re-plans on the income, same end date). Offered, not built: a line after changing the rule, "Plan rule changed to Auto · Recalibrate to use it".
4. **Ignorance Is Bliss is planned wrong (owner, after 1.3.0):** "happy doesn't reset, so instead of needing candy we take FHC + Xanax + natural." Engine check (owner's stats, Hank's DEF, 30 days, no budget, sample prices; scratch `bliss.mjs`):
   - With the book active the plans already run with Bliss, and FHC + Xanax (steadyMax) wins: +88.7M against +73.5M without the book, and against candy + Xanax at +48.0M.
   - The **what-if** (Plan's Bliss card and the Bliss rows, shown while the book isn't active) only runs "Steady + EDVD" (+57.6M for $585M) and "Daily choco" (+36.1M). It never shows FHC + Xanax + natural with the book, the plan the owner means, so the card undersells the book and points at EDVD and candy.
   - To do: run the what-if for every plan that gains from happy that doesn't reset (at least steadyMax and steadyBoost, i.e. FHC on the booster cooldown, plus candy + Xanax) and show the best; check the recommendation **with a budget** under Bliss (steadyBoost vs candy + Xanax: FHC's +500 happy should build up); check the day plan and Buy name FHC, not candy, when the book is active; check `blissSteady` (Steady + EDVD) isn't still what "Steady with Bliss" means on Home; re-check the Bliss card's words ("boosters and candy keep paying"). FHC's happy and its booster hours: `items.js`.
   - **Overdose (owner):** with the book, happy builds up for days, and a Xanax overdose drops it to 0, losing all of it. The app must (a) **notice** an overdose from the state reads (happy suddenly ~0 right after a Xanax, a long drug cooldown; research the exact signs and whether the log or events say it) and re-time the day from there instead of carrying on as if the happy were still there; (b) **count the risk** in Bliss plans (the chance per Xanax, how addiction raises it, what an OD costs: happy, energy, cooldown, hospital), so a plan that stacks days of happy weighs what one overdose throws away. Research first (wiki, forums, TornTools): OD chance per drug, the effects, whether anything lowers it.
   - **When to read the book (owner):** suggest the best time to start Ignorance Is Bliss (31 days), lined up with events: e.g. start it so its 31 days cover World Diabetes Day's candy ×3 (14 Nov) and/or CaffeineCon (15 Oct, cans ×2) and the Anniversary (+500 happy), the way the year plan already places events (`core/year.js` segments). Value each start date with the engine (the year path with the book on for those 31 days) and say "Read it on 5 Nov: +X more than reading it now". Only when the book is held (inventory, item 770) or worth buying.
   - **Hide Bliss when you don't have it (owner, with the Plan page's 91-day chart as the example):** without the book active or held, no Bliss lines in the chart ("Bliss steady + Bliss", "Daily choco + Bliss" dashed) and no Bliss what-if rows in Other plans. Keep one line in the Bliss card at most ("with the book: +X; price on Buy"), or nothing if it never wins.
5. **Home's timing isn't smart about the booster cooldown (owner, after 1.3.0, screenshot):** strip Energy 0/150 (full 00:28), Happy 3,921/4,000, Drug 3h 49m ("Xanax 1 of 1 today"), Booster 8h 48m ("Next candy boost in 4h 02m"), Refill used. The next step, in 4h 02m: "Tootsie Rolls × 39 (7 yours, buy 32) + Xanax #2, then train STR × 36 at Atlas · right after the 23:30 tick · the booster cooldown has room for 39 of 49". Owner: "my booster is in 8h… it's not saying don't take Xanax yet, wait for the cooldown as this is best gains, or maybe it's better to Xanax now and booster later". To do:
   - **Decide the timing, not just fit what's under the cap.** At a drug-free moment with the booster cooldown still running, compare (a) Xanax now + a partial candy load (what fits: 39 of 49), (b) Xanax now, the full candy boost later when it all fits, (c) hold the Xanax until the booster is free enough for the full load. Pick by stats over the next ~48 h (the look-ahead already rolls days) and say why in the step ("Xanax now: waiting 4h for 10 more candy is worth less than the energy").
   - **Say it plainly on the strip:** "Booster 8h 48m" reads as "no booster for 8 h", but the cap is 24 h, so candy fits now (39 of 49). Show both: the cooldown left and "room for N candy now · full load at HH:MM".
   - **Drug bar always full (bug):** `model.js` strip `drug.total = max(drugLeft, state.drugCd × 1000)`. `state.drugCd` is the cooldown at the last read, so the bar is ~full every read. The total should be the Xanax cooldown's full length (the median `xanaxCd`, else 7 h) so the bar empties as it runs.
   - **"Xanax 1 of 1 today" while the next step is Xanax #2 before midnight (23:30 TCT):** check `xanaxPlanned` (the steps before `tornDayStart + DAY`: a timezone or a step-kind miss, `boost` steps that carry a Xanax aren't counted).
6. Then the backlog below (it starts with the owner's two Torn Eye reports after 1.3.0: a player still listed after being hospitalized, and a wrong "Stomp" on player 173159).

**Round 6 is built and released as 1.3.0 (2026-09-30; newest session entry below).** Owner picked "a mix of A and C" for the Plan page; built and released on "push and commit". Lag at 4× CPU (median of 3, 1.2.3 and now back to back): page load 2.0–2.3 s → 0.15–0.26 s of script, worst task ~0.5 s → 0.1–0.15 s, steady 230–340 → 22 ms per 10 s, GM 696 → 57 KB, GM writes ~10–42 → 1–2 per 10 s. 

**Round 6 background (done in 1.3.0; for reference):**
0. `docs/ROUND6-PLAN.md` is the round's plan. 1.2.3 was laggy on real Torn. The owner decided: **no more automatic** (the plan is made on a click and saved: Create plan for 1/3/6/12 months; Recalibrate keeps the end date, re-reads everything, and works any time, a day later too; everything else follows the saved plan as now). §8 of the plan is the build order. No spending, not on phones, stick to Tampermonkey (no extension); the owner's answers are in the plan's §7a.
   - **Owner, mid-build (2026-09-30):** "Torn Eye should only run when I'm on the Torn Eye tab, and it should only call the API of the person I am viewing and attacking." Built: see the newest session entry.
   - **Owner's answers (2026-09-30, mid-build):** the beer what-if: **skip it**. The rush-the-next-gym and Music Store what-ifs: **backlog**. New: **Pumping Iron doesn't count rehab fees** (Xanax builds addiction; rehab costs money): **backlog**.

**Backlog (owner, 2026-09-30):**
- **A player the owner just put in hospital still shows in the list (owner, after 1.3.0; likely player 173159, the Stomp below).** Probably Torn Eye › Targets (to confirm: Targets, Chain or War?). The targets list comes from FFScouter's get-targets, stored, and nothing marks a player as hospitalized afterwards. Since 1.3.0 statuses are read only while the Torn Eye tab is open. To do:
  - after your own attack (`myAttacks`: result Hospitalized/Attacked/Mugged, with its time), hide that player or grey them with "in hospital ~until HH:MM", no call needed; Torn's hospital time after a hit is known roughly (research the typical duration, or read it once);
  - when the tab is open, the rows on screen could get a status read (a profile call each, within the eye lane), and "Hospital" rows go to the bottom or are hidden with a tick to show them;
  - the same check for Chain and War (War reads the enemy faction's statuses every 10 s while that view is open, so it should already show hospital: confirm).
- **Torn Eye called a fight "Stomp" that wasn't (owner, after 1.3.0):** the owner ended at ~50% HP and had to use a pepper spray. Stomp means win ≥ 99% and keep ≥ 75% HP (`DEFAULT_BANDS`), so the HP-kept estimate was far off, and maybe the win chance too. To do:
  - **the target: player 173159** (https://www.torn.com/profiles.php?XID=173159; the owner's attack on 2026-09-30, likely the same player as the hospital-list report below). Still to get from the owner: what the chip said (win %, keep %, the source tag: FFScouter N d / spy / your fight / public stats). Look him up read-only through the API or FFScouter with the owner's key, never by opening torn.com;
  - find that fight in `myAttacks` / the fight log (Settings › Developer export) and compare it with the prediction saved on the attack page (`eyePredictions`);
  - check what drives an over-confident Stomp: FFScouter's estimate being stale or low, the build guesses (the Monte Carlo over 5 likely builds), their gear (unseen before Start Fight), and the fight model's [calibrate] constants (base damage, zones, accuracy, default gear);
  - the HP-kept learner has never run, because `hpKept` is always stored null (R6.6 leftover). Recording the HP left after each fight (from the attack page or the attack log) is what would catch this for real.
- **Rehab (owner asked twice; not in the app yet):** Xanax builds addiction; rehab (in Switzerland) costs money and a trip. The plans count no rehab fee, and no effect of addiction (research: does it lower gym gains or raise the overdose chance?). Research the fee, how fast addiction builds per Xanax, and what it does; then add the cost to every plan that takes Xanax (and to Buy/receipts), and plan rehab trips if addiction hurts gains. Goes with the overdose work in item 4.
- Rush-the-next-gym and Music Store 3★ what-ifs (research-gym-unlock.md §5).
- R6.6 leftovers that need real data: log-joined gym samples (P2: the gym log's DEF/SPD/DEX field names must be confirmed on one real answer), the split re-tune (P7: must win on held-out real days), the fight HP-kept learner (hpKept is never recorded).
- GM store 55 KB vs the 30 KB target (userStatic 14K, myAttacks 10K, prices 5K, eyeWatch 4K, calibration 4K).
1. Read this file (§2 how the owner works, §3 settled decisions), then **`docs/ROUND4-PLAN.md`** (§0 is the owner's round-4 decisions) and the two newest session entries below.
2. **Live state (2026-09-29, end of session):**
   - The owner is logged in with Discord. The bot DMs work: test ping, a jump ping and "Energy is full" auto-closing all seen in the `sent` table.
   - Client Secret and redirect are done.
   - Read the service without keys:
     `cd worker; npx --yes wrangler@4 d1 execute pumping-iron --remote --json --command "SELECT substr(id,1,8) id, linked, paused, last_error, datetime(updated,'unixepoch') synced FROM users"`
     (never select `torn_key`).
3. **Owner to-dos:**
   - A Full key in Settings (Auto mode).
   - The friend joins the Discord server, then Log in with Discord.
   - O5: read Torn's rules.php.
   - Learning-data exports after a week or two.
4. **Check live next time** (read-only, with the owner): does the gym page now outline the right gym, and does "open the … gyms" show when its button isn't on the page? Also verify:
   - the Sally's shop link (`shops.php?step=candy`) [verify];
   - special refills blocking the points refill (1 source);
   - `user/{id}/profile` last_action for watch pings;
   - the gym-page energy-bar selector (`#barEnergy [class*="bar-value___"]`);
   - money-log title matching [calibrate].
   - (1.2.3) the gym log's field names for DEF/SPD/DEX (`defense_increased`…, [guess]): once the owner's Full key is in, Diagnostics or Progress › Last trains should show a "Torn log" session with a gain, not "—";
   - (1.2.3) the energy ping lands 30–90 s before the bar fills; the booster one 30–90 s before its cooldown ends.
5. **Owner defaults to confirm:**
   - watch list 50 players (60 s for those close to out, 5 min for the rest) and bot pings on;
   - Keep for war days starts at 0;
   - the API shares (the side in front gets the whole minute, the other 30%, both open half each).
6. **Known gaps:**
   - `/link CODE` (own-service path) still moves a link silently.
   - The comparison is ~150 ms of work (run in slices now); a Web Worker would take it off the page entirely if it's still felt.
   - The FFScouter list honouring `minff`/`maxff` is unconfirmed: Torn Eye stores `ffIgnored` when a slice comes back out of range.
7. **Built in 1.2.2 (owner's items 7–13):** see the newest session entry. Still open from them:
   - **Training the split on real data: not yet** (answer "not yet, yes in 1–2 weeks"). Receipts and learner samples only started 2026-09-29 and live in the owner's browser. Once the owner and the friend have 1–2 weeks (from ~2026-10-06, better 10-13) and export them: compare what `pickStat` chose with the alternatives on their real sessions; change `SPLIT_HAPPY_WEIGHT`/the band only if it wins on held-out days (the way `core/learn.js` keeps a change).
   - **Live checks with the owner (read-only, the owner navigates):** the gym page outline and the "open the … gyms" hint; the Sally's link `shops.php?step=candy` (4 sources now) and that `cityitemsbought` moves when the owner buys there; the Buy row caps at what's left of the 100; the rest of item 4's [verify] list.
   - **Watch:** the first days of "Next 48 h" and the strip's "Next candy boost in …" against what the owner does; the recorded Xanax cooldowns (3 needed before the median is used).
8. **Ideas recorded:** the learned HP-kept model, timing habits, happy loss per train.
Research and background: `docs/research-events-perks.md` (events, job perks, the console), `docs/review-fable-2026-09-29.md` (the three-pass review, all fixed), `docs/research-learning.md`, `docs/discord-bot-design.md`, `worker/USERSCRIPT-INTERFACE.md`, `docs/ENGINE-SPEC.md`, `docs/DESIGN.md` + `mockups/round3/` (the look every page follows now).

---

## 1. Start here

- **What it is:** one Tampermonkey userscript for Torn City. It includes:
  - a **gym planner**: what to take, when, what to train and how many trains, and the cheapest place to buy;
  - **Torn Eye**: whether you beat a player and how much HP you keep, plus war mode;
  - a **webpage** the script opens (GitHub Pages host page);
  - an optional **Discord pinger** (a Cloudflare Worker).
- **Users:** the owner (13B networth, 142M total stats (STR 35M, SPD 4M, DEF 82M, DEX 20.5M; level 50; checked 2026-09-29, the old "~1B" was wrong), Private Island) and a returning friend (low stats, under $200M liquid, Private Island).
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

### 2026-09-30 (late night): Plan page buttons (A + C), release 1.3.0
- Owner: "mix of A and C, build that, make sure button works, push and commit", then "send me the link".
- **Plan page** (`src/ui/app/plan.js` `planCard`, `monthsRow`, `lengthChoice`; styles in `src/ui/styles.js`):
  - **No plan:** "No plan yet", the lengths (1 / 3 / 6 / 12 months) and Create plan.
  - **With a plan:** the card "N-month plan · <today's plan>", dates, day X of Y, made/recalibrated (with the budget change), a progress line, **Recalibrate** (disabled once ended) and **New plan…**. New plan… opens the lengths and Create plan, which asks "Replace your N-month plan?" (Replace it / Keep mine).
  - **Months row (C):** total stats planned at each month's end, "you are here", "~" after month 3, the cost a month, the whole plan's range, the gyms opening.
  - **Control bar:** the budget is "$ a day" (the plan's length comes from Create plan), with "used by the next Create plan or Recalibrate".
  - **Recommended card:** while you follow the saved plan it says so instead of "Use it"; after a pick of your own it offers "Back to the saved plan".
- ux-check clicks every button (`&noplan=1` start): Home's "Create your plan", Create plan 3 months (91 days saved), Recalibrate (same end, new rev), New plan… 12 months → the replace confirm → Replace it (365 days).
- README: the Plan section (Create plan / Recalibrate, no automatic, the certain income), and Torn Eye's API rule.
- **Released 1.3.0** (f0b448a, handoff 8bcadc6, pushed): 594 tests, ux-check and torn-check ALL PASSED, perf (gym, 4×): load 138 ms, steady 17 ms/10 s, GM 58 KB. Pinned raw file and `main` checked at `@version 1.3.0`. Worker and gh-pages unchanged.

### 2026-09-30 (night): round 6 build: perf check, saved plans, store diet, gym page, Torn Eye on its tab (not released)
Owner: build round 6 in the plan's §8 order, prove each lag fix with perf-check numbers, mockup first for the Plan page buttons, local commits only.
- **R6.0 perf check** (`test/perf-check.mjs`, `npm run perf`; same PWPATH as the browser checks):
  - a realistic seeded store (`test/perf/seed.mjs`: ~780 KB GM + 3,000 players in IndexedDB, receipts 1 day like the owner);
  - Tampermonkey-like GM (`harness-live.html &gm=tm`: a copy per read, writes sent to other tabs), 3 tabs on one thread, a churning Torn-like page (`&churn=1`), 4× CPU;
  - the warm-up opens the webpage (Create plan 12 months, the archive drain), then a Torn page, like a player who updated;
  - prints load and steady script, long tasks, GM size, which keys were written, what was requested; `RUNS=3` gives medians (one run varies ±80 ms);
  - targets (4×): load script ≤ 350 ms, worst task ≤ 200 ms, steady ≤ 60 ms/10 s, GM ≤ 30 KB, ≤ 2 GM writes/10 s. Logs `docs/perf-*.log`, rows `docs/perf-round6.jsonl`.
- **Numbers (4× CPU; gym / plain / profile; single runs):**

  | Step | Load script ms | Worst task ms | Steady ms/10 s | GM KB | GM writes/10 s |
  |---|---|---|---|---|---|
  | Baseline 1.2.3 | 2,090 / 2,049 / 2,189 | 495 / 481 / 479 | 278 / 238 / 271 | 696 | 7–10 |
  | R6.1 saved plans | 432 / 402 / 567 | 355 / 312 / 349 | 194 / 184 / 214 | 689 | 7–9.5 |
  | R6.3 gym + refresh costs | 307 / 341 / 392 | 177 / 185 / 140 | 169 / 171 / 101 | 689 | 8 |
  | R6.2 store diet + Torn Eye rule | 300 / 232 / 327 | 196 / 137 / 140 | 63 / 67 / 65 | 55 | 1–2 |

  The final before/after will build 1.2.3 and the final version and run them back to back, median of 3.
- **R6.1 saved plans (engine):**
  - `core/saved-plan.js` (pure): `planWindow` (1/3/6/12 months), `daysLeft`, `planProgress`, `monthlyOf`, `snapshotOf`, `makeSavedPlan` (with a recalibration `history`), `planNowOf` (the small part Torn pages follow). `platform/plan-store.js`: the whole plan in the webpage's IndexedDB, GM fallback.
  - `runtime.js`: `createPlan({months})`, `recalibratePlan()` (same end, the days left from today, any time), `followStrategy(id)` (another saved plan), `setWhere('app'|'torn')`.
  - Removed: the comparison on every page (`compareCache`, `compareBusy`, the turn), Auto's background re-pick, the event comparison and switch, `candyPick` writes; `dropOldKeys()` deletes them once.
  - Torn pages build a light model from `planNow` (no ladder, a 2-day projection, no unlock rows); the webpage reads the whole saved plan. Home says "Create your plan" until one exists (steps follow the picked plan, steady by default). Recalibrate keeps a plan you picked yourself.
  - Interim Plan page: shows the saved plan; its controls are what the next Create/Recalibrate uses. Harness: `&plan=1&follow=steady`.
- **Mockup** `mockups/round6/R6-plan.html`: A (the plan as the page's chalk card with Recalibrate and New plan), B (length and buttons in the control bar), C (a row of months with "you are here"); plus the no-plan state. Numbers from `docs/sims/round6/mockup-plan.mjs` (the owner's real stats). **Finding:** the year compounds fast for low SPD (4M → 36M in a month): year totals shown as "~" until R6.5's band.
- **R6.3 (done so far):** the gym page never greys Torn's boxes; one strip line "This session trains at X: open it · then STAT × N"; the page's selected gym wins over the API's; the gym observer redraws only when Torn's own values change (`gymPageSig`, `takeRecords` after drawing); the learner's 6-hour check before its reads; `livePrices` once per price load; the first model on `requestIdleCallback`; the panel placed after the first paint.
- **R6.2 store diet** (`platform/archive.js`, `docs/research-gm-keys.md`). IndexedDB is per site (torn.com vs github.io) and the leader can be a Torn tab, so:
  - histories keep their recent part in GM (stats history 8 days, day totals 2, receipts 3, price history 8, calibration 20 samples, eye predictions 30); the webpage moves the rest into its IndexedDB (`drainArchives` at start and every 10 min; GM trimmed only of what was copied) and reads both (`archived`);
  - webpage-only data lives in its IndexedDB (`pageGet/pageSet`: money log, gym log, fights, learn log, plan line, targets, watch state, flights); the gym log and the learner run on the webpage only (Torn's log refills gaps);
  - prices: one small row per item in GM (`slimPriceRow`: `u` unit, `low`), the listings per site (`localPrices`);
  - writes: leader claim every 10 s (stale 30 s), request windows once per 2 s burst, focus heartbeat on change or every 20 s (it wrote every 4 s: a bug), stats history and day log on change, receipts parsed once per inventory read, the stored inventory keeps only known items;
  - GM 696 → 55 KB (left: userStatic 14K, myAttacks 10K, prices 5K, eyeWatch 4K, calibration 4K). **The 30 KB target isn't met yet.**
- **Torn Eye (owner's rule):** on Torn's pages only the player on the profile or attack page is asked about; faction/war lists and mini-profiles show what's known (war rows sorted from the page, "live war mode on Pumping Iron's Torn Eye tab"). The watch list, war mode, own-faction wars, target estimates, your attacks and gear run only while the webpage's Torn Eye tab is open. **Trade-off to tell the owner:** the bot's war/watch lists sync only while that tab is open.
- **Later the same session:**
  - **R6.3 rest:** Torn pages rebuild the model only when due (30 s, a step's time, midnight) or on a change (`modelDue`); a Torn Trading pause redraws at once; Torn Eye's hover card stays within a chip, its forecast memo keys your stats in 1% steps, its cache is saved only on change.
  - **R6.4 income floor** (`core/income-floor.js`, `fetchPassiveIncome`, feed job `passive` every 6 h): city bank profit ÷ its term, money dividends (amount × blocks ÷ days), rent of your rented properties. Auto: certain + other (the money log without the bank/dividend lines the floor counted; a maturity line never counts), or max(certain, networth growth); Auto plans on the Limited key when something is certain. Harness: the owner has a bank investment, a TCI dividend and a rented island.
  - **R6.5 the long plan** (`core/year.js`): segments re-picked every 30 days and for each event (from 2 days before), gyms opening as energy is trained (ladder fee paid; specialists after their ladder gym, membership paid when first used; SSL never, its drug rule), events on their dates (`eventsBetween`: the API's year + date rules; Easter by the computus; the Anniversary's +500 E), held boosters/specials/the live booster cooldown used once over the path, a band (same path, gain model ±5%, happy loss ±10%; `centre` = the path). The saved plan keeps the path (`year`), `planNow.schedule` says which plan each stretch follows; the model follows it unless you picked one (`followStrategy` / `followPath`). **Finding:** the engine grows the friend 0.4M → ~530M and the owner 142M → ~1.8B in a year: too fast (research warned), so year totals are rough until the learner calibrates.
  - **R6.6 learner:** a per-stat keep test (z ≥ 3 on that stat's newest sessions; a real +1% kept at 200 noisy sessions, noise ≤ 1 in 6), happy lost per energy learned from Torn's gym log (≥ 150 trains, ≥ 2% change, newest clicks back it; used by the engine via `learnedHappyLoss`), 500 samples. Not done (need real data): log-joined samples (P2), the split re-tune (P7), the fight HP learner.
  - **R6.7:** nothing to build (owner: beer skipped; rush, Music Store and rehab fees backlogged).
  - **R6.8 bug hunt:** three reviewers (saved plans/year, store diet, Torn pages/Eye/income/learner) found 23 issues, all fixed (commit "R6.8 review fixes"). The big ones: two webpage tabs could overwrite each other's IndexedDB archive and lose history (now one IDB entry per key, merged in one transaction, one tab drains via Web Locks); the year sim used Sports Science Lab and specialist gyms for free and reused held items every stretch; following the saved path showed "X would gain more"; the Plan tab crashed while the whole plan loaded; a paused income read stored "nothing certain" for 6 h; the Torn Eye tab opened by a click never loaded its targets.
  - **Final numbers (4× CPU, median of 3; gym / plain / profile):** 1.2.3: load 2,322 / 2,172 / 2,049 ms, worst 554 / 481 / 475 ms, steady 336 / 321 / 228 ms per 10 s, GM 697 KB, ~42 / 42 / 10 writes per 10 s. Now: load 149 / 210 / 256 ms, worst 105 / 149 / 133 ms, steady 22 / 22 / 23 ms per 10 s, GM 57 KB, 1–2 writes per 10 s (logs `docs/perf-final-before.log`, `docs/perf-final-after.log`). All targets met except GM ≤ 30 KB.
- Checks: 594 tests, ux-check and torn-check ALL PASSED, perf check as above.

### 2026-09-30 (evening): 1.2.3 still laggy → research only, round 6 planned (no code)
- The owner: with Pumping Iron on, the whole of Torn is laggy (start-up, the gym). The 1.2.3 harness had missed it because its store starts empty. Eight researchers (docs/research-lag-*.md, research-year-events, -gym-unlock, -beer-crimes, -passive-income, -learner-retrain) found the causes:
  - **Auto** runs the comparison twice on every page (its budget falls back on a null `pi.compare`);
  - every page builds the whole model cold;
  - training actions keep re-keying the comparison;
  - Tampermonkey hands the whole ~0.5 MB GM store to every page and re-sends it on every small write;
  - the gym observer redraws on any mutation.

  Torn Bids isn't laggy because it keeps its growing data in IndexedDB.
- The owner's decisions (memory `owner-decisions`, "Round-6 answers"): no automatic; Create plan / Recalibrate; follow the saved plan; no money; no phone; extension OK. The gym page "greyed out" issue is added (plan §3.3b).
- `docs/ROUND6-PLAN.md` holds the consolidated plan and the questions for the owner, with the measured numbers in its §2. At 4× CPU with the owner's setup (Auto + Full key, receipts under 3 days): 1.6–2.0 s of script per page load; without that bug, 0.35–0.5 s. All research and profiling scripts are in `docs/sims/round6/`.

### 2026-09-30 (later): 1.2.3 — lag fix, bot pings early and without a plan, 48 h plan, phone trains
Owner: "fix all issues, commit and push, remember to bug hunt before releasing".
- **Lag:** the comparison is kept between pages (`K.compareCache`: build version + content hash `PI_BUILD_HASH` from build.mjs, key, compare, whatIf, jobWhatIf). A page adopts it when its key matches; otherwise the last one shows while a visible tab works the new one out in slices (`K.compareBusy` turn, 5 s, renewed per slice, released on pagehide; a newer change stops a run at its next slice; a click undone drops its run). Saving today's candy re-keys the cache instead of running again. Hidden tabs don't refresh (`pi.stale`, caught up on visibilitychange). Event comparison cached too, and not started from a comparison still being worked out. Engine: `happyTerms` (gain.js) cached for the last 4 happy values, used by `gainPerTrain` and `pickStat` — bit-identical output (scratchpad bench compared JSON), ~20% faster. Measured at 4× CPU: a second Torn page went from ~2.2 s of long tasks to one ~0.44 s task (0.15 s of it is parsing the script). Minifying would save ~10 ms at 1×: not done (adds a dependency, unreadable errors).
- **Bot (deployed):** energy id is the fill (`energyFill`, kept in `prev.fill`): one ping per fill across hour boundaries, a new fill pinged, hourly while full. Booster 30–90 s ahead (`BOOSTER_LEAD_S`), "over" only after a missed window from a fresh read (`PREV_FRESH_S` 10 min; landed too). With no plan in use (out of date, none, or nothing ahead) booster and "drug unused" come with plain text; the nudge once per spell (`prev.drugNudged`). `planStale`: 12–48 h old stays in use while a step is ahead; 48 steps synced.
- **Phone trains:** `core/gymlog.js` + `fetchGymLog` (v2 `user/log`, `log=5300,5301,5302,5303`, Full key) every 15 min in the leader tab; gaps longer than one read (300 lines) filled a minute at a time (`gap`). Progress › Last trains shows sessions only the log has ("Torn log", Plan said "—"). In the learning-data export as `gym-log.json`. Cleared when the Full key is replaced or forgotten. Full key ToS table updated (README + Settings). Research: `docs/research-gym-log.md` (field names for def/spd/dex are [guess]: check one real answer).
- **Bug hunt:** three reviewers (comparison cache, bot pings, gym log) found 15 issues (1 medium each in cache and gym log, 1 medium in bot; the rest low), all fixed with tests (`test/lag.test.js`, `test/gymlog.test.js`, `worker/test/review-123.test.js`).
- Checks: 570 tests, ux-check and torn-check pass (new: second page adopts the comparison; phone session in Last trains).

### 2026-09-30: bot timing, lag diagnosis (no release)
- **Bot pings were sent, not missing:** the `sent` table shows "Energy is full" at 07:40:52 UTC and hourly after, drug at 09:34, "Plan out of date" at 08:42, all `via dm`. The owner got no phone notification: Discord settings on their side (asked them to check the bot DM).
- **Energy ping early (deployed, version 37b0bae6, commit 9ebb0e7):** cron runs land ~52 s into each minute, so the full-only ping came up to a minute after the tick. Now it goes when Torn's `full_time` ≤ 90 s (30–90 s ahead); the id is the hour it fills, and it isn't auto-closed before the fill time. The first run after the deploy was clean.
- **Offered, waiting for the owner:** plan-free booster and "drug unused" pings (today they need a synced plan, and the plan goes stale 12 h after the laptop closes); keeping the 48 h plan valid longer; filling in phone trains from Torn's gym log (`v2/user/log`; gains already count them, Last trains/learner don't).
- **Lag ("masyadong laggy", the friend):** profiled the built script in the harness (Edge, CDP, 1× and 4× CPU). Every Torn page load runs the whole strategy comparison in one go: 160–180 ms at 1×, **~1.1 s at 4×**, then a second run ~5 s later (setting `candyPick` changes its own key; statics arriving too). The comparison lives only in page memory (`runtime.js:242`), so every Torn click recomputes it. Not the learner (a few ms, every 6 h), not the gym redraw after a train (under 50 ms at 4×); the 958 KB unminified parse is ~35 ms at 1× and ~130 ms at 4×. Proposed fix (waiting for go-ahead): store the comparison with its input key and reuse it across pages; never compute in one go on load; stop the candyPick self-trigger; maybe minify. Profiler scripts were in the session scratchpad (`perf.mjs`, `train.mjs`: harness + `Profiler.start` + longtask observer).

### 2026-09-29 (after 1.2.1): the owner's reports 7–13 → 1.2.2
- **Owner's answers this session:** Sally's Sweet Shop counts **by default** (the Buy tick switches it off; replaces "newbies only"). The booster plan below was approved as asked.
- **1. Booster cooldown (item 12), built:**
  - **Simulator** (`strategies.js`): `fitsAt`/`addBooster`; every candy, EDVD, FHC and can goes in only while the cooldown is under the cap (the last overshoots). Daily candy (candyXanax, dailyChoco) eats what fits; none fits → a plain Xanax day, and the refill isn't held back for a boost that can't come. Jumps wait until the whole boost fits. Starts from the live cooldown (`boosterCdMin`, in the compare key by the hour).
  - **Day plan** (`plan.js dayTimeline`): the same rules against `boosterFreeAt(state)`. A Xanax with no room says "the booster cooldown is full; candy fits again at HH:MM TCT"; a short boost says "room for N of 49"; jumps say "no other boosters before it" and when they wait for the cap. Steady with Bliss now takes 5 EDVD on an empty cooldown (was 4; the last one may overshoot, research-confirmed).
  - **48 h look-ahead:** `dayTimeline({until})` past midnight rolls the days (refill, boost, Xanax #1 again). Model: `lookAhead`, `later` (Home's new "Next 48 h" card, natural energy left out), `upcoming` (today + later, sent to the bot, 24 steps max).
  - **Strip:** "Next candy boost in 19h 20m" / "Used · room again in 7h 40m" / "Not used by this plan"; the bar shows the cooldown against the cap. Heads-up: "No candy today · booster cooldown 31h 40m · next candy boost tomorrow 06:16 TCT", or "No boosters before …" ahead of a boost or jump.
  - **What changed in the recommendations** (scratch `cmp.mjs`, sample prices, $150M, 30 days): the same plans win. Owner (Hank's STR high): Candy + Xanax in budget (+78.46M, was +78.48M), Steady + FHC max with no budget. Friend (example stats): Candy + Xanax, and the EDVD jump with no budget. Candy plans now eat 1,358 (candyXanax) / 1,418 (dailyChoco) candy a month instead of an impossible 1,470; gains move under 1.5%, costs drop with the candy. Jumps were already on a ≥ 28 h cycle, so they didn't move. With 31h 40m on the cooldown at the start, candyXanax loses ~60 more candy and still wins.
- **2. Use what you hold first (item 10):** `candy.js fillFromPool` (candy by happy, energy drinks by energy; happiest first; only ≥ the pick's happy), `takeFromHeld`, `fillWords` ("Candy × 49: your 29 Chocolate Kisses + your 20 Lollipop"), `heldWords` ("from your items: … · buy 0"). Day plan steps carry the held items (so `needList` buys 0); `needList` also lets spare held candy/cans cover later needs (`fromPool`); the simulator counts held boosters as free (`o.held`, `used.held`; Buy's later-days average leaves them out). Drugs are not pooled.
- **3. Sally's (item 9):** research in `docs/research-sallys-xanax.md` (100 items a day across all city shops, reset 00:00 TCT, 4 sources; Lollipop $25, Chocolate Kisses $150, Sweet Hearts $500; URL `shops.php?step=candy` confirmed by 4+ sources). `market.js`: `SALLYS`, `shopsAllowed`/`toggleShop` (`npcShopsOff`), `allowanceLeft`, `npcListing(npc, qty, left)`. Feed job `cityShop` every 10 min: `cityitemsbought` now + once a day at `dayStart − 1 s` (Torn's daily snapshot, Sidekick's method). Buy, Home and the market outlines share today's allowance; Buy's controls say "N of 100 city-shop items left today".
- **4. Real gains (item 13):** `core/gains.js` (`gainOver`, `realGains`, `sessionsOf`); `recordDaily` keeps each day's opening stats (`open`). "Your gains" card on Home and Progress: Today / 7 days / 30 days with the per-stat split (today from the day log until a day has its opening read). Last trains: one row a session (reads within 10 min), a Total row, and the note that it only lists clean reads.
- **5. Xanax (item 11):** `core/drugcd.js`: a Xanax is recorded from Torn's drug cooldown right after it (plus half the read gap), only in Torn's 360–480 min range and when the step was a Xanax; the median plans later Xanax once 3 are seen (`ctx.xanaxCdMin`, simulator too). Home's foot: "Torn day resets at 08:00 your time · Xanax cooldown ~6h 52m (your last 5: 6h 10m–7h 40m)". Research: Xanax 6–8 h random, nothing shortens it [unverified that nothing exists].
- **6. Candy disclaimer (item 8):** `tierWords` on the boost step's note, Plan's Recommended card and table tooltip, Buy rows. The day's pick is stored (`candyPick`) and kept unless another +same-happy candy is ≥ 10% cheaper for the boost (`bestCandy({prefer})`).
- **7. Why this mix (item 7):** `gympage.js whyMix`: "STR + DEX this session: +20% toward Hank's vs STR only" on Home (build foot) and Plan; "toward the build" = stat points that close a gap to the build's shares, the same energy either way (tooltip gives both numbers). Shown only when the mix is ahead by ≥ 0.5%.
- **9. Training the split on real data:** not yet. Receipts and learner samples only started 2026-09-29 (they live in the owner's browser; the Worker has no copy), so there's under a day. Earliest check ~2026-10-06, better 10-13, after the owner's and the friend's exports.
- **Review (read-only agent, 13,824 day-plan runs swept):** 4 bugs + 1 risk, all fixed with regression tests: a look-ahead boost after midnight counted on the old day (2 refills and 2 boosts on one day); a before-midnight refill trained a held Xanax (now the refill goes before the hold when the boost lands on a later day); the simulator's dailyChoco could refill twice a day; Buy took held boosters off twice for 3-day/week windows (now gross usage, pooled onto the pick, inventory taken off once in `needList`); Xanax samples across a read gap over 10 min are skipped.
- **Checks:** `npm run check` 547 tests (404 userscript + Worker), ux-check and torn-check ALL PASSED; new `test/r5.test.js` (the owner's cases: 31h 40m cooldown, 29 + 20 held → buy 0, mixed tiers, allowance, sessions, Xanax median, the 10% rule, whyMix, the review's findings).
- **Known gaps:** a boost or FHC within ~2 min of midnight isn't rolled to the new day; `planWhat` leaves candy out when all of it is held of another id; the Worker doesn't get the steps' notes (only labels).


### 2026-09-29 (end of night): 1.2.1 (live fixes after the owner used 1.2.0)
- **Owner live reports and fixes:**
  - "It doesn't highlight the gym I have to use": the owner's console output showed hashed icon classes (`gym-1___Ij5f9`) and bare `gymButton___T6tQg` buttons. `readGymButtons` now matches both; no state class counts as usable; the name comes from the aria-label. Test built from that markup.
  - The Attack button showed Torn's "This endpoint is no longer available … page.php": `attackUrl` and the Worker's link now use `page.php?sid=attack&user2ID=`.
  - "Lag when I click Sally's Sweet Shop": every price batch and every click ran the whole comparison (60+ thirty-day runs, 150 ms in node) on the page, plus Auto's two event comparisons inside the redraw. Fixed:
    - `compareStrategiesAsync` (a generator, one plan per slice);
    - click-driven runs 80 ms after paint; price-only runs batched 5 s;
    - the event comparison deferred and async.
- **Owner asks, built:**
  - API lanes (`core/lanes.js`, priority queue plus per-side shared windows in `api/client.js`; focus heartbeats `apiFocus` from each tab via `pi.focusOf`/`beatFocus`).
  - 85 a minute (Torn Trading is off while Pumping Iron runs).
  - Watch list 50 (userscript and Worker; faction-grouped reads).
  - The daily refill worth-it check (`withBestRefill`, `noRefill` in the day plan, the plan payload and the Worker's refill ping).
- **Checks:** 525 unit tests, ux-check and torn-check ALL PASSED, both harness walkthroughs clean.


### 2026-09-29 (late night, round 4): Discord live, Torn Eye fix, the friend's feedback → 1.2.0
- **Discord bot live (B0):**
  - Worker deployed at `https://pumping-iron.pumping-iron-worker.workers.dev` (D1 `pumping-iron`, id in wrangler.toml).
  - Secrets: INVITE_CODE, KEY_ENC, DISCORD_APP_ID, DISCORD_PUBLIC_KEY, BOT_TOKEN. A copy of the first four is in `.claude/worker-secrets.txt` (git-ignored); the owner uploaded the bot token.
  - Bot added to the owner's server (`GUILD_ID` 1551784561237561344), guild commands registered.
  - **Owner still to do:** OAuth2 redirect `…/login/callback` and `wrangler secret put DISCORD_CLIENT_SECRET`. Until then Log in with Discord answers "isn't set up yet" (501).
- **Owner's decisions** are in `docs/ROUND4-PLAN.md` §0:
  - Torn Eye never imports can't-win targets; no respect cap.
  - War shows everyone, with advance bot pings for enemies you can beat.
  - The split trains whatever is best, gym by gym, with an overlay walk-through.
  - The engine names the candy; the console jump only under 250k.
  - **Auto mode is the default and needs a Full key** (header warning without it).
  - Saving days skip natural energy.
  - The main key goes to the Worker after Log in with Discord.
  - Sally's is newbies only.
  - No "FF" or "fair fight" words on screen.
- **Torn Eye bug (owner's list all "Can't win" at 4.50):**
  - FFScouter's filtered get-targets comes strongest-first, so every row was a 20B-class level-100 account.
  - Fix: slices of fair fight 1–3 × level bands; each candidate judged by the fight model; only beatable stored.
  - The owner is 142M / level 50, not 1B.
- **Built (5 helpers in worktrees plus the lead):**
  - Auto mode: `core/auto.js`, `income.js`, the Full key in Settings, networth history via `personalstats?timestamp`, the money log.
  - Unlock-gym goal.
  - Log in with Discord: Worker `login.js` and the userscript flow.
  - Worker: war and watch pings in advance, `/war` paging.
  - Torn Eye: targets, war mode, watch list.
  - Training split, session parts and the gym-page walk-through.
  - Items: 19 candies, `bestCandy`, city shops, Buy with the full next jump, console, refills to max, company what-ifs, "current plan".
  - Receipts and the what-if graph.
  - War reserve.
- **Review:** three reviews (engine, every UI control, Worker/security), all findings fixed, then a regression review of the fixes. Highlights:
  - Auto's budget fed its own plan cost back in → now only real receipts spend.
  - A 0 budget was read as "no budget".
  - A failed login left Settings stuck.
  - Orphan Worker rows kept keys → `elsewhere` state, `/unlink` forgets, 30-day cleanup.
  - Login flood → evict oldest + 5 per IP.
  - "Forget keys" now also disconnects.
  - The chips switch was ignored on some pages.
  - Refills during a war reserve.
- **Checks:** 513 unit tests; ux-check and torn-check ALL PASSED (Edge headless); a scripted walk-through of every new action in the harness.
- **Assumptions to check live:**
  - Sally's shop URL `shops.php?step=candy` [verify].
  - The specials-block-points-refill rule (1 source).
  - `user/{id}/profile` last_action for watch pings.
  - The gym-page energy-bar selector.
  - Money-log category and title matching [calibrate].
  - `/link CODE` (own-service path) still moves a link silently.


### 2026-09-29 (late night): releases 1.1.0 and 1.1.1
- **1.1.0** on "all, then commit and push to main": b7c9a6a (handoff f5ad677). Pinned file checked at `@version 1.1.0`.
- **1.1.1** on "release": 7cfbcb0. Owner's live notes after 1.1.0:
  - "for train toward i cant change the build": the "Build · …" box was styled like a dropdown but was plain text. It's now a `<select>` of all 11 builds (`buildOptions()` in `src/ui/app/plan.js`).
  - "check torn eye": the owner's list was all "Can't win". Read (our github.io page, read-only) the Torn Eye cache: FFScouter's get-targets had returned fair fight 31–40, bs_estimate ~20B. The live API doesn't apply the documented 1–3 default. Fix: `TARGET_FF` 1.3–2.6 always sent; an old list without it reloads once; a note when a whole list is far stronger than you. The fight maths was right.
  - Owner asked about Auto mode: not built; recorded with the income-key idea in ROUND3-PLAN §5.
- Checks: 388 tests (106 Worker), ux-check, torn-check (1.1.0); 1.1.1 re-ran the tests and ux-check.

### 2026-09-29 (night): round-3 build (R1 → R6) and release 1.1.0
- Owner: build R1 → R5 without waiting between milestones; Discord bot (R6 B1–B9) by a background agent in a worktree (only `worker/`; the userscript side after the interface is agreed); research on events/job perks by a read-only agent (`docs/research-events-perks.md`).
- **R1 ☑** (243 tests; ux-check and torn-check pass, both with a new pause/resume scenario):
  - **Taking turns with Torn Trading**: `src/core/turns.js` (pure: 60 s grace, 15 s marks, catch-up label) + `src/turns.js` (looks for `#ttv2-host` / `#ttv2-sell-host`, writes `tradingSeenAt`, `onPauseChange`). New read-only `@match` on Torn Bids' `traders.html` (boots only the watcher). While paused: `TornApiClient` sends nothing (`isPaused` → error with `takingTurns`, no code), the feed and slow reads stop, Buy prices and TornW3B stop, Torn pages lose every mark/chip/attack panel and the panel shows "Paused · Torn Trading is on" with a warning sign (amber), the webpage shows the Z-paused banner and "Paused · last read" and keeps the plan moving. Back by itself; the first read after a pause writes one `catchup` log entry ("While paused: +2.1M SPD, Xanax taken"). Limits now Torn 70/min, TornW3B 80/min (Diagnostics too).
  - Bugs: #1 stored price rows → `livePrices()`/`unitPrice()` (10 units from the cheapest up, never $0); #2/#3 jump stack and daily-choco hold read from energy above the maximum (survives midnight); #4 points from `/user/money` into inventory; #6 Steady with Bliss adds EDVD to Xanax steps + projection at today's happy; #7 failed slow reads retry in 5 min and keep old data; #8 refill warning 2 h (was 12 h); #10 comparison key follows all stats, prices, perks, gyms, booster cap; #12 Item Market `limit=100`; #14 held Xanax counts in the numbering; #15 booster cap in the day ctx; #16 only the leader writes day totals; #17 the gym observer follows a replaced root. TornW3B bazaar listings older than 2 min (`last_checked`) dropped.
  - Release note: the new `@match` may make Tampermonkey ask again on update.
  - R1 review (read-only agent): 8 findings, all fixed (87b1961): gym observer redrew marks while paused; a future `tradingSeenAt` disabled the pause; a can above max counted as a stacked Xanax (now 50 E slack); a pause mid price-load or mid Torn Eye sweep wiped data; war rows kept our order; points failure dropped the inventory; one drug-count rule. FFScouter and the Discord plan sync also pause now (the Worker still polls with its own key: tell the owner).
- **R2 ☑** (264 tests; both browser checks): the engine for round 3, UI comes in R3.
  - `src/core/strategies.js`: `steadyBoost` (the budget's leftover a day on FHC or cans, whichever buys more energy), `steadyMax` (FHC every time the booster allows: "Max gains"), `candyXanax` (candy after a tick + a Xanax session, no Ecstasy), `consoleJump` (3 Xanax, Game Console item 104 ×60 Hardcore, candy + Ecstasy; **unverified: shown, never recommended**), `consoleJumpToy` (5★ Toy/Game Shop), `edvdJumpAN` (10★ Adult Novelties); in that job the variant replaces the plain plan. Special refills (`o.special`): in a boosted session as many as keep happy above the max, else a day's share; `compareStrategies` runs each plan with and without them and keeps the better (`specialHelps`).
  - **Finding:** every train costs happy (0.5 × energy, [calibrate]), so at the maximum extra energy can cost more than it adds: the friend's 100 special refills add nothing to steady but +30–60% to choco/jump plans. Also: candy + Xanax pays at the owner's shape because heavy training drains happy below max and the candy tops it up (+14% for +$79M; over the $150M budget). A points refill costs more per stat than a Xanax ($1.35M/150 E vs $845k/250 E), so the ladder lists Xanax first (the mockup's "~$5" was wrong).
  - `src/core/recommend.js`: `pickBy` most | value | max (`PICK_BY`), `fits` (≥ 50% of the best plan's stats), unverified plans never picked, why-not lines for the new plans.
  - `src/core/ladder.js`: rows natural → special → cheapest per stat (Xanax, points, candy, FHC, cans) with cooldown, energy, a day, in your plan, and a note (over budget · with Max gains +X a day for $Y).
  - `src/core/events.js` (from `docs/research-events-perks.md`): CaffeineCon (cans ×2), World Diabetes Day (candy ×3), Easter eggs, Torn Anniversary, EAD; the 48 h personal window from `/v2/user/calendar`; heads-up on Home; no boosters in the day before an event that uses the booster cooldown. Feed reads `/v2/torn/calendar` every 12 h.
  - `src/core/perks.js`: both of Torn's wordings (Perks page vs /torn/companies) for gym experience, happy loss, console (toyShop5), EDVD (adultNovelties10), energy drinks, candy, consumable boost/cooldown, Voracity booster hours.
  - Model: `ladder`, `spend` (a day, budget a day, cash on hand from /user/money, how many days it lasts), `events`, `pickBy`, `special {have, left, use}`, `whatIf` (Bliss). Plan store: `pickBy`, `specialUse` (0 until set), `specialStart`.
- **R3 ☑** (18fb5b4): every page to the round-3 mockups (Home, Plan with the Plan dropdown, Buy, Progress, Torn Eye Targets/Chain/War, Settings, Developer, Paused), `src/ui/charts.js`, cards (chalk-edged primary), per-page control bars (`out.ctl`), strip only on Home (Booster only when used), Buy count badge. ux-check rewritten per page (Plan dropdown, Buy ticks, Chain/War, developer key).
- **R4 ☑** except the real-data check (needs the owner's and the friend's exports): the learner (`src/core/learn.js` + `test/learn.test.js`, by a helper in a worktree, merged 0fa6d3a; the fight learner needs ~2,000 fights to spot a 10% error, so it changes slowly by design), `learndata.js` (fight predictions saved on the attack page, joined with your attacks), `zip.js`, runtime learns every 6 h in the leader tab and applies kept multipliers / damping mode (`useDampingMode`) / fight model; Developer page (export .zip for all; the key's SHA-256 only; import; charts; S1+S2 self-check; raw).
- **R6** Discord bot B1–B9 (worker/, by a helper, reviewed, 9 fixes, merged 2d624c9) + the userscript side (07634d1): link codes, acks (Skip re-times, Done informational), Torn Eye list + faction for /targets and /war, sync every 10 min. Left: B0 + B10 (owner).
- **R5 ☑** (f5beddb): clicks 50 → 10 ms, no long tasks idle.
- R2–R4 review (read-only): 11 findings, all fixed but **NOT committed** (owner: "dont commit" while Fable reviews): Progress plan line never drew (ctx key clash), learner froze at the sample cap, a kept model lost after one run, special refills spent 3–4× the daily share, event multipliers unused, booster hold for plans that don't use the event, daily choco without candy perks, plan start reset by any setting, war faction race, can counts +1, learning from a render. 378 tests, ux-check + torn-check pass.
- **Fable's three-pass review** (security, bugs, usability; `docs/review-fable-2026-09-29.md`): security posture strong; the owner said "all, then commit and push to main". Everything fixed:
  - Security: disclosures now say what the Worker gets (plan, player/faction id, Torn Eye list with names); Google Fonts named; Worker user cap (`MAX_USERS`, default 10) and 30 kB bodies; own-property command dispatch; imported zips cleaned; a changed Worker address forgets the old one; the developer key box is masked, not a password field.
  - Bugs: typing survives background redraws (`PiApp.focusedInput/restoreInput`); Torn Eye forecasts memoised and big GM values read through `getShared` (war pages no longer re-run the Monte Carlo every 10 s); Discord Skip is same-day only and re-times the next drug (`drugNotBefore`); the booster hold also waits candy and jump plans; empty budget keeps the old budget ("no budget" shown only when there is none); failed price loads keep the last listings and retry in 30 s; failed Discord syncs retry; one FFScouter client per tab; one Torn Eye sweep at a time; only training events stored from the calendar; learnLog 30; special refills never all in one day; colour bands stay in order; the HP-kept learner row hidden until it has data; Worker: failing rows go to the back, refused messages recorded as failed, shorter embeds.
  - Usability: two clicks for anything that deletes; plan rows, heads-up rows and Torn Eye chips work by keyboard (chips also on tap); dim text raised to muted; narrow windows wrap; wording ("lasts under a day", "stats" per $1M, loading states, "Watching …", attack page "Reading this player…").
  - 388 tests (106 Worker), ux-check (plus a typing-survives check) and torn-check pass.

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
