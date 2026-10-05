# The userscript's side of the bot (proposal for the main session)

The Worker side is built and tested (`worker/`). This is what `src/api/worker.js`, `src/discord.js` and Settings › Discord need so the bot works end to end. Nothing here breaks 1.0.1: old clients keep working, new response fields are ignored, and every new request field is optional.

All calls stay as today: `https://<name>.workers.dev` only, `Authorization: Bearer <secret>`, JSON, through `gmFetch`. The userscript never calls Discord.

## 0. Log in with Discord (1.2.0, the normal way in)

The owner's service address is built in (`https://pumping-iron.pumping-iron-worker.workers.dev`). Settings › Discord shows one button, **Log in with Discord**; the invite code + manual form fold away under "Run your own service" (§1, unchanged).

1. On the click, make a new secret (as `connectDiscord` does) and call

   `POST /login/start` (bearer secret, no body)

   ```json
   200 {"ok": true, "id": "<48 hex>", "url": "https://…workers.dev/login?id=<48 hex>", "expiresAt": 1790680900}
   401 {"ok": false, "error": "Missing or malformed secret"}
   501 {"ok": false, "error": "Log in with Discord isn’t set up on this service yet (…)"}   show as is
   429 {"ok": false, "error": "Too many logins from this network at once. Try again in a few minutes."}   show as is (5 open per address)
   ```

   A new start replaces the browser's previous one. A flood of logins from elsewhere never blocks a start (the oldest open login makes room). Open `url` in a new tab (`GM_openInTab`); the user allows Pumping Iron on Discord (scope `identify` only) and lands on a plain page on the Worker ("Connected as …", "Not in the server", …) they can close.
