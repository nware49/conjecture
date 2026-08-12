/**
 * A statement has two views — the prose a human wrote and the Lean the kernel
 * will read. They are two views of one claim, so editing either flags the other
 * as out of date. They are never allowed to diverge silently: that is the
 * failure mode where you prove the wrong theorem and feel good about it.
 */

export interface Statement {
  readonly prose: string;
  readonly lean: string;
  readonly assumptions: readonly string[];
  /** Monotone revision counters. Deterministic, unlike wall-clock timestamps. */
  readonly proseRev: number;
  readonly leanRev: number;
  /** The revisions in force the last time a human confirmed the two agree. */
  readonly syncedProseRev: number;
  readonly syncedLeanRev: number;
}

export type SyncState =
  /** Both views reflect the last confirmed agreement. */
  | 'synced'
  /** Prose moved; the Lean no longer reflects it. */
  | 'lean-behind'
  /** Lean moved; the prose no longer reflects it. */
  | 'prose-behind'
  /** Both moved independently. Needs a human. */
  | 'diverged';

export function emptyStatement(): Statement {
  return {
    prose: '',
    lean: '',
    assumptions: [],
    proseRev: 0,
    leanRev: 0,
    syncedProseRev: 0,
    syncedLeanRev: 0,
  };
}

export function syncState(s: Statement): SyncState {
  const proseMoved = s.proseRev > s.syncedProseRev;
  const leanMoved = s.leanRev > s.syncedLeanRev;
  if (proseMoved && leanMoved) return 'diverged';
  if (proseMoved) return 'lean-behind';
  if (leanMoved) return 'prose-behind';
  return 'synced';
}

export const SYNC_MESSAGE: Readonly<Record<SyncState, string>> = {
  synced: 'Prose and Lean agree.',
  'lean-behind': 'The prose changed. The Lean below still states the old claim.',
  'prose-behind': 'The Lean changed. The prose above still describes the old claim.',
  diverged: 'Prose and Lean were both edited separately. One of them is not the claim.',
};

export function editProse(s: Statement, prose: string): Statement {
  if (prose === s.prose) return s;
  return { ...s, prose, proseRev: s.proseRev + 1 };
}

export function editLean(s: Statement, lean: string): Statement {
  if (lean === s.lean) return s;
  return { ...s, lean, leanRev: s.leanRev + 1 };
}

export function setAssumptions(s: Statement, assumptions: readonly string[]): Statement {
  return { ...s, assumptions: [...assumptions] };
}

/** Record that a human has confirmed the two views say the same thing. */
export function confirmSync(s: Statement): Statement {
  return { ...s, syncedProseRev: s.proseRev, syncedLeanRev: s.leanRev };
}

/**
 * Does this statement have enough in it to hand to Lean? An empty Lean body is
 * not an error — you are allowed to state a claim in prose and leave it — but
 * nothing can be elaborated until there is something to elaborate.
 */
export function isElaborable(s: Statement): boolean {
  return s.lean.trim().length > 0;
}
