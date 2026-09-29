# Torn Pumping Iron

Read `HANDOFF.md` first, every session. It holds the owner's rules, the settled decisions, the milestone table and the session log. Then `docs/ROUND3-PLAN.md` (the current round: status, open decisions, build order R0–R7); `docs/BUILD-PLAN.md` is the M0–M8 history.

- Never commit to, push to, or release on GitHub (`abrahamdelosreyes17-oss/torn-pumping-iron`) until the owner says so. Local git checkpoints are fine.
- The owner reviews at the first release only: work through the milestones, keep HANDOFF.md current, and stop at the end of M8 to ask.
- Sibling app with the patterns to copy (don't import across repos): `D:\torn\trading`.
- On torn.com: read only. Test with fixtures and the harness, never the live site.
- Every page follows `mockups/K-home.html` (tokens and rules in `docs/DESIGN.md`).
- `npm run check` must pass before a milestone is marked done.
