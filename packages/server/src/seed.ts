/**
 * The first-run library.
 *
 * Every claim here is real mathematics, and every state it ends up in is
 * produced by actually running the engine — nothing is dressed up. Seeding runs
 * the searches for real, which is why a fresh workspace shows two refutations,
 * one bounded proof by exhaustion, and one search that found nothing and left
 * its claim open. That last one is the honest outcome the product exists to
 * report properly.
 */

import { EXAMPLES } from '@conjecture/refute';
import type { ConjectureService } from './service.js';
import type { SearchRunner } from './search-runner.js';

/**
 * A claim carrying a real hole. The gaps are read out of the source text, so
 * the sorry count is genuine even with no Lean toolchain present.
 */
const TAIL_BOUND = {
  title: 'Tail bound for f',
  prose: 'For every natural number n, f(n) is at most 2n.',
  lean: [
    'theorem tail_bound (n : ℕ) : f n ≤ 2 * n := by',
    '  induction n with',
    '  | zero => simp [f]',
    '  | succ k ih =>',
    '    rcases parity k with h | h',
    '    · exact even_step k h ih',
    '    · sorry',
  ].join('\n'),
  steps: [
    { text: 'Reduce to the even case by parity.' },
    { text: 'Apply the induction hypothesis to k.', dependsOn: [0] },
    { text: 'Bound the odd tail below 2k + 2.', dependsOn: [1] },
    { text: 'Conclude for n = k + 1.', dependsOn: [2] },
  ],
};

export interface SeedOptions {
  /** Run the searches for real. Off in tests that only need the claims. */
  readonly runSearches: boolean;
}

export async function seedWorkspace(
  service: ConjectureService,
  runner: SearchRunner,
  options: SeedOptions = { runSearches: true },
): Promise<void> {
  if (service.claims.length > 0) return;

  for (const example of EXAMPLES) {
    await service.createClaim({
      title: example.title,
      prose: example.prose,
      lean: example.lean,
    });
  }

  const tail = await service.createClaim({
    title: TAIL_BOUND.title,
    prose: TAIL_BOUND.prose,
    lean: TAIL_BOUND.lean,
  });
  await service.setSteps(tail.id, TAIL_BOUND.steps);

  if (!options.runSearches) return;

  // Run each example's search and fold the real outcome into the claim.
  for (const example of EXAMPLES) {
    const claim = service.claims.find((c) => c.title === example.title);
    if (!claim) continue;
    const record = runner.start(example.request, claim.id);
    await waitFor(runner, record.id);
    const finished = runner.get(record.id);
    if (finished?.outcome) {
      await service.applySearchOutcome(claim.id, finished.outcome, example.request, record.id);
    }
  }
}

function waitFor(runner: SearchRunner, id: ReturnType<SearchRunner['start']>['id']): Promise<void> {
  return new Promise((resolve) => {
    const unsubscribe = runner.subscribe(id, (event) => {
      if (event === 'done') {
        unsubscribe();
        resolve();
      }
    });
  });
}
