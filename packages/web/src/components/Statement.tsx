/**
 * The middle column: the claim itself, in both views, and the proof steps.
 *
 * Prose and Lean are two views of one statement. Editing either flags the other
 * as out of date, and the flag is never hidden — silent divergence is how you
 * end up proving the wrong theorem and feeling good about it.
 */

import { useEffect, useState } from 'react';
import { api, type Claim } from '../api.js';
import { useStore } from '../store.js';
import { LeanCode } from './LeanCode.js';
import { Mark } from './Mark.js';

type Tab = 'lean' | 'prose' | 'assumptions';

const SYNC_TONE: Record<Claim['statement']['sync'], string> = {
  synced: '',
  'lean-behind': 'banner--warn',
  'prose-behind': 'banner--warn',
  diverged: 'banner--warn',
};

const STEP_MARK = {
  verified: 'proved',
  gap: 'partial',
  blocked: 'open',
  pending: 'open',
} as const;

const STEP_NOTE: Record<Claim['steps'][number]['status'], string> = {
  verified: 'kernel ok',
  gap: 'gap · argued in prose, not formalised',
  blocked: 'blocked by an earlier step',
  pending: 'written down, not yet run',
};

export function Statement({ claim }: { claim: Claim }): JSX.Element {
  const { run, workspace, notify } = useStore();
  const [tab, setTab] = useState<Tab>('lean');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ prose: claim.statement.prose, lean: claim.statement.lean });

  useEffect(() => {
    setDraft({ prose: claim.statement.prose, lean: claim.statement.lean });
    setEditing(false);
  }, [claim.id, claim.updatedAt, claim.statement.prose, claim.statement.lean]);

  const save = async (): Promise<void> => {
    await run('Saving the statement', () =>
      api.updateClaim(claim.id, { prose: draft.prose, lean: draft.lean }),
    );
    setEditing(false);
  };

  const verify = async (): Promise<void> => {
    const result = await run('Kernel check', () => api.verify(claim.id));
    if (result?.error) notify(result.error, 'bad');
    else if (result) notify(result.claim.view.summary, result.claim.view.state === 'proved' ? 'good' : 'plain');
  };

  return (
    <div className="col">
      <p className="lbl">Statement</p>

      <div className="blk">
        {editing ? (
          <textarea
            className="field field--serif"
            rows={3}
            value={draft.prose}
            placeholder="State the claim in prose. It does not have to be right."
            onChange={(event) => setDraft((d) => ({ ...d, prose: event.target.value }))}
          />
        ) : (
          <p className="stmt" style={{ margin: 0, fontSize: 15 }}>
            {claim.statement.prose || <span style={{ color: 'var(--slate-2)' }}>No prose yet.</span>}
          </p>
        )}
        <div className="meta" style={{ marginTop: 8 }}>
          {claim.declaration} · {claim.view.rungLabel}
        </div>
      </div>

      {claim.statement.sync !== 'synced' && (
        <div className={`banner ${SYNC_TONE[claim.statement.sync]}`} style={{ marginBottom: 12 }}>
          <Mark state="partial" fill={0.5} size={14} />
          <span>
            {claim.statement.syncMessage}{' '}
            <button
              type="button"
              className="chip chip--link"
              onClick={() => void run('Confirming', () => api.updateClaim(claim.id, { confirmSync: true }))}
            >
              they agree
            </button>
          </span>
        </div>
      )}

      <div className="tabs">
        {(['lean', 'prose', 'assumptions'] as Tab[]).map((name) => (
          <button
            key={name}
            type="button"
            className={`tab ${tab === name ? 'tab--on' : ''}`}
            onClick={() => setTab(name)}
          >
            {name}
          </button>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, paddingBottom: 4 }}>
          {editing ? (
            <>
              <button className="btn" type="button" onClick={() => void save()}>
                Save
              </button>
              <button className="btn btn--ghost" type="button" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button className="btn btn--ghost" type="button" onClick={() => setEditing(true)}>
              Edit
            </button>
          )}
        </div>
      </div>

      {tab === 'lean' &&
        (editing ? (
          <textarea
            className="field field--mono"
            rows={10}
            value={draft.lean}
            placeholder="theorem my_claim (n : ℕ) : … := by sorry"
            onChange={(event) => setDraft((d) => ({ ...d, lean: event.target.value }))}
          />
        ) : claim.statement.lean ? (
          <LeanCode source={claim.statement.lean} />
        ) : (
          <p className="empty">
            No Lean yet. Nothing can be kernel-checked until this claim is stated formally.
          </p>
        ))}

      {tab === 'prose' && (
        <p className="stmt blk" style={{ fontSize: 14 }}>
          {claim.statement.prose || 'No prose yet.'}
        </p>
      )}

      {tab === 'assumptions' && (
        <div className="blk">
          {claim.statement.assumptions.length === 0 ? (
            <span className="meta">No assumptions recorded.</span>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 18, fontFamily: 'var(--mono)', fontSize: 11 }}>
              {claim.statement.assumptions.map((assumption) => (
                <li key={assumption}>{assumption}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {claim.view.gapCount > 0 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', margin: '-2px 0 10px' }}>
          <span className="chip chip--bad">
            {claim.view.sorryCount} sorry
          </span>
          <span className="meta">
            {claim.gaps.map((gap) => `${gap.line}:${gap.column}`).join(' · ')}
          </span>
        </div>
      )}

      <p className="lbl lbl--mt">
        Proof · {claim.steps.length} {claim.steps.length === 1 ? 'step' : 'steps'}
      </p>

      {claim.steps.length === 0 ? (
        <p className="empty" style={{ padding: '8px 0' }}>
          No steps recorded. A proof sketch goes here; each step carries its own glyph and its own
          receipt.
        </p>
      ) : (
        claim.steps.map((step, index) => (
          <div
            key={step.id}
            className={`step ${step.status === 'gap' ? 'step--gap' : ''} ${
              step.status === 'blocked' ? 'step--blocked' : ''
            }`}
          >
            <span className="step__n">{index + 1}</span>
            <Mark state={STEP_MARK[step.status]} fill={step.status === 'gap' ? 0.5 : 0} size={12} />
            <span>
              <span className="step__t">{step.text}</span>
              <span className="step__m">
                {STEP_NOTE[step.status]}
                {step.citations.length > 0 && ` · cites ${step.citations.map((c) => c.name).join(', ')}`}
                {step.elapsedMs !== null && ` · ${(step.elapsedMs / 1000).toFixed(1)}s`}
              </span>
            </span>
          </div>
        ))
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 18, flexWrap: 'wrap' }}>
        <button
          className="btn"
          type="button"
          disabled={!workspace?.canVerify}
          onClick={() => void verify()}
          title={workspace?.blockedReason ?? undefined}
        >
          Run kernel check
        </button>
        {!workspace?.canVerify && (
          <span className="meta" style={{ alignSelf: 'center', maxWidth: '46ch' }}>
            {workspace?.blockedReason}
          </span>
        )}
      </div>
    </div>
  );
}
