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
   429 {"ok": false, "error": "Too many logins at once. Try again in a few minutes."}
   ```

   A new start replaces the browser's previous one. Open `url` in a new tab (`GM_openInTab`); the user allows Pumping Iron on Discord (scope `identify` only) and lands on a plain page on the Worker ("Connected as …", "Not in the server", …) they can close.
2. While that tab is open, every 3 seconds (visible tab, stop at `expiresAt`, 15 minutes):

   `POST /login/status` (same bearer secret) `{"id": "<48 hex>"}`

   ```json
   200 {"ok": true, "state": "open", "name": null}
   200 {"ok": true, "state": "done", "name": "Iron Tester"}
   404 {"ok": false, "error": "That login is gone. Start again."}   another secret, or an unknown id
   ```

   `state`: `open` (waiting), `done` (connected: show "Connected as @name"), `not_member` ("Join the Pumping Iron Discord server first, then log in again"), `denied` (cancelled on Discord), `full` (the service serves its maximum), `failed` (Discord or the bot had a problem: try again), `expired` (over 15 minutes).
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
- Once linked, the next `PUT /plan` answers `linked: true`: show "Linked" and "To stop DMs, type /unlink in Discord". The Discord id field becomes optional (the Worker ignores a typed id once linked; the linked id comes from Discord's signed interaction).
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
- The whole body must stay under 64 kB (413 otherwise).

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
- `DELETE /plan` (Forget): also deletes link codes, acks, price watches and cached prices.
- `PUT /plan` with a key on a Worker without `KEY_ENC`: `500 {"error": "The Worker has no KEY_ENC secret: see SETUP.md"}`. Show it as is (`workerCall` already does).
- A key stored by 1.0 is encrypted in place the first time the Worker reads it: nothing to resend.

## 6. Tests to add on the userscript side

- `POST /link` only on a click, never from a hidden tab; the code shown, never stored.
- `ackIds` sent back after a sync that returned acks; a skip ack re-times the plan; a done ack never marks a step done.
- `targets`, `war` and `watch` sent at most every 5 minutes and only when changed; never the FFScouter key or the TornStats key in any Worker body; the main Torn key only in the `PUT /plan` right after a Discord login (and when it changes), never on the manual form (extend `test/worker-client.test.js`).
- Log in with Discord: `/login/start` only on a click; `/login/status` polled only while the login tab is open and the page is visible, stopping at `expiresAt` or any state but `open`.
