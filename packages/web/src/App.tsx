import { useEffect, useState } from 'react';
import { Chrome } from './components/Chrome.js';
import { Mark } from './components/Mark.js';
import { Palette } from './components/Palette.js';
import { BenchScreen } from './screens/Bench.js';
import { ConnectScreen } from './screens/Connect.js';
import { GraphScreen } from './screens/Graph.js';
import { ShareScreen } from './screens/Share.js';
import { TrustScreen } from './screens/Trust.js';
import { WorkspaceScreen } from './screens/Workspace.js';
import { useRoute, useStore } from './store.js';

export function App(): JSX.Element {
  const route = useRoute();
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <Chrome onOpenPalette={() => setPaletteOpen(true)} />
      {route.name === 'workspace' && <WorkspaceScreen />}
      {route.name === 'graph' && <GraphScreen />}
      {route.name === 'bench' && <BenchScreen />}
      {route.name === 'connect' && <ConnectScreen />}
      {route.name === 'trust' && <TrustScreen />}
      {route.name === 'share' && <ShareScreen claimId={route.claimId} />}
      <Palette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <Notices />
    </>
  );
}

/**
 * Messages. Terse and exact, in Lean's register — a mismatch between the
 * kernel's tone and the interface's reads as marketing.
 */
function Notices(): JSX.Element {
  const { notices, dismiss } = useStore();

  return (
    <div
      style={{
        position: 'fixed',
        right: 16,
        bottom: 46,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        zIndex: 50,
        maxWidth: 'min(460px, 88vw)',
      }}
    >
      {notices.map((notice) => (
        <button
          type="button"
          key={notice.id}
          onClick={() => dismiss(notice.id)}
          style={{
            display: 'flex',
            gap: 9,
            alignItems: 'flex-start',
            textAlign: 'left',
            background: '#fff',
            border: `1px solid ${
              notice.tone === 'bad' ? 'var(--refuted)' : notice.tone === 'good' ? 'var(--proved-deep)' : 'var(--ink)'
            }`,
            boxShadow: '0 8px 24px rgba(20,22,28,0.14)',
            padding: '10px 12px',
            fontSize: 12,
            lineHeight: 1.5,
            cursor: 'pointer',
          }}
        >
          <Mark
            state={notice.tone === 'bad' ? 'refuted' : notice.tone === 'good' ? 'proved' : 'open'}
            size={14}
          />
          <span>{notice.text}</span>
        </button>
      ))}
    </div>
  );
}
