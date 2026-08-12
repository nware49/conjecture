/**
 * The trust ladder, written out.
 *
 * Six rungs, and the interface must never let one be mistaken for the one
 * above it. This screen exists so the rule is stated somewhere a user can read
 * it, rather than only being enforced somewhere they cannot.
 */

import { Mark, type MarkState } from '../components/Mark.js';
import { useStore } from '../store.js';

interface Rung {
  n: number;
  title: string;
  body: string;
  mark: MarkState;
  fill: number;
  right: string;
  tone?: 'top' | 'warn';
}

const RUNGS: Rung[] = [
  {
    n: 1,
    title: 'Claude finds the claim plausible.',
    body: 'Prose only. Carries no weight, and is never rendered in the statement’s serif italic.',
    mark: 'open',
    fill: 0,
    right: 'open',
  },
  {
    n: 2,
    title: 'The statement elaborates.',
    body: 'A well-formed proposition in Lean. Says nothing about truth, but rules out the most common failure: proving the wrong theorem.',
    mark: 'open',
    fill: 0,
    right: 'open · typed',
  },
  {
    n: 3,
    title: 'A proof skeleton compiles with sorry.',
    body: 'The shape is right and the gaps are named. This is where most sessions live.',
    mark: 'partial',
    fill: 0.5,
    right: 'n sorry',
  },
  {
    n: 4,
    title: 'Zero sorry, kernel accepts the term.',
    body: 'Proved. The square fills, and this is the only event that fills it.',
    mark: 'proved',
    fill: 1,
    right: 'proved',
    tone: 'top',
  },
  {
    n: 5,
    title: 'Axioms confined to propext, Classical.choice, Quot.sound.',
    body: 'Standard foundations, no extra trust. Shown as three quiet lines, not a badge.',
    mark: 'proved',
    fill: 1,
    right: '3 axioms',
    tone: 'top',
  },
  {
    n: 6,
    title: 'Lean.ofReduceBool appears.',
    body: 'Something used native_decide, so the compiler is now part of the trusted base. Still proved — but the interface says so, every time, unprompted.',
    mark: 'proved',
    fill: 1,
    right: 'trusts compiler',
    tone: 'warn',
  },
];

const FAILURES: { condition: string; response: string; effect: string }[] = [
  { condition: "declaration uses 'sorry'", response: 'The gap list keeps the entry', effect: 'in progress' },
  { condition: 'unknown identifier', response: 'Suggestion withdrawn from the Prove panel', effect: 'unchanged' },
  { condition: 'deterministic timeout', response: 'Budget shown, with a raise-and-retry control', effect: 'unchanged' },
  { condition: 'type mismatch', response: 'Expected vs got, inline at the failing step', effect: 'unchanged' },
  { condition: 'unsolved goals', response: 'The remaining goal shown verbatim', effect: 'in progress' },
  { condition: 'Mathlib revision changed', response: 'All proofs marked stale, none silently dropped', effect: 'stale' },
];

const VOICE: { when: string; say: string; not: string }[] = [
  {
    when: 'Empty library',
    say: 'No claims yet. State one, in prose or in Lean — it doesn’t have to be right.',
    not: 'Welcome to your mathematical journey!',
  },
  {
    when: 'Deterministic timeout',
    say: 'omega hit the 200,000 heartbeat budget on gap 3. Raise the budget, or split the goal into cases.',
    not: 'This is taking longer than expected…',
  },
  {
    when: 'Proof completed',
    say: 'Proved. 0 sorry, 12 steps, kernel-checked in 1.8s. Axioms: propext, Classical.choice, Quot.sound.',
    not: '🎉 Congratulations — you did it!',
  },
  {
    when: 'Search exhausted, nothing found',
    say: 'No counterexample under 10⁶ and no proof within budget. The claim stays open.',
    not: 'Unable to determine result at this time.',
  },
];

export function TrustScreen(): JSX.Element {
  const { selected } = useStore();

  return (
    <div className="page">
      <div className="page__in">
        <p className="eyebrow">The rule this product exists to enforce</p>
        <h1 style={{ fontSize: 28, letterSpacing: '-0.02em', margin: '0 0 8px' }}>
          Claude proposes, Lean decides
        </h1>
        <p className="note">
          Everything upstream of the kernel is a suggestion, including everything the model says.
          The two are rendered in different type, in different panels, and only one of them can turn
          a square yellow.
        </p>

        <h2 style={{ fontSize: 15, margin: '30px 0 12px', fontWeight: 600 }}>The trust ladder</h2>
        <div className="ladder">
          {RUNGS.map((rung) => (
            <div
              key={rung.n}
              className={`ladder__r ${rung.tone === 'top' ? 'ladder__r--on' : ''}`}
              style={rung.tone === 'warn' ? { background: 'var(--refuted-wash)' } : undefined}
            >
              <div className="ladder__n">{rung.n}</div>
              <div className="ladder__t">
                <b>{rung.title}</b> {rung.body}
              </div>
              <div className="ladder__m" style={rung.tone === 'warn' ? { color: 'var(--refuted)' } : undefined}>
                <Mark state={rung.mark} fill={rung.fill} size={13} />
                {rung.right}
                {selected?.view.rung === rung.n && (
                  <span className="chip chip--ok" style={{ marginLeft: 4 }}>
                    here
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        <h2 style={{ fontSize: 15, margin: '30px 0 12px', fontWeight: 600 }}>
          A second authority, kept separate
        </h2>
        <div className="card">
          <p className="note" style={{ marginBottom: 8 }}>
            Checking every point of a finite declared space in exact integer arithmetic really does
            prove the bounded claim, so it fills the square too. It is not the same thing as a kernel
            check and is never dressed as one: an exhaustion result is labelled{' '}
            <b style={{ color: 'var(--ink)' }}>decided by exhaustion</b>, carries its scope in every
            summary, and stays off the ladder above.
          </p>
          <p className="note" style={{ margin: 0 }}>
            It also never goes stale on a Mathlib bump, because it never rested on Mathlib. Marking
            it stale would be noise, and noise in the stale marker is how a genuinely stale proof
            gets ignored.
          </p>
        </div>

        <h2 style={{ fontSize: 15, margin: '30px 0 12px', fontWeight: 600 }}>
          Failures the interface names precisely
        </h2>
        <table className="tbl">
          <thead>
            <tr>
              <th>Lean condition</th>
              <th>What the user sees</th>
              <th>State</th>
            </tr>
          </thead>
          <tbody>
            {FAILURES.map((row) => (
              <tr key={row.condition}>
                <td>{row.condition}</td>
                <td style={{ whiteSpace: 'normal' }}>{row.response}</td>
                <td>{row.effect}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2 style={{ fontSize: 15, margin: '30px 0 12px', fontWeight: 600 }}>Voice</h2>
        <p className="note">
          This audience will forgive a tool that fails and never forgive one that overstates. Lean’s
          messages are terse and exact; the interface around them matches, or the mismatch reads as
          marketing.
        </p>
        <div className="grid2">
          {VOICE.map((entry) => (
            <div className="card" key={entry.when}>
              <p className="eyebrow">{entry.when}</p>
              <p style={{ fontSize: 13, fontWeight: 600, margin: '0 0 8px' }}>{entry.say}</p>
              <p
                style={{
                  fontSize: 13,
                  color: 'var(--slate-2)',
                  textDecoration: 'line-through',
                  margin: 0,
                }}
              >
                {entry.not}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
