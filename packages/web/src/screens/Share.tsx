/**
 * Compact — phone, or a share card.
 *
 * Same glyph, same numbers, nothing invented. If it does not fit, it is the
 * prose that gets cut, never the sorry count.
 */

import { Mark } from '../components/Mark.js';
import { Wordmark } from '../components/Mark.js';
import { navigate, useStore } from '../store.js';

export function ShareScreen({ claimId }: { claimId: string | null }): JSX.Element {
  const { workspace } = useStore();
  const claim = workspace?.claims.find((c) => c.id === claimId) ?? workspace?.claims[0] ?? null;

  if (!claim) {
    return (
      <div className="page">
        <div className="page__in">
          <p className="empty">Nothing to show.</p>
        </div>
      </div>
    );
  }

  const blocked = claim.steps.find((step) => step.status === 'gap' || step.status === 'blocked');

  return (
    <div className="page">
      <div className="page__in" style={{ maxWidth: 720 }}>
        <p className="eyebrow">Figure 5.5 · compact</p>

        <div
          data-testid="share-card"
          style={{ maxWidth: 360, border: '1px solid var(--ink)', background: '#fff' }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 9,
              padding: '9px 12px',
              borderBottom: '1px solid var(--ink)',
              background: 'var(--surface-2)',
            }}
          >
            <Mark state={claim.view.mark} fill={claim.view.fill} size={14} />
            <span style={{ fontWeight: 600, fontSize: 11.5 }}>{claim.title}</span>
          </div>

          <div style={{ padding: 14 }}>
            <p className="stmt" style={{ fontSize: 14, margin: 0 }}>
              {claim.statement.prose || claim.declaration}
            </p>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '16px 0 4px' }}>
              <Mark state={claim.view.mark} fill={claim.view.fill} size={36} />
              <div>
                <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.02em' }}>
                  {claim.view.state === 'proved'
                    ? claim.view.method === 'exhaustion'
                      ? 'Proved by exhaustion'
                      : 'Proved'
                    : claim.view.state === 'refuted'
                      ? 'Refuted'
                      : claim.view.state === 'in_progress'
                        ? `${claim.view.percent}% verified`
                        : claim.view.stateLabel}
                </div>
                <div className="meta">
                  {claim.view.sorryCount} sorry · {claim.view.gapCount} gap
                  {claim.view.gapCount === 1 ? '' : 's'}
                  {claim.receipt ? ` · ${claim.receipt.axioms.axioms.length} axioms` : ''}
                </div>
              </div>
            </div>

            {claim.view.scope && (
              <p className="meta" style={{ marginTop: 8, lineHeight: 1.55 }}>
                {claim.view.scope}
              </p>
            )}

            {claim.refutation && (
              <p className="meta" style={{ marginTop: 8, color: 'var(--refuted)', lineHeight: 1.55 }}>
                {claim.refutation.witness.evaluation}
              </p>
            )}

            {blocked && (
              <>
                <p className="lbl lbl--mt">Blocked on</p>
                <div className="step" style={{ borderTop: 0, paddingTop: 0 }}>
                  <span className="step__n">{claim.steps.indexOf(blocked) + 1}</span>
                  <Mark state="partial" fill={0.5} size={12} />
                  <span className="step__t">{blocked.text}</span>
                </div>
              </>
            )}

            <button
              className="btn btn--wide"
              type="button"
              style={{ marginTop: 14 }}
              onClick={() => navigate('/')}
            >
              Open workspace
            </button>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                marginTop: 14,
                paddingTop: 10,
                borderTop: '1px solid var(--rule-2)',
              }}
            >
              <Mark state="proved" size={12} />
              <Wordmark size={11} />
              <span className="meta" style={{ marginLeft: 'auto' }}>
                ⊢ □
              </span>
            </div>
          </div>
        </div>

        <p className="note" style={{ marginTop: 18 }}>
          The card is the same object as the sidebar row and the favicon, at a different size. It
          never rounds a percentage up and never drops the hole count to make room.
        </p>
      </div>
    </div>
  );
}
