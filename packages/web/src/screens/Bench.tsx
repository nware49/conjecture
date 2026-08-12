/**
 * The counterexample bench.
 *
 * A refutation is a result, not an error, so it gets the same treatment as a
 * proof: its own card, its own receipt, and its own honest note about how much
 * authority stands behind it.
 */

import { useEffect, useMemo, useState } from 'react';
import { api, watchSearch, type Example, type SearchRecord } from '../api.js';
import { Mark } from '../components/Mark.js';
import { LeanCode } from '../components/LeanCode.js';
import { useStore } from '../store.js';

interface Draft {
  definitions: string;
  predicate: string;
  name: string;
  from: string;
  to: string;
  budgetMs: number;
  strategy: 'enumerate' | 'random';
  report: { label: string; expr: string }[];
}

const BLANK: Draft = {
  definitions: '',
  predicate: '',
  name: 'n',
  from: '0',
  to: '1000000',
  budgetMs: 15_000,
  strategy: 'enumerate',
  report: [],
};

export function BenchScreen(): JSX.Element {
  const { workspace, selected, run, notify, refresh } = useStore();
  const [examples, setExamples] = useState<Example[]>([]);
  const [draft, setDraft] = useState<Draft>(BLANK);
  const [record, setRecord] = useState<SearchRecord | null>(null);
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<SearchRecord[]>([]);

  useEffect(() => {
    void api.examples().then(setExamples);
    void api.searches().then(setHistory);
  }, []);

  useEffect(() => {
    if (!selected) return;
    const example = examples.find((e) => e.title === selected.title);
    if (!example) return;
    const variable = example.request.variables[0];
    setDraft({
      definitions: example.request.definitions,
      predicate: example.request.predicate,
      name: variable?.name ?? 'n',
      from: variable?.from ?? '0',
      to: variable?.to ?? '1000000',
      budgetMs: example.request.budgetMs,
      strategy: 'enumerate',
      report: example.request.report,
    });
  }, [selected, examples]);

  const start = async (): Promise<void> => {
    if (!selected) {
      notify('Select a claim first — a search belongs to a claim.', 'bad');
      return;
    }
    const started = await run('Starting the search', () =>
      api.startSearch(selected.id, {
        definitions: draft.definitions,
        predicate: draft.predicate,
        variables: [{ name: draft.name, from: draft.from, to: draft.to }],
        budgetMs: draft.budgetMs,
        strategy: draft.strategy,
        maxCandidates: 5_000_000,
        report: draft.report,
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
        void api.searches().then(setHistory);
      },
    });
  };

  const outcome = record?.outcome ?? null;
  const witness = outcome?.kind === 'witness' ? outcome.witness : null;
  const trace = outcome && 'trace' in outcome ? outcome.trace : [];
  const columns = useMemo(() => (trace[0] ? Object.keys(trace[0].values) : []), [trace]);
  const progressPercent = Math.round((record?.progress.fraction ?? 0) * 100);

  return (
    <div className="page">
      <div className="page__in">
        <p className="eyebrow">Figure 5.3 · the disproof path</p>
        <h1 style={{ fontSize: 24, letterSpacing: '-0.02em', margin: '0 0 6px' }}>
          Counterexample bench
        </h1>
        <p className="note">
          Search runs over a declared parameter space in exact integer arithmetic and reports the
          smallest witness it finds. Before anything is shown, the witness is re-derived by a second
          evaluator with an empty cache — a search is allowed to be clever, and what it reports is
          not.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 340px) minmax(0, 1fr)', gap: 18 }}>
          {/* ── configuration ── */}
          <div>
            <p className="lbl">Claim</p>
            <div className="blk" style={{ borderStyle: 'solid' }}>
              {selected ? (
                <>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <Mark state={selected.view.mark} fill={selected.view.fill} size={14} />
                    <b style={{ fontSize: 12.5 }}>{selected.title}</b>
                  </div>
                  <p className="stmt" style={{ fontSize: 12.5, margin: '8px 0 0' }}>
                    {selected.statement.prose}
                  </p>
                </>
              ) : (
                <span className="meta">No claim selected.</span>
              )}
            </div>

            <p className="lbl lbl--mt">Definitions</p>
            <textarea
              className="field field--mono"
              rows={7}
              spellCheck={false}
              value={draft.definitions}
              placeholder={'f(0) = 0\nf(n) = f(n - 1) + 2'}
              onChange={(event) => setDraft((d) => ({ ...d, definitions: event.target.value }))}
            />

            <p className="lbl lbl--mt">The claim under test</p>
            <textarea
              className="field field--mono"
              rows={2}
              spellCheck={false}
              value={draft.predicate}
              placeholder="f(n) <= 2 * n"
              onChange={(event) => setDraft((d) => ({ ...d, predicate: event.target.value }))}
            />
            <p className="meta" style={{ marginTop: 5 }}>
              A candidate making this false is a counterexample.
            </p>

            <p className="lbl lbl--mt">Search space</p>
            <div style={{ display: 'grid', gridTemplateColumns: '58px 1fr 1fr', gap: 6 }}>
              <input
                className="field field--mono"
                value={draft.name}
                aria-label="variable"
                onChange={(event) => setDraft((d) => ({ ...d, name: event.target.value }))}
              />
              <input
                className="field field--mono"
                value={draft.from}
                aria-label="from"
                onChange={(event) => setDraft((d) => ({ ...d, from: event.target.value }))}
              />
              <input
                className="field field--mono"
                value={draft.to}
                aria-label="to"
                onChange={(event) => setDraft((d) => ({ ...d, to: event.target.value }))}
              />
            </div>

            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              {(['enumerate', 'random'] as const).map((strategy) => (
                <button
                  key={strategy}
                  type="button"
                  className={`chip chip--link ${draft.strategy === strategy ? 'chip--ok' : ''}`}
                  onClick={() => setDraft((d) => ({ ...d, strategy }))}
                >
                  {strategy}
                </button>
              ))}
              <span className="chip">budget {draft.budgetMs / 1000}s</span>
            </div>

            <button
              className="btn btn--wide"
              type="button"
              style={{ marginTop: 14 }}
              disabled={running || draft.predicate.trim().length === 0}
              onClick={() => void start()}
            >
              {running ? 'Searching…' : 'Run the search'}
            </button>
            {record && running && (
              <button
                className="btn btn--ghost btn--wide"
                type="button"
                style={{ marginTop: 8 }}
                onClick={() => void api.cancelSearch(record.id)}
              >
                Stop
              </button>
            )}

            <p className="lbl lbl--mt">Progress</p>
            <div className={`meter meter--tall ${witness ? 'meter--bad' : ''}`}>
              <i style={{ width: `${running ? Math.max(4, progressPercent) : record ? 100 : 0}%` }} />
            </div>
            <p className="meta" style={{ marginTop: 6 }}>
              {record
                ? `${record.progress.candidatesChecked.toLocaleString()} candidates · ${(record.progress.elapsedMs / 1000).toFixed(1)}s · space ${Number(record.spaceSize).toLocaleString()}`
                : 'not started'}
            </p>
          </div>

          {/* ── results ── */}
          <div>
            {!record && (
              <div className="card">
                <p className="eyebrow">Worked examples</p>
                <p className="note" style={{ marginBottom: 12 }}>
                  Pick a claim in the library and its search is loaded here. Each of these is real
                  mathematics with a real answer, including the one where the answer is “we found
                  nothing, and that settles nothing”.
                </p>
                {examples.map((example) => (
                  <div key={example.id} style={{ marginBottom: 12 }}>
                    <b style={{ fontSize: 12.5 }}>{example.title}</b>
                    <p className="note" style={{ fontSize: 12, margin: '4px 0 0' }}>
                      {example.note}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {record && (
              <>
                <p className="lbl">Outcome</p>
                <div
                  className={`card ${witness ? 'card--bad' : outcome?.kind === 'exhausted' ? 'card--warn' : ''}`}
                >
                  {witness ? (
                    <>
                      <div className="eyebrow" style={{ color: 'var(--refuted)' }}>
                        Smallest witness
                      </div>
                      <div
                        style={{
                          fontFamily: 'var(--mono)',
                          fontSize: 19,
                          color: 'var(--refuted)',
                          fontWeight: 700,
                        }}
                      >
                        {Object.entries(witness.assignment)
                          .map(([name, value]) => `${name} = ${value}`)
                          .join(', ')}
                      </div>
                      <div className="meta" style={{ marginTop: 6, color: 'var(--ink-2)', fontSize: 11.5 }}>
                        {witness.evaluation}
                      </div>
                    </>
                  ) : (
                    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                      <Mark
                        state={outcome?.kind === 'exhausted' ? 'proved' : 'open'}
                        fill={outcome?.kind === 'exhausted' ? 1 : 0}
                        size={18}
                      />
                      <div>
                        <div className="eyebrow" style={{ marginBottom: 4 }}>
                          {outcome?.kind === 'exhausted'
                            ? 'Space exhausted'
                            : outcome?.kind === 'error'
                              ? 'Could not run'
                              : 'Stopped early'}
                        </div>
                      </div>
                    </div>
                  )}
                  <p style={{ fontSize: 12.5, color: 'var(--slate)', margin: '10px 0 0', lineHeight: 1.5 }}>
                    {record.sentence}
                  </p>
                  {outcome && 'usedProbabilisticPrimality' in outcome && outcome.usedProbabilisticPrimality && (
                    <p className="meta" style={{ marginTop: 8, color: 'var(--refuted)' }}>
                      A primality test ran above the deterministic bound, so that part is a
                      probable-prime verdict rather than a decision.
                    </p>
                  )}
                </div>

                {witness && selected && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                    <button
                      className="btn"
                      type="button"
                      onClick={() =>
                        void run('Recording the refutation', async () => {
                          const claim = await api.applySearch(record.id);
                          notify(`${claim.title} is refuted. ${claim.view.summary}`, 'bad');
                          return claim;
                        })
                      }
                    >
                      Record this against the claim
                    </button>
                    <button
                      className="btn btn--ghost"
                      type="button"
                      onClick={() =>
                        void run('Weakening the claim', async () => {
                          const weakened = await api.weaken(selected.id);
                          await refresh();
                          notify(`Weakened to “${weakened.title}”.`);
                          return weakened;
                        })
                      }
                    >
                      Weaken to the boundary
                    </button>
                  </div>
                )}

                {outcome?.kind === 'exhausted' && selected && (
                  <button
                    className="btn"
                    type="button"
                    style={{ marginTop: 12 }}
                    onClick={() =>
                      void run('Recording the bounded proof', async () => {
                        const claim = await api.applySearch(record.id);
                        notify(claim.view.summary, 'good');
                        return claim;
                      })
                    }
                  >
                    Record as proved by exhaustion
                  </button>
                )}

                {trace.length > 0 && (
                  <>
                    <p className="lbl lbl--mt">Candidates checked · last {trace.length}</p>
                    <div style={{ overflowX: 'auto' }}>
                      <table className="tbl">
                        <thead>
                          <tr>
                            {Object.keys(trace[0]!.assignment).map((name) => (
                              <th key={name}>{name}</th>
                            ))}
                            {columns.map((column) => (
                              <th key={column}>{column}</th>
                            ))}
                            <th>holds</th>
                          </tr>
                        </thead>
                        <tbody>
                          {trace.map((row, index) => (
                            <tr key={index} className={row.holds ? undefined : 'hit'}>
                              {Object.values(row.assignment).map((value, i) => (
                                <td key={i}>{value}</td>
                              ))}
                              {columns.map((column) => (
                                <td key={column}>{truncate(row.values[column] ?? '—')}</td>
                              ))}
                              <td>{row.holds ? 'yes' : 'NO'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}

                {record.definitions.trim().length > 0 && (
                  <>
                    <p className="lbl lbl--mt">Definitions used</p>
                    <LeanCode source={record.definitions} />
                  </>
                )}
              </>
            )}

            {history.length > 0 && (
              <>
                <p className="lbl lbl--mt">Earlier searches</p>
                {history.slice(0, 6).map((entry) => (
                  <button
                    type="button"
                    key={entry.id}
                    className="sug"
                    onClick={() => setRecord(entry)}
                  >
                    <div className="sug__t">{entry.predicate}</div>
                    <div className="sug__m">
                      {entry.outcome?.kind ?? entry.status} ·{' '}
                      {entry.progress.candidatesChecked.toLocaleString()} candidates ·{' '}
                      {(entry.progress.elapsedMs / 1000).toFixed(1)}s
                    </div>
                  </button>
                ))}
              </>
            )}
          </div>
        </div>

        {workspace?.engine.status !== 'ready' && (
          <div className="banner" style={{ marginTop: 22 }}>
            <Mark state="open" size={14} />
            <span>
              The bench does not need Lean. It decides arithmetic claims by evaluation, so it works
              with no toolchain attached — and a witness it finds is labelled “not yet confirmed by
              Lean” until a kernel says otherwise.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function truncate(value: string): string {
  return value.length > 22 ? `${value.slice(0, 20)}…` : value;
}
