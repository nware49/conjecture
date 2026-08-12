/**
 * The right column: what is actually known, and what is being attempted.
 *
 * Prove and Refute run as two tabs over one claim because both attacks are
 * live at once and whichever lands first ends the session.
 */

import { useEffect, useMemo, useState } from 'react';
import { api, watchSearch, type Claim, type SearchRecord } from '../api.js';
import { navigate, useStore } from '../store.js';
import { GoalBlock } from './LeanCode.js';
import { Mark } from './Mark.js';

export function Evidence({ claim }: { claim: Claim }): JSX.Element {
  const [tab, setTab] = useState<'prove' | 'refute'>(claim.view.state === 'refuted' ? 'refute' : 'prove');

  return (
    <div className="col">
      <p className="lbl">
        Goal state{claim.gaps[0] ? ` · line ${claim.gaps[0].line}, col ${claim.gaps[0].column}` : ''}
      </p>

      {claim.gaps[0]?.goal ? (
        <GoalBlock raw={claim.gaps[0].goal} />
      ) : (
        <p className="info" style={{ color: 'var(--slate-2)' }}>
          No goal state. Lean has not been asked about this claim yet.
        </p>
      )}
      <p className="meta" style={{ marginTop: 6 }}>
        From the Lean server. Not summarised.
      </p>

      <div className="tabs" style={{ marginTop: 18 }}>
        <button
          type="button"
          className={`tab ${tab === 'prove' ? 'tab--on' : ''}`}
          onClick={() => setTab('prove')}
        >
          Prove
        </button>
        <button
          type="button"
          className={`tab ${tab === 'refute' ? 'tab--on' : ''}`}
          onClick={() => setTab('refute')}
        >
          Refute
        </button>
      </div>

      {tab === 'prove' ? <ProvePanel claim={claim} /> : <RefutePanel claim={claim} />}

      <Receipts claim={claim} />
    </div>
  );
}

function ProvePanel({ claim }: { claim: Claim }): JSX.Element {
  const { workspace } = useStore();

  return (
    <div>
      <p className="lbl">Trust ladder</p>
      <div className="banner" style={{ marginBottom: 12 }}>
        <Mark state={claim.view.mark} fill={claim.view.fill} size={16} />
        <span>
          <b style={{ color: 'var(--ink)' }}>
            Rung {claim.view.rung} — {claim.view.rungLabel}
          </b>
          <br />
          {claim.view.rungDescription}
        </span>
      </div>

      {workspace?.engine.status !== 'ready' && (
        <p className="empty" style={{ padding: '4px 0 12px' }}>
          Lemma suggestions are name-and-type searches against the pinned Mathlib revision, so with
          no Lean server attached there is nothing to search and nothing is offered. A list of
          plausible-looking names would be worse than an empty one.
        </p>
      )}

      {claim.view.gapCount > 0 && (
        <>
          <p className="lbl lbl--mt">Gaps · {claim.view.gapCount}</p>
          {claim.gaps.map((gap) => (
            <div className="sug" key={gap.id}>
              <div className="sug__t">{gap.label}</div>
              <div className="sug__m">
                line {gap.line}, col {gap.column} · argued, not formalised
              </div>
            </div>
          ))}
        </>
      )}

      <button
        className="btn btn--ghost btn--wide"
        type="button"
        style={{ marginTop: 12 }}
        onClick={() => navigate('/trust')}
      >
        What each rung means
      </button>
    </div>
  );
}

