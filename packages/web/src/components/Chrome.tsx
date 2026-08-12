import { Mark, Wordmark } from './Mark.js';
import { navigate, useRoute, useStore } from '../store.js';

const LINKS: { href: string; label: string; route: string }[] = [
  { href: '#/', label: 'Workspace', route: 'workspace' },
  { href: '#/graph', label: 'Depends', route: 'graph' },
  { href: '#/bench', label: 'Bench', route: 'bench' },
  { href: '#/trust', label: 'Trust', route: 'trust' },
  { href: '#/connect', label: 'Project', route: 'connect' },
];

export function Chrome({ onOpenPalette }: { onOpenPalette: () => void }): JSX.Element {
  const { workspace, selected } = useStore();
  const route = useRoute();
  const engine = workspace?.engine;

  return (
    <header className="bar">
      <a className="bar__logo" href="#/" aria-label="Conjecture, home">
        <Mark state={selected?.view.mark ?? 'open'} fill={selected?.view.fill ?? 0} size={18} />
        <Wordmark size={13} attribution={false} />
      </a>

      <span className="bar__sep" />

      <span className="bar__title" title={selected?.title}>
        {selected?.title ?? 'No claim selected'}
      </span>

      <button className="bar__search" onClick={onOpenPalette} type="button">
        Search claims, lemmas, commands…
      </button>
      <span className="chip">⌘K</span>

      <nav className="nav bar__spacer" aria-label="Screens">
        {LINKS.map((link) => (
          <a
            key={link.href}
            href={link.href}
            aria-current={route.name === link.route ? 'page' : undefined}
          >
            {link.label}
          </a>
        ))}
      </nav>

      <span className="chip" title={workspace?.project?.root ?? 'No project connected'}>
        {workspace?.project?.pinLabel ?? 'no project pinned'}
      </span>

      <button
        type="button"
        className={`chip chip--link ${engine?.status === 'ready' ? 'chip--ok' : 'chip--bad'}`}
        onClick={() => navigate('/connect')}
        title={engine?.status === 'unavailable' ? engine.reason : undefined}
      >
        {engine?.status === 'ready' ? '● server ready' : '○ no lean server'}
      </button>
    </header>
  );
}
