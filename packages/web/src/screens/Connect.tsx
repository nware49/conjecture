/**
 * Connecting a Lean project — the first run.
 *
 * Deliberately the least decorated screen in the product: a path, a pin, a
 * build log and a single blocking control. Nothing is provable until this is
 * green, and it is more honest about that than it is pretty.
 */

import { useState } from 'react';
import { api } from '../api.js';
import { Mark } from '../components/Mark.js';
import { navigate, useStore } from '../store.js';

interface Step {
  label: string;
  state: 'ok' | 'partial' | 'failed' | 'skipped';
  detail: string;
}

const MARK_FOR: Record<Step['state'], 'proved' | 'partial' | 'refuted' | 'open'> = {
  ok: 'proved',
  partial: 'partial',
  failed: 'refuted',
  skipped: 'open',
};

type Mode = 'remote' | 'local';

export function ConnectScreen(): JSX.Element {
  const { workspace, run, notify } = useStore();
  const [mode, setMode] = useState<Mode>('remote');
  const [root, setRoot] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [steps, setSteps] = useState<Step[] | null>(null);

  const connect = async (): Promise<void> => {
    const result = await run('Connecting Lean', () =>
      mode === 'remote' ? api.connectEndpoint(endpoint.trim()) : api.connect(root.trim()),
    );
    if (!result) return;
    setSteps(result.steps as Step[]);
    const health = result.workspace.engine;
    notify(
      health.status === 'unavailable' ? health.reason : `Connected. ${health.detail}`,
      health.status === 'ready' ? 'good' : 'bad',
    );
  };

  const project = workspace?.project;
  const ready = mode === 'remote' ? endpoint.trim().length > 0 : root.trim().length > 0;

  return (
    <div className="page">
      <div className="page__in">
        <p className="eyebrow">Figure 5.4 · first run</p>
        <h1 style={{ fontSize: 24, letterSpacing: '-0.02em', margin: '0 0 6px' }}>
          Connect a Lean project
        </h1>
        <p className="note">
          The toolchain is read from <code>lean-toolchain</code> and displayed, never picked for you.
          Guessing a version here would corrupt every receipt taken afterwards.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 300px', gap: 20 }}>
          <div>
            <p className="lbl">Source</p>
            <div className="tabs">
              <button
                type="button"
                className={`tab ${mode === 'remote' ? 'tab--on' : ''}`}
                onClick={() => setMode('remote')}
              >
                Lean server elsewhere
              </button>
              <button
                type="button"
                className={`tab ${mode === 'local' ? 'tab--on' : ''}`}
                onClick={() => setMode('local')}
              >
                Project on this machine
              </button>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              {mode === 'remote' ? (
                <input
                  className="field field--mono"
                  placeholder="https://lean.example.org"
                  value={endpoint}
                  onChange={(event) => setEndpoint(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void connect();
                  }}
                />
              ) : (
                <input
                  className="field field--mono"
                  placeholder="/path/to/your/lean/project"
                  value={root}
                  onChange={(event) => setRoot(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void connect();
                  }}
                />
              )}
              <button className="btn" type="button" onClick={() => void connect()} disabled={!ready}>
                Connect
              </button>
            </div>

            <p className="meta" style={{ marginTop: 6, lineHeight: 1.6 }}>
              {mode === 'remote'
                ? 'Nothing is installed here. https://host becomes wss://host/websocket/mathlib; an explicit wss:// URL is used as given.'
                : 'The toolchain is read from lean-toolchain in that directory and displayed, never chosen for you.'}
            </p>

            {mode === 'remote' && (
              <div className="banner banner--warn" style={{ marginTop: 10 }}>
                <Mark state="partial" fill={0.5} size={14} />
                <span>
                  A remote endpoint reports its Lean version and nothing about the library it was
                  built against, so a Mathlib bump on the server cannot be detected from here and
                  results proved against the old library keep showing as proved.
                </span>
              </div>
            )}

            {project && (
              <>
                <p className="lbl lbl--mt">Pinned</p>
                <pre className="info">
                  {`root         ${project.root}
toolchain    ${project.pinLabel}
heartbeats   ${project.limits.maxHeartbeats}
timeout      ${project.limits.elaborationTimeoutMs / 1000}s
existing     ${project.inheritedSorries} sorry already in the repository`}
                </pre>
                <button
                  className="btn btn--ghost"
                  type="button"
                  style={{ marginTop: 10 }}
                  onClick={() => void run('Disconnecting', () => api.disconnect())}
                >
                  Disconnect
                </button>
              </>
            )}

            {steps && (
              <>
                <p className="lbl lbl--mt">What happened</p>
                <div className="ladder">
                  {steps.map((step) => (
                    <div className="ladder__r" key={step.label} style={{ gridTemplateColumns: '18px minmax(0,1fr) 1fr' }}>
                      <Mark state={MARK_FOR[step.state]} fill={step.state === 'partial' ? 0.5 : 0} size={13} />
                      <div className="ladder__t">
                        <b>{step.label}</b>
                      </div>
                      <div className="ladder__m" style={{ justifyContent: 'flex-start', textAlign: 'left' }}>
                        {step.detail}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          <div>
            <p className="lbl">Status</p>
            <div className="card">
              <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
                <Mark state={workspace?.engine.status === 'ready' ? 'proved' : 'open'} size={16} />
                <div>
                  <b style={{ fontSize: 12.5 }}>
                    {workspace?.engine.status === 'ready' ? 'Lean server ready' : 'No Lean server'}
                  </b>
                  <p className="note" style={{ fontSize: 12, margin: '6px 0 0' }}>
                    {workspace?.engine.status === 'unavailable'
                      ? workspace.engine.reason
                      : workspace?.engine.status === 'ready'
                        ? workspace.engine.detail
                        : ''}
                  </p>
                </div>
              </div>
            </div>

            <p className="lbl lbl--mt">The empty-state rule</p>
            <p className="note" style={{ fontSize: 12 }}>
              With no project connected the library still opens. You can state claims and you can
              search them for counterexamples — you just cannot prove any, and every square stays
              hollow.
            </p>

            <p className="lbl lbl--mt">Pin</p>
            <p className="note" style={{ fontSize: 12 }}>
              Proofs are recorded against an exact toolchain and revision. Changing either marks
              every affected result stale and re-verifies it. No cached green ticks.
            </p>

            <button
              className="btn btn--ghost btn--wide"
              type="button"
              style={{ marginTop: 12 }}
              onClick={() => navigate('/')}
            >
              Back to the workspace
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