function RefutePanel({ claim }: { claim: Claim }): JSX.Element {
  const { run, notify } = useStore();
  const [record, setRecord] = useState<SearchRecord | null>(null);
  const [running, setRunning] = useState(false);

  const existing = useMemo(() => record, [record]);

  useEffect(() => {
    let cancelled = false;
    void api.searches().then((all) => {
      if (cancelled) return;
      const mine = all.find((search) => search.claimId === claim.id);
      if (mine) setRecord(mine);
    });
    return () => {
      cancelled = true;
    };
  }, [claim.id]);

  const start = async (): Promise<void> => {
    const started = await run('Starting the search', () =>
      api.startSearch(claim.id, {
        definitions: '',
        predicate: 'n >= 0',
        variables: [{ name: 'n', from: '0', to: '1000000' }],
        budgetMs: 15_000,
        maxCandidates: 1_000_000,
      }),
    );
    if (!started) return;
    setRecord(started);
    setRunning(true);
    watchSearch(started.id, {
      onProgress: (progress) => setRecord((current) => (current ? { ...current, progress } : current)),
      onDone: (finished) => {
        setRecord(finished);
        setRunning(false);
        notify(finished.sentence, finished.outcome?.kind === 'witness' ? 'bad' : 'plain');
      },
    });
  };

  if (claim.refutation) {
    return (
      <div>
        <p className="lbl">Smallest witness</p>
        <div className="card card--bad" style={{ padding: 12 }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 15, color: 'var(--refuted)', fontWeight: 700 }}>
            {Object.entries(claim.refutation.witness.assignment)
              .map(([name, value]) => `${name} = ${value}`)
              .join(', ')}
          </div>
          <div className="meta" style={{ marginTop: 6, color: 'var(--ink-2)' }}>
            {claim.refutation.witness.evaluation}
          </div>
          <p style={{ fontSize: 11.5, color: 'var(--slate)', margin: '8px 0 0' }}>
            {claim.refutation.authority === 'kernel-confirmed'
              ? 'Search found it; Lean confirmed it.'
              : 'Found by exact search and re-derived by a second evaluator. Not yet confirmed by Lean.'}
          </p>
          <div className="meta" style={{ marginTop: 6 }}>
            {claim.refutation.candidatesChecked.toLocaleString()} candidates ·{' '}
            {(claim.refutation.elapsedMs / 1000).toFixed(1)}s
          </div>
        </div>

        <button
          className="btn btn--wide"
          type="button"
          style={{ marginTop: 12 }}
          onClick={() =>
            void run('Weakening the claim', async () => {
              const weakened = await api.weaken(claim.id);
              notify(`Weakened to “${weakened.title}”. The refuted claim is kept, marked superseded.`);
              return weakened;
            })
          }
        >
          Weaken the claim to the boundary
        </button>
        <button
          className="btn btn--ghost btn--wide"
          type="button"
          style={{ marginTop: 8 }}
          onClick={() => navigate('/bench')}
        >
          Open the bench
        </button>
      </div>
    );
  }

  return (
    <div>
      {existing ? (
        <>
          <p className="lbl">Last search</p>
          <div className="sug" style={{ cursor: 'default' }}>
            <div className="sug__t">{existing.predicate}</div>
            <div className="sug__m">
              {existing.progress.candidatesChecked.toLocaleString()} candidates ·{' '}
              {(existing.progress.elapsedMs / 1000).toFixed(1)}s
            </div>
            <div className={`meter ${existing.outcome?.kind === 'witness' ? 'meter--bad' : ''}`}>
              <i style={{ width: `${Math.round((existing.progress.fraction ?? 0) * 100)}%` }} />
            </div>
          </div>
          <p style={{ fontSize: 11.5, color: 'var(--slate)', lineHeight: 1.5 }}>{existing.sentence}</p>
        </>
      ) : (
        <p className="empty" style={{ padding: '4px 0' }}>
          No search run yet. The bench takes a declared parameter space and reports the smallest
          witness it finds, in exact integer arithmetic.
        </p>
      )}

      <button
        className="btn btn--wide"
        type="button"
        style={{ marginTop: 10 }}
        disabled={running}
        onClick={() => void start()}
      >
        {running ? 'Searching…' : 'Configure a search'}
      </button>
      <button
        className="btn btn--ghost btn--wide"
        type="button"
        style={{ marginTop: 8 }}
        onClick={() => navigate('/bench')}
      >
        Open the bench
      </button>
    </div>
  );
}

function Receipts({ claim }: { claim: Claim }): JSX.Element | null {
  if (!claim.receipt) {
    return (
      <>
        <p className="lbl lbl--mt">Receipt</p>
        <p className="empty" style={{ padding: 0 }}>
          None. A proof without its receipt is treated as unverified.
        </p>
      </>
    );
  }

  const axioms = claim.receipt.axioms.axioms;

  return (
    <>
      <p className="lbl lbl--mt">
        {claim.receipt.method === 'exhaustion' ? 'Decided by exhaustion' : 'Axioms used'}
      </p>

      {claim.receipt.method === 'exhaustion' ? (
        <>
          <pre className="info" style={{ whiteSpace: 'pre-wrap' }}>
            {claim.receipt.scope}
          </pre>
          <p className="meta" style={{ marginTop: 6, lineHeight: 1.6 }}>
            Every point checked in exact integer arithmetic. This proves the bounded claim and says
            nothing about anything outside the bound.
          </p>
        </>
      ) : (
        <>
          <pre className="info">
            {axioms.length === 0 ? 'depends on no axioms' : axioms.map((a) => a.name).join('\n')}
          </pre>
          <p className="meta" style={{ marginTop: 6 }}>
            from #print axioms ·{' '}
            {claim.receipt.axioms.standardOnly ? 'standard only' : 'see the note above'}
          </p>
        </>
      )}

      {claim.view.trustsCompiler && (
        <div className="banner banner--warn" style={{ marginTop: 10 }}>
          Proved, using <code>native_decide</code>. This adds <code>Lean.ofReduceBool</code>, so the
          result depends on the Lean compiler being correct.
        </div>
      )}

      {claim.view.staleness.length > 0 && (
        <div className="banner banner--warn" style={{ marginTop: 10 }}>
          <Mark state="stale" size={14} />
          <span>
            Stale. {claim.view.staleness.map((reason) => `${reason.name}: ${reason.was} → ${reason.now}`).join('; ')}
          </span>
        </div>
      )}
    </>
  );
}