2. While waiting, every 3 seconds, **whether the Pumping Iron tab is visible or not** (the user is on Discord's tab, so the Torn tab is hidden while they finish there); stop at `expiresAt` (15 minutes) or on any state but `open`:

   `POST /login/status` (same bearer secret) `{"id": "<48 hex>"}` (body at most 1 kB, else 413)

   ```json
   200 {"ok": true, "state": "open", "name": null}
   200 {"ok": true, "state": "done", "name": "Iron Tester"}
   404 {"ok": false, "error": "That login is gone. Start again."}   another secret, or an unknown id
   ```

   `state`: `open` (waiting), `done` (connected: show "Connected as @name"), `not_member` ("Join the Pumping Iron Discord server first, then log in again"), `denied` (cancelled on Discord), `full` (the service serves its maximum), `failed` (Discord or the bot had a problem: try again), `elsewhere` (this Discord account is connected to Pumping Iron in another browser that synced within the last 7 days: show "This Discord account is already connected to Pumping Iron in another browser. Press Disconnect there (Settings › Discord), or type /unlink in Discord, then log in here again."; nothing was stored for this browser), `expired` (over 15 minutes).

   Gave up waiting (the user pressed Cancel, or started over)? `POST /login/cancel` (same bearer secret) `{"id": "<48 hex>"}` → `200 {"ok": true}` (404 for a malformed id, 413 over 1 kB). The login is deleted: finishing Discord's page afterwards shows "This login has expired" and links nothing.
3. On `done`: store `{base, secret, linked: true, name}` and send the first `PUT /plan` (§2) **with `tornKey` = the main Pumping Iron key** (Limited; owner's decision), no `X-Invite` (the row exists: the login made it). The answer has `linked: true` and `ready: true` (key + linked + bot).
4. The connected view: "Connected as @name" · **Send a test ping** (`POST /test`) · **Disconnect** (`DELETE /plan`, which also deletes the logins).

The main key is now stored on the owner's Worker: the ToS table in Settings › Discord is the first one in `worker/SETUP.md` ("Your key on the service": Limited, stored encrypted on the owner's Worker, the owner runs it). `connectDiscord`'s "That is your main key" refusal stays for the manual form only.

## 1. Link Discord (B3; "your own service")

`POST /link` (bearer secret, no body)

```json
200 {"ok": true, "code": "ABCD2345", "expiresAt": 1790680000, "command": "/link ABCD2345"}
403 {"ok": false, "error": "Unknown secret: connect first"}
401 {"ok": false, "error": "Missing or malformed secret"}
```

- Settings › Discord, after Connect, while `linked` is false: a **Get a link code** button. Show the code big, "Type `/link ABCD2345` in your Discord server within 10 minutes", and a countdown to `expiresAt` (unix seconds). The code works once; a new press replaces it. Only on a click.
- Once linked, the next `PUT /plan` answers `linked: true`: show "Linked" and "`/unlink` in Discord disconnects and forgets you (like Disconnect here)". The Discord id field becomes optional (the Worker ignores a typed id once linked; the linked id comes from Discord's signed interaction).
- The webhook becomes optional when the bot is set up (`bot: true` in the answer): the bot DMs, and the webhook is only the fallback.

## 2. `PUT /plan`: new optional request fields

```json
{
  "plan": {"type": "steady", "steps": [...]},
  "ackIds": ["skip:drug:5966931", "done:energy:497133"],
  "targets": {
    "list": [{"id": 1234567, "name": "Iron_Monk", "level": 23, "band": "stomp", "win": 99, "keep": 81}],
    "bands": {"1234567": "stomp", "2345678": "good"}
  },
  "factionId": 777,
  "playerId": 3000001,
  "war": {
    "factionId": 888,
    "members": [{"id": 2345678, "name": "Soon_Out", "level": 12, "band": "good", "win": 95, "keep": 70}]
  },
  "watch": [{"id": 3456789, "name": "Mugger", "level": 40, "band": "good", "win": 88, "keep": 60, "tag": "mugged me"}]
}
```

- `ackIds`: the acks (below) the userscript has applied; the Worker deletes them. At most 50 per sync.
- `targets`: Torn Eye's current list (at most 50, in the order Torn Eye shows it) and a band for every player it has an estimate for (at most 500; war enemies first). `band` is one of `stomp`, `good`, `tough`, `cant`, `none`; `win` and `keep` are percents 0–100 (optional). Send it when the list or the bands change, at most once every 5 minutes; `targets: null` clears. Leaving the field out keeps what the Worker has. Used by `/targets`, `/target`, `/war` and war pings. No fight simulation runs on the Worker.
- `factionId`, `playerId`: from data the userscript already has (the player's own profile). `/war` and war pings need `factionId`; `null` clears.
- `war` (1.2.0): the enemy faction as Torn Eye's War mode sees it, so the bot's war pings and `/war` know who you can beat. `{factionId: int, members: [{id: int, name: str|null, level: int|null, band, win: int|null, keep: int|null}]}`, at most 100 members (the rest are dropped), `band` one of `stomp`, `good`, `tough`, `cant`, `none` (anything else becomes `none`), `win`/`keep` percents 0–100. `factionId` is the enemy faction the list is for (the Worker uses it only when it matches the war it finds). Send it when War mode's estimates change, at most every 5 minutes; `war: null` clears; left out keeps.
- `watch` (1.2.0): Torn Eye's watch list: `[{id, name, level, band, win, keep, tag: str|null}]`, at most 25 (the rest are dropped), `tag` the reason (at most 24 characters). The bot reads at most 5 of them a minute and pings "out of hospital soon", "lands soon" and "came online" for the ones you can beat, and for those with `band: "none"` (saying "No estimate"); never `cant`. Send it when the list changes; `watch: null` clears; left out keeps.
- **Beatable** everywhere = band `stomp`, `good` or `tough`. The Worker runs no fight simulation: it only uses these bands.
- The whole body must stay under 64,000 bytes (UTF-8; 413 otherwise).

## 3. `PUT /plan`: new response fields

```json
{
  "ok": true, "created": false, "ready": true, "paused": false, "lastError": null,
  "linked": true,
  "bot": true,
  "acks": [
    {"id": "skip:drug:5966931", "kind": "skip", "alert": "drug:5966931", "step": {"at": 1790679112, "kind": "xanax", "label": "Xanax #2"}, "at": 1790678950}
  ]
}
```

- `linked`: this user has run `/link`. `bot`: the Worker has a bot token and public key.
- `ready` is now `key && (webhook || (linked && bot))`.
- `acks`: button presses in Discord waiting for the userscript, oldest first. `step.at` and `at` are unix seconds.
  - `kind: "skip"`: the user pressed **Skip step**. Find the plan step with the same `kind` and `at` within ±10 minutes (else the same `label`), treat it as skipped and re-time the plan. `step.kind: "test"` comes from the test ping: just ack it.
  - `kind: "done"`: the user pressed **Done**. Informational only: never mark the plan done from it (the done log still comes from Torn's own state). It may hide the matching in-app reminder.
  - Then send the applied ids in `ackIds` on the next sync. Acks not sent back expire after 2 days.

Sync timing (proposed change): today the plan is sent only when its steps change. Also send it at least every 10 minutes while a Torn or Pumping Iron tab is visible (a plan not synced for 12 hours is "out of date": the Worker then sends only timer pings and one "plan out of date" a day), and on the next allowed minute after an answer that had `acks`. Still at most once a minute, visible tab only.

## 4. The Worker's key (text and ToS table)

After a Discord login (§0) the Worker uses the **main Pumping Iron key** (Limited): no second key to make. The rest of this section is for "Run your own service" (the manual form).

The Worker key now needs (user `profile` is new in 1.2.0, for the watch list): user → `basic`, `profile`, `bars`, `cooldowns`, `refills`, `travel`; faction → `members`, `chain`, `wars`; market → `itemmarket`. Update:

- `connectDiscord`'s message "Make a separate custom key for the Worker (user: basic, profile, bars, cooldowns, refills, travel · faction: members, chain, wars · market: itemmarket)".
- The ToS table in Settings › Discord, to match `worker/SETUP.md` part 3:

| Data storage | Data sharing | Purpose of use | Key storage & sharing | Key access level |
|---|---|---|---|---|
| On your own Cloudflare Worker (D1), the key encrypted (AES-GCM), until you press Forget | Nobody: pings and replies only you can see (DMs, replies only you see, or your own webhook channel) | Personal gain (gym pings and timers); Competitive advantage (`/war`, `/chain`, war and watch-list pings) | Stored / Used only for automation and the commands you type | Custom (user: basic, profile, bars, cooldowns, refills, travel · faction: members, chain, wars · market: itemmarket) |

- Third parties line: `/buy` and price watches read TornW3B (weav3r.dev) bazaar prices; no key is sent there.

## 5. Unchanged routes, new behaviour

- `POST /test`: when linked, the test ping is a DM with Done / Snooze / Skip / Open in Torn (otherwise the webhook, as before).
- `DELETE /plan` (Forget): also deletes link codes, acks, price watches, cached prices and logins.
- `/unlink` in Discord now forgets the user too (the same deletes as Forget), and a user not synced for 30 days is forgotten by the Worker. Either way the next `PUT /plan` answers `403` "Unknown secret…": show Settings › Discord as disconnected (Log in with Discord again); never retry in a loop.
- `PUT /plan` bodies are limited to 64,000 **bytes** (UTF-8), not characters; a `content-length` over it is refused (413) before the body is read.
- `PUT /plan` with a key on a Worker without `KEY_ENC`: `500 {"error": "The Worker has no KEY_ENC secret: see SETUP.md"}`. Show it as is (`workerCall` already does).
- A key stored by 1.0 is encrypted in place the first time the Worker reads it: nothing to resend.

## 6. Tests to add on the userscript side

- `POST /link` only on a click, never from a hidden tab; the code shown, never stored.
- `ackIds` sent back after a sync that returned acks; a skip ack re-times the plan; a done ack never marks a step done.
- `targets`, `war` and `watch` sent at most every 5 minutes and only when changed; never the FFScouter key or the TornStats key in any Worker body; the main Torn key only in the `PUT /plan` right after a Discord login (and when it changes), never on the manual form (extend `test/worker-client.test.js`).
- Log in with Discord: `/login/start` only on a click; `/login/status` polled every 3 s while waiting, visible or not, stopping at `expiresAt` or any state but `open`; `elsewhere` shown with its text; Cancel calls `/login/cancel`.

## 7. Why a ping did not arrive, and the ping ticks (after 1.5.3)

A friend "did not receive an alert from the discord bot": Discord refused the bot's DM (his DMs were off), Settings said Working and the test ping said "Your Worker answered 502.". Everything below is optional both ways: a Worker of 1.5.3 or older stores `plan` as it is, ignores the new fields and answers none of them (the userscript then knows it is an older one by the missing `kinds`); an older userscript ignores the new answer fields.

`PUT /plan`, new request fields:

```json
{
  "plan": {"type": "steady", "steps": [...], "chain": {"since": 1790678882, "keep": ["energy"]}},
  "rules": {"drug": true, "drugready": true, "booster": true, "energy": true, "nerve": true, "refill": true, "jump": true, "landed": true, "price": true, "watch": true, "war": true, "chain": false, "stale": true},
  "rulesAt": {"booster": 1790678881}
}
```

- `rules`: the ping ticks of Settings › Discord pings, every kind on or off. Unknown kinds and values that are not `true`/`false` are dropped. A war of your faction is already in them (`war` and `chain` on); stacking and an overdose are not (the Worker silences those kinds itself from `plan.chain` / `plan.overdose`).
- `rulesAt`: unix seconds each tick was set by hand (or taken over from `/settings`). A `/settings kind:` change made at or before that time is dropped: the latest change wins.
- `plan.chain.keep` / `plan.overdose.keep`: kinds among `energy`, `refill`, `jump` that were ticked back on by hand while stacking or overdosed: those go out.

`PUT /plan`, new answer fields:

```json
{
  "tornRead": {"ok": false, "at": 1790675000, "travel": true, "since": 1790678000, "code": 17, "error": "Torn’s API is down (Torn error 17)."},
  "delivery": {"ok": false, "via": null, "reason": "dm_refused", "dmRefusedAt": 1790678300, "webhook": false},
  "kinds": {"drug": true, "nerve": true, "chain": false},
  "kindsSet": {"energy": {"on": false, "at": 1790678400}}
}
```

- `tornRead`: the Worker's own read of Torn. `ok` true, false, or null (not read yet); `at` the last good read (unix s, or null); `travel` false when the key can't read travel (no Landed ping); while failing, `since`, Torn's `code` (0 when it was not a Torn error) and `error` in words.
- `delivery`: where pings go now. `via` is `dm`, `channel` or null; `reason` is null, `dm_refused` (Discord refused the bot's DM and there is no webhook) or `no_route` (no linked account and no webhook); `dmRefusedAt` unix s of the last refused DM or null (it can be set while `via` is `channel`: pings then go to the channel); `webhook` whether one is saved.
- `kinds`: every kind as the Worker has it on or off (defaults, then `rules`, then `/settings`).
- `kindsSet`: the `/settings kind:` changes still in force, each with its time (0 for one made on a Worker of 1.5.3 or older). The userscript takes each over as a hand-set tick of that time unless its own tick is later, and the next sync's `rulesAt` then drops it here.

`POST /test` answers:

| Status | Body | When |
|---|---|---|
| 200 | `{"ok": true, "via": "dm"}` or `"via": "hook"`, with `"dmRefused": true` when the DM was refused and it went to the channel | it went out |
| 409 | `{"ok": false, "reason": "dm_refused", "error": "…"}` | Discord refused the DM and no webhook is saved |
| 400 | `{"ok": false, "reason": "no_route", "error": "…"}` | no linked account and no webhook |
| 502 | `{"ok": false, "reason": "discord_error", "error": "…", "discordStatus": 500, "discordCode": null}` | Discord answered another error |

`error` is in words an older userscript can show as it is. A Worker of 1.5.3 or older answers a bare `502 {"ok": false}`: the userscript then says the usual cause (DMs off) and that a new login ends the 6-hour rest.

New kind: `nerve` (Nerve full; on by default; `worker/BOT.md`). After a deploy, register the slash commands again (`npm run register:guild` or `register:global`) so `/settings` and `/snooze` list it. No new D1 column and no new secret.
