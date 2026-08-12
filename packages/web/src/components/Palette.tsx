/**
 * The command palette. Claims first, then the screens, then the actions that
 * are actually available right now — a disabled row in a palette is a small lie.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { navigate, useStore } from '../store.js';
import { Mark, type MarkState } from './Mark.js';

interface Row {
  id: string;
  label: string;
  hint: string;
  mark: MarkState;
  fill: number;
  act: () => void;
}

export function Palette({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element | null {
  const { workspace, select, run, selected, notify } = useStore();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setCursor(0);
      inputRef.current?.focus();
    }
  }, [open]);

  const rows = useMemo<Row[]>(() => {
    const claims: Row[] = (workspace?.claims ?? []).map((claim) => ({
      id: `claim:${claim.id}`,
      label: claim.title,
      hint: claim.view.summary,
      mark: claim.view.mark,
      fill: claim.view.fill,
      act: () => {
        select(claim.id);
        navigate('/');
      },
    }));

    const screens: Row[] = [
      { id: 'nav:workspace', label: 'Go to workspace', hint: '#/', act: () => navigate('/') },
      { id: 'nav:graph', label: 'Go to dependency view', hint: '#/graph', act: () => navigate('/graph') },
      { id: 'nav:bench', label: 'Go to counterexample bench', hint: '#/bench', act: () => navigate('/bench') },
      { id: 'nav:trust', label: 'Go to the trust ladder', hint: '#/trust', act: () => navigate('/trust') },
      { id: 'nav:connect', label: 'Connect a Lean project', hint: '#/connect', act: () => navigate('/connect') },
    ].map((row) => ({ ...row, mark: 'open' as MarkState, fill: 0 }));

    const actions: Row[] = [];
    if (selected && workspace?.canVerify) {
      actions.push({
        id: 'act:verify',
        label: `Run kernel check on “${selected.title}”`,
        hint: 'lean',
        mark: 'partial',
        fill: 0.5,
        act: () => {
          void run('Kernel check', () => api.verify(selected.id));
        },
      });
    }
    if (selected?.refutation) {
      actions.push({
        id: 'act:weaken',
        label: `Weaken “${selected.title}” to the boundary`,
        hint: 'refuted',
        mark: 'refuted',
        fill: 0,
        act: () => {
          void run('Weakening the claim', async () => {
            const weakened = await api.weaken(selected.id);
            notify(`Weakened to “${weakened.title}”.`);
            return weakened;
          });
        },
      });
    }
    if (selected) {
      actions.push({
        id: 'act:share',
        label: `Share card for “${selected.title}”`,
        hint: 'compact',
        mark: selected.view.mark,
        fill: selected.view.fill,
        act: () => navigate(`/share/${selected.id}`),
      });
    }

    const all = [...claims, ...actions, ...screens];
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return all.slice(0, 12);
    return all.filter((row) => row.label.toLowerCase().includes(needle)).slice(0, 12);
  }, [workspace, query, select, selected, run, notify]);

  if (!open) return null;

  const choose = (row: Row | undefined): void => {
    if (!row) return;
    row.act();
    onClose();
  };

  return (
    <div
      className="scrim"
      onClick={onClose}
      role="presentation"
    >
      <div className="palette" onClick={(event) => event.stopPropagation()} role="dialog" aria-label="Command palette">
        <input
          ref={inputRef}
          className="palette__input"
          placeholder="Search claims, screens and actions…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setCursor(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onClose();
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setCursor((c) => Math.min(c + 1, rows.length - 1));
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              setCursor((c) => Math.max(c - 1, 0));
            }
            if (event.key === 'Enter') choose(rows[cursor]);
          }}
        />
        <div className="palette__list">
          {rows.length === 0 && <p className="empty" style={{ padding: 14 }}>Nothing matches.</p>}
          {rows.map((row, index) => (
            <button
              type="button"
              key={row.id}
              className={`palette__row ${index === cursor ? 'palette__row--on' : ''}`}
              onMouseEnter={() => setCursor(index)}
              onClick={() => choose(row)}
            >
              <Mark state={row.mark} fill={row.fill} size={13} />
              <span>{row.label}</span>
              <span className="palette__hint">{row.hint}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
