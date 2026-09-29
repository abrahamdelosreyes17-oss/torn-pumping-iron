# The userscript's side of the bot (proposal for the main session)

The Worker side is built and tested (`worker/`). This is what `src/api/worker.js`, `src/discord.js` and Settings › Discord need so the bot works end to end. Nothing here breaks 1.0.1: old clients keep working, new response fields are ignored, and every new request field is optional.

All calls stay as today: `https://<name>.workers.dev` only, `Authorization: Bearer <secret>`, JSON, through `gmFetch`. The userscript never calls Discord.

## 1. Link Discord (B3)

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
  "playerId": 3000001
}
```

- `ackIds`: the acks (below) the userscript has applied; the Worker deletes them. At most 50 per sync.
- `targets`: Torn Eye's current list (at most 50, in the order Torn Eye shows it) and a band for every player it has an estimate for (at most 500; war enemies first). `band` is one of `stomp`, `good`, `tough`, `cant`, `none`; `win` and `keep` are percents 0–100 (optional). Send it when the list or the bands change, at most once every 5 minutes; `targets: null` clears. Leaving the field out keeps what the Worker has. Used by `/targets`, `/target`, `/war` and war pings. No fight simulation runs on the Worker.
- `factionId`, `playerId`: from data the userscript already has (the player's own profile). `/war` and war pings need `factionId`; `null` clears.
- The whole body must stay under 100 kB (413 otherwise).

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

The Worker key now needs: user → `basic`, `bars`, `cooldowns`, `refills`, `travel`; faction → `members`, `chain`, `wars`; market → `itemmarket`. Update:

- `connectDiscord`'s message "Make a separate custom key for the Worker (bars, cooldowns, refills, travel)".
- The ToS table in Settings › Discord, to match `worker/SETUP.md` part 3:

| Data storage | Data sharing | Purpose of use | Key storage & sharing | Key access level |
|---|---|---|---|---|
| On your own Cloudflare Worker (D1), the key encrypted (AES-GCM), until you press Forget | Nobody: pings and replies only you can see (DMs, replies only you see, or your own webhook channel) | Personal gain (gym pings and timers); Competitive advantage (`/war`, `/chain`, war pings) | Stored / Used only for automation and the commands you type | Custom (user: basic, bars, cooldowns, refills, travel · faction: members, chain, wars · market: itemmarket) |

- Third parties line: `/buy` and price watches read TornW3B (weav3r.dev) bazaar prices; no key is sent there.

## 5. Unchanged routes, new behaviour

- `POST /test`: when linked, the test ping is a DM with Done / Snooze / Skip / Open in Torn (otherwise the webhook, as before).
- `DELETE /plan` (Forget): also deletes link codes, acks, price watches and cached prices.
- `PUT /plan` with a key on a Worker without `KEY_ENC`: `500 {"error": "The Worker has no KEY_ENC secret: see SETUP.md"}`. Show it as is (`workerCall` already does).
- A key stored by 1.0 is encrypted in place the first time the Worker reads it: nothing to resend.

## 6. Tests to add on the userscript side

- `POST /link` only on a click, never from a hidden tab; the code shown, never stored.
- `ackIds` sent back after a sync that returned acks; a skip ack re-times the plan; a done ack never marks a step done.
- `targets` sent at most every 5 minutes and only when changed; never the main Torn key, the FFScouter key or the TornStats key in any Worker body (extend `test/worker-client.test.js`).
