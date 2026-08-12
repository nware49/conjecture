# Changelog

## 1.0.0

First release.

### The workspace

- Five screens: workspace, dependency view, counterexample bench, project
  connection, and a compact share card.
- Claims carry two views of one statement. Editing the prose or the Lean flags
  the other as out of date instead of letting them diverge quietly.
- A command palette over claims, screens and the actions currently available.
  Actions that cannot run are absent rather than disabled.

### The trust ladder

- Six rungs, computed from evidence, never asserted. One function decides a
  claim's state and nothing else may set it.
- A `#print axioms` report reaching `sorryAx` demotes a claim to rung 3 whatever
  the build reported.
- A proof without its receipt is unverified. A receipt that no longer matches
  the pinned toolchain and library revision is stale, not proved, and the
  interface says exactly what moved underneath it.
- `native_decide` is reported every time it appears, unprompted, because it puts
  the Lean compiler in the trusted base.

### The Lean bridge

- Elaboration over `lake env lean --json` behind a `CommandRunner` port.
- Diagnostics are shown at the position Lean reported, in Lean's words.
  Goal states are split into hypotheses and goal and otherwise left alone.
- Toolchain and dependency revisions are read from the repository, never chosen
  by the app. A project that cannot be pinned is not pinned.
- Existing `sorry`s in a connected repository are surfaced on import, so the
  workspace never inherits someone else's debt silently.
- With no toolchain present the engine refuses every request with a reason, and
  every square stays hollow.

### Counterexample search

- A small definition language — literal patterns, `when` guards, `let`,
  memoised recurrences — evaluated entirely in BigInt. No floating point and no
  `eval()`.
- Deterministic Miller-Rabin below 3.3 × 10²⁴; above it the answer is reported
  as a probable-prime verdict rather than a decision.
- A witness is re-derived by a second evaluator with an empty cache before it is
  reported, so a memoisation bug cannot manufacture a counterexample.
- "Checked the whole space", "ran out of time" and "ran out of candidates" are
  three separate outcomes.
- Exhausting a finite declared space is recorded as a proof of the bounded
  claim, labelled *decided by exhaustion*, carrying its scope everywhere it is
  shown, and kept off the Lean ladder.

### Seeded library

Four claims from real mathematics, whose states are computed at first run rather
than staged:

- Euler's polynomial `n² + n + 41` — refuted at n = 40.
- Mersenne numbers at prime exponents — refuted at p = 11.
- Collatz below 100,000 — decided by exhaustion.
- The Pólya conjecture — searched, nothing found, claim unchanged. Its
  counterexample is at 906,150,257.

### Engineering

- Five packages with a strictly inward dependency direction; `core` is pure and
  depends on nothing.
- 265 tests run against source rather than build output.
- TypeScript in strict mode with `noUncheckedIndexedAccess`.
- CI typechecks, tests, builds and smoke-tests the server.

### Known limits

- The bridge shells out per check. An LSP session would give goal states at
  every hole rather than only where Lean reports `unsolved goals`.
- Web fonts load from Google Fonts and fall back to Georgia, system-ui and the
  platform monospace on a sealed network.
- A claim proved *relative to* an unproved lemma is not covered by the five
  glyphs.
