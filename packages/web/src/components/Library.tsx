/**
 * The library. Rows are grouped by state, not by date — the five groups are
 * the five glyphs, so the shape of the work is legible at a glance.
 */

import { useState } from 'react';
import type { Claim, ClaimState } from '../api.js';
import { api } from '../api.js';
import { useStore } from '../store.js';
import { Mark } from './Mark.js';

const ORDER: ClaimState[] = ['open', 'in_progress', 'proved', 'stale', 'refuted'];
const LABEL: Record<ClaimState, string> = {
  open: 'Open',
  in_progress: 'In progress',
  proved: 'Proved',
  stale: 'Stale',
  refuted: 'Refuted',
};

function badge(claim: Claim): string {
  const { view } = claim;
  if (view.state === 'in_progress') return `${view.percent}%`;
  if (view.state === 'refuted' && claim.refutation) {
    const [name, value] = Object.entries(claim.refutation.witness.assignment)[0] ?? [];
    return name ? `${name}=${value}` : '✗';
  }
  if (view.state === 'proved') return view.method === 'exhaustion' ? 'exh' : '✓';
  if (view.state === 'stale') return 'stale';
  return '';
}

export function Library(): JSX.Element {
  const { workspace, selectedId, select, run } = useStore();
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');

  const claims = workspace?.claims ?? [];
  const groups = ORDER.map((state) => ({
    state,
    items: claims.filter((claim) => claim.view.state === state),
  })).filter((group) => group.items.length > 0);

  const create = async (): Promise<void> => {
    const trimmed = title.trim();
    if (trimmed.length === 0) return;
    const claim = await run('Stating the claim', () => api.createClaim({ title: trimmed }));
    if (claim) {
      select(claim.id);
      setTitle('');
      setCreating(false);
    }
  };

  return (
    <div className="col">
      <p className="lbl">Library</p>

      {groups.length === 0 && (
        <p className="empty" style={{ padding: '8px 0' }}>
          No claims yet. State one, in prose or in Lean — it doesn’t have to be right.
        </p>
      )}

      {groups.map((group) => (
        <div className="grp" key={group.state}>
          <div className="grp__h">
            {LABEL[group.state]} · {group.items.length}
          </div>
          {group.items.map((claim) => (
            <button
              type="button"
              key={claim.id}
              className={`itm ${claim.id === selectedId ? 'itm--on' : ''}`}
              onClick={() => select(claim.id)}
              title={claim.view.summary}
            >
              <Mark state={claim.view.mark} fill={claim.view.fill} size={12} />
              <span className="itm__n">{claim.title}</span>
              <span className="itm__x">{badge(claim)}</span>
            </button>
          ))}
        </div>
      ))}

      {creating ? (
        <div style={{ marginTop: 10 }}>
          <input
            className="field"
            autoFocus
            placeholder="Name the claim"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void create();
              if (event.key === 'Escape') setCreating(false);
            }}
          />
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button className="btn" type="button" onClick={() => void create()}>
              State it
            </button>
            <button className="btn btn--ghost" type="button" onClick={() => setCreating(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          className="btn btn--ghost btn--wide"
          type="button"
          style={{ marginTop: 8 }}
          onClick={() => setCreating(true)}
        >
          + State a claim
        </button>
      )}
    </div>
  );
}
