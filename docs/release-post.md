# Conjecture 1.0.0 — release post

Longform post for X. Image markers show where each mini screenshot goes.

---

Conjecture 1.0.0 is out. It is a proof workspace with one rule underneath it: Claude can argue, only Lean can decide.

The problem it exists for is small and infuriating. Ask a model for a proof and you often get something fluent, confident, and wrong. Not visibly wrong. Wrong in a way that survives three readings. Formal verification fixes that, but only if the interface never lets an argument and a proof look the same on screen, and most tools blur exactly there.

So the app hangs off one glyph: a turnstile driving into a tombstone. `⊢ ■`. The square's fill is the status field, not decoration. Logo, sidebar row, favicon, share card, same object at different sizes.

`[image: c-chrome.png]`

Five states. Hollow is stated and unattacked. Partly filled is steps verified, in eighths, because a proof is discrete and the glyph should be too. Filled is a kernel accepting a term. Crossed is a witness. Dashed is proved once, against an environment that has since moved.

`[image: c-library.png]`

The receipts rule is the one I care most about, and it comes from a genuinely nasty failure mode. Lean saying "compiled" is not Lean saying "your theorem is true." A build can succeed while the declaration transitively leans on a hole. So after a successful check the app runs `#print axioms` and reads the answer. If `sorryAx` turns up anywhere in that list, the claim drops back to rung 3 whatever the build reported. That is a test in the repo.

`[image: c-ladder.png]`

Same treatment for `native_decide`. It proves things by putting the Lean compiler in your trusted base, which is a much bigger thing to trust than `propext`, so the app says so every time rather than showing a tick and letting you find out later. Staleness works the same way: a proof is only good against a toolchain and a library revision, both get pinned into the receipt, and bumping Mathlib moves every affected result to a fifth state that is recognisably the same object and visibly not current.

Then there is the other half, which turned out to be the fun half.

Proving and disproving run at once. Whichever lands first ends the session. The counterexample bench takes a declared parameter space and grinds through it in exact integer arithmetic — everything BigInt, no floating point within a mile of a candidate. A counterexample that turns out to be a rounding artefact would be worse than nothing.

`[image: c-search-config.png]`

It has a small definition language so recurrences can be written the way you would write them on paper, with literal patterns and guards. Those get memoised, which is not only a speed trick. Enumerating n upward means `f(n-1)` is already cached when `f(n)` is asked for, so a recurrence over a million candidates stays one frame deep instead of blowing the stack somewhere around 12,000.

Before any witness reaches you, a second evaluator with an empty cache re-derives it from scratch. If they disagree the app reports nothing at all.

`[image: c-trace.png]`

The seeded library is where I stopped feeling clever and started enjoying myself. Every claim in it is real mathematics and the states are computed at first run, not staged. Euler's polynomial n² + n + 41 is prime for n = 0 through 39 and dies at 40, where it is 41². The app finds it in 41 candidates. Mersenne numbers at prime exponents survive p = 2, 3, 5, 7 and fall at 11, where 2047 is 23 × 89.

`[image: c-witness.png]`

Pólya is the one I actually built the seed data around. First counterexample at n = 906,150,257. The bench searches, finds nothing, and changes nothing — the claim sits exactly where it was, and the sentence it prints says so without dressing it up. Being good at "we looked and we have nothing" is most of the job.

Collatz below 100,000 walked me into a corner I liked. Checking every point of a finite declared space in exact arithmetic genuinely proves the bounded claim, so it fills the square, but calling that a kernel check would be the exact sin I was trying to avoid. It gets its own label, `decided by exhaustion`, and it drags its scope along everywhere it appears: `n ∈ [1, 100000] · 100,000 candidates`. Hard to read that line and accidentally lift the result past its bound.

`[image: c-sharecard-exhaustion.png]`

It also never goes stale on a Mathlib bump, since it never rested on Mathlib. Took me a while to talk myself into that one. I think it is right — noise in the stale marker is how a real stale proof gets ignored — but ask me again in a month.

Voice was harder than any of the algorithms. This audience will forgive a tool that fails and will not forgive one that oversells. No confetti when the kernel passes. No "something went wrong" when Lean has already told you it was a type mismatch at line 7 and steps 1 through 6 are fine.

`[image: c-voice.png]`

One decision I went back and forth on for a while. There is no Lean toolchain in the environment I built this in, so I could have faked a few green ticks for the demo and nobody would have known for about four minutes. Instead the empty state is load-bearing. With no project connected the library still opens, you can state claims, you can search them for counterexamples, and every square stays hollow. The screenshots in the repo are of an app that currently cannot prove anything, which I have made peace with.

`[image: c-evidence.png]`

Under the hood: five packages, dependency direction strictly inward, a domain core that imports nothing. 265 tests, run against source rather than build output so a stale `dist` cannot make a broken change look green. TypeScript strict with `noUncheckedIndexedAccess`.

Three bugs I found by looking at the rendered app rather than the test results. A column labelled "least factor" was actually showing `isqrt`, which happens to coincide at n = 40 and nowhere else, so the one screenshot I checked looked perfect. A search finishing before its event stream opened announced itself twice. And the mark closed up into a blob at 12px until I dropped the stroke below 24.

Limits, since I would rather say them than have you find them. The bridge shells out per check instead of holding an LSP session, so you get goal states where Lean reports unsolved goals and nowhere else. Fonts load from Google and fall back to Georgia on a sealed network, which I did not get to. And a claim proved relative to an unproved lemma is not covered by any of the five glyphs — the honest fix is probably a hollow square with a filled stem, but that is next week's problem.

`⊢ □`

MIT. Repo in the reply.
