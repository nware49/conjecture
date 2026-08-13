# Connecting Lean without installing it

Conjecture can talk to a Lean server running somewhere other than your machine.
Nothing is installed locally, there is no project on disk, and the workspace
behaves the same as it does with a local toolchain — except in one respect,
covered under [what a remote pin cannot see](#what-a-remote-pin-cannot-see).

## Pointing at an endpoint

```bash
npm start -- --lean-endpoint https://lean.example.org
```

or, if the app is already running, use **Project → Lean server elsewhere** and
paste the URL.

Two URL forms are accepted:

| You give | It connects to |
|---|---|
| `https://host` | `wss://host/websocket/mathlib` |
| `http://host:8080` | `ws://host:8080/websocket/mathlib` |
| `wss://host/websocket/anything` | used exactly as given |

`--lean-project <name>` changes the project segment when the endpoint serves
more than one.

## Checking an endpoint before trusting it

```bash
node packages/server/dist/cli.js probe https://lean.example.org
```

This runs a real theorem through the endpoint and reports what came back:

```
endpoint  wss://lean.example.org/websocket/mathlib

  ok   connect         Lean 4 4.9.0 at wss://lean.example.org/websocket/mathlib
  ok   toolchain       leanprover/lean4:v4.9.0
  ok   library rev     not reported by this endpoint (expected; see the note below)
  ok   elaborate       clean in 812 ms
  ok   #print axioms   propext, Classical.choice, Quot.sound
  ok   goal at a hole  n + 0 = n

This endpoint can verify claims.
```

The exit status is 0 when the endpoint can support receipts and 1 when it
cannot. `#print axioms` failing is the one to watch: without it the app can see
that a file elaborated but not what it rests on, and a proof without its receipt
is treated as unverified.

## Running your own endpoint

The public Lean playgrounds are shared community resources meant for people
typing into a browser, not for an application's checking traffic. Run your own.

```bash
docker compose -f deploy/lean-endpoint/compose.yaml up --build
```

That builds two images — a Lean 4 + Mathlib server, and the app — and wires them
together. The app comes up on `http://localhost:4319` already pointed at the
Lean container.

The first build pulls a prebuilt Mathlib cache and takes a while. Two things
matter for it to work at all:

- **Memory.** Elaborating against Mathlib wants about 4 GB. Below that the
  server is killed mid-check, which surfaces as an unexplained timeout rather
  than an out-of-memory error.
- **`lake exe cache get`.** Without the cache step, Mathlib compiles from
  source, which is hours rather than minutes.

To run only the Lean side and keep the app local:

```bash
docker build -t conjecture-lean deploy/lean-endpoint
docker run --rm -p 8080:8080 --memory 6g conjecture-lean
npm start -- --lean-endpoint http://localhost:8080
```

Anyone who can reach the endpoint can run arbitrary elaboration on it. The image
keeps lean4web's bubblewrap sandboxing on; leave it on, and put authentication
in front of anything exposed beyond your own network.

## What a remote pin cannot see

A local project pins two things: the toolchain from `lean-toolchain`, and every
dependency revision from `lake-manifest.json`. Bump either and existing results
go stale.

A remote endpoint reports its Lean version over the protocol and nothing about
the library it was built against. So a remote pin records:

```
toolchain    leanprover/lean4:v4.9.0
library rev  unknown
endpoint     wss://lean.example.org/websocket/mathlib
```

The endpoint is part of the pin, so a receipt from one server never reads as
current under another running the same Lean. But **a Mathlib bump on the server
cannot be detected from here**, and results proved against the old library keep
showing as proved.

The app states this on the connect screen and again in the workspace whenever a
remote endpoint is attached. It is a real hole in the staleness guarantee and
worth knowing about before relying on it. If that matters for your work, pin the
endpoint's Mathlib revision in the image (`MATHLIB_REV` in the Dockerfile, set to
a commit rather than `master`) and rebuild deliberately.

## What improves over the local adapter

The local engine shells out to `lake env lean --json` per check, so goal states
appear only where Lean reports `unsolved goals`. The remote engine speaks LSP,
so it asks `$/lean/plainGoal` at every hole and fills the goal panel at each one.

A server without Lean's LSP extensions still works for checking; the app falls
back to reading goals out of `unsolved goals` messages.

## Status of this adapter

The protocol client and the engine are covered by 27 tests against a scripted
Lean server, including the handshake, completion detection, goal requests,
axiom parsing, timeouts and dropped connections.

They have **not** been run against a live Lean server, because the environment
this was written in has no network route to one. That is what `probe` is for:
run it against your endpoint and read the six lines it prints before trusting
any receipt that comes out of it.
