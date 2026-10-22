# Priority rules

`src/priority.ts` provides a provider-independent scoring core. Call `scorePriority(input, config)` with an account-scoped message and injected rules/watch list; it has no environment, persistence, or provider dependencies.

Rules optionally scope by account IDs, conversation types, group IDs, sender IDs, keywords (case-insensitive substring), and `atMe`. Weighted rules add their configured weight; watched people add their boost. Scores are clamped to 0–100 and map to P0 (80+), P1 (60+), P2 (35+), P3 (15+), and P4 (below 15). `atAll` suppresses `atMe` matching. A message `override` wins first; matching `kind: 'hard'` rules win before all weighted rules and watch boosts. Hard rules require an explicit priority.
