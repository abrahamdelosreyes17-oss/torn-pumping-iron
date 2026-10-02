# Torn Pumping Iron

Read `HANDOFF.md` first, every session. It holds the owner's rules, the settled decisions, the milestone table and the session log. Then `docs/ROUND7-PLAN.md` (the current round: start at its §8 "For the coding session"; what was asked, the confirmed causes, the owner's answered decisions, build order R7.0–R7.11) with its evidence in `docs/review-2026-10-02.md`; `docs/ROUND3-PLAN.md` to `ROUND6-PLAN.md` are the earlier rounds and `docs/BUILD-PLAN.md` is the M0–M8 history.

- Never commit to, push to, or release on GitHub (`abrahamdelosreyes17-oss/torn-pumping-iron`) until the owner says so. Local git checkpoints are fine.
- The owner reviews at the first release only: work through the milestones, keep HANDOFF.md current, and stop at the end of M8 to ask.
- Sibling app with the patterns to copy (don't import across repos): `D:\torn\trading`.
- On torn.com: read only. Test with fixtures and the harness, never the live site.
- Every page follows `mockups/K-home.html` (tokens and rules in `docs/DESIGN.md`).
- `npm run check` must pass before a milestone is marked done.
- Round 7: find the cause before fixing (a script or test that shows the bug), change one engine rule per commit with the baseline table before and after, and change the simulator (`src/core/strategies.js`) and the day plan (`src/core/plan.js`) together.
- New looks are mocked up and picked by the owner before their UI is coded.
- Round 7: the owner said "don't code" and "don't commit till I say so": ask the questions in the plan's §8 and wait for his go; ask whether local checkpoints are still fine before committing anything.
- The owner and the friend use Chrome. His real page is read-only for us: never click Create plan or Recalibrate there; time those on the harness.
