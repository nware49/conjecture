# Conjecture

A proof workspace where Claude proposes and Lean decides.

Everything upstream of the kernel is a suggestion, including everything a model
says. This product is the seam between a fluent argument and a checked one, and
its entire job is to keep that seam visible.

```
⊢ □   open          stated, not attacked
⊢ ▤   in progress   fill = steps verified, in eighths
⊢ ■   proved        the kernel accepted the term
⊢ ⊠   refuted       a witness is attached
⊢ ⊡   stale         proved, but not against the current environment
```

## What it does

- **State a claim** in prose, in Lean, or both. The two are views of one
  statement, and editing either flags the other as out of date rather than
  letting them diverge silently.
- **Attack it from both ends at once.** A proof attempt runs against Lean while
  a counterexample search runs over a declared parameter space. Whichever lands
  first ends the session.
- **Never mistake argued for verified.** A claim's state is derived from
  evidence — receipts, holes, witnesses, and the environment currently pinned —
  by one function, in one place. Nothing else can set it.

## Quick start

```bash
npm install
npm run verify          # typecheck, test, build
npm start               # http://127.0.0.1:4319
```

`npm start` serves the client that `npm run build` produced, so the build has to
succeed first. If it has not, the browser shows a notice saying exactly that
rather than the app.

If `npm install` leaves you with type errors inside `node_modules/@types/node`
(`TS1010: '*/' expected` is the usual shape), the install is corrupt rather than
the code being wrong. Delete `node_modules` and reinstall:

```bash
rm -rf node_modules packages/*/node_modules
npm ci
```

Avoid `npm audit fix --force`. It upgrades across major versions without asking
and has produced exactly that broken tree here before. The committed lockfile
audits clean.

The first run seeds a library by actually running the searches, so what you see
is computed rather than staged: Euler's polynomial falls at n = 40, the Mersenne
claim at p = 11, Collatz below 100,000 is decided by exhaustion, and Pólya's
search finds nothing and leaves its claim exactly where it was.

To connect Lean without installing it, point the app at a Lean server running
somewhere else:

```bash
npm start -- --lean-endpoint https://lean.example.org

# check what an endpoint can actually do before trusting it
node packages/server/dist/cli.js probe https://lean.example.org

# or run your own endpoint and the app together
docker compose -f deploy/lean-endpoint/compose.yaml up --build
```

Or connect a Lean project on this machine:

```bash
npm start -- --project /path/to/your/lean/project
```

A remote endpoint reports its Lean version but nothing about the library it was
built against, so a Mathlib bump on the server cannot be detected from here. The
app says so on the connect screen and in the workspace. See
[docs/remote-lean.md](docs/remote-lean.md).

With no Lean toolchain on `PATH`, the library still opens. You can state claims
and search them for counterexamples; you just cannot prove any, and every square
stays hollow.

## The trust ladder

Six rungs, and the interface must never let one be mistaken for the one above.

| # | Evidence | Shown as |
|---|---|---|
| 1 | Prose only | `open` |
| 2 | The statement elaborates | `open · typed` |
| 3 | A skeleton compiles with `sorry` | `n sorry` |
| 4 | Zero `sorry`, kernel accepts the term | `proved` |
| 5 | Axioms confined to `propext`, `Classical.choice`, `Quot.sound` | `3 axioms` |
| 6 | `Lean.ofReduceBool` appears | `trusts compiler` |

Rung 6 is not higher than rung 5. It is rung 4 or 5 carrying a caveat, so the
rung number is for display and never for sorting.

Two rules are worth stating out loud because they are enforced by tests:

- A `#print axioms` report that reaches `sorryAx` demotes a claim to rung 3
  whatever the build reported. A build can succeed while the declaration
  transitively depends on a hole.
- A proof without its receipt is unverified, and a receipt that no longer
  matches the pinned environment is *stale*, not proved.

## A second authority, kept separate

Checking every point of a finite declared space in exact integer arithmetic
really does prove the bounded claim, so it fills the square too. It is not a
kernel check and is never dressed as one:

- it is labelled **decided by exhaustion**,
- it carries its scope in every summary it appears in
  (`n ∈ [1, 100000] · 100,000 candidates`),
- it stays off the Lean ladder entirely,
- and it never goes stale on a Mathlib bump, because it never rested on Mathlib.

Noise in the stale marker is how a genuinely stale proof gets ignored.

## Layout

```
packages/
  core     domain model — claims, the trust ladder, receipts, dependency
           graphs. Pure: no I/O, no framework, no clock it does not own.
  lean     the Lean bridge — toolchain detection, elaboration over
           `lake env lean --json` locally or LSP-over-WebSocket to a server
           elsewhere, diagnostics and #print axioms parsing.
  refute   counterexample search — a small definition language over BigInt,
           with memoised recurrences and no eval() anywhere.
  server   HTTP API, workspace store, live search progress over SSE.
  web      the client — five screens, one mark component.
```

The dependency direction is strictly inward: `web → server → {lean, refute} →
core`, and `core` depends on nothing.

## Scripts

| Command | What it does |
|---|---|
| `npm run verify` | typecheck, test and build everything |
| `npm test` | run the suite against source, not `dist` |
| `npm run dev` | API on :4319 and the client on :5319 with hot reload |
| `npm start` | serve the built client from the API |
| `node tools/shoot.mjs` | drive the running app and capture screenshots |

## Notes for the next pass

- The bridge shells out to `lake env lean --json` per check. An LSP session
  would give goal states at every hole rather than only where Lean reports
  `unsolved goals`; the port is already shaped for it.
- Web fonts load from Google Fonts. In a sealed network they fall back to
  Georgia, system-ui and the platform monospace, which is legible but not the
  intended setting. Self-hosting the three families is the fix.
- A claim can be proved *relative to* an unproved lemma, which the five glyphs
  do not cover. The honest shape is probably a hollow square with a filled stem
  rather than a sixth glyph.

## Licence

MIT.
