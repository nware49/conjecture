/**
 * Workspace state.
 *
 * Mutations go to the server and the whole workspace comes back. That keeps
 * exactly one derivation of "what state is this claim in" — the domain's —
 * rather than a second, drifting copy in the browser.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api, ApiError, type Claim, type Workspace } from './api.js';

export interface Notice {
  id: number;
  tone: 'plain' | 'good' | 'bad';
  text: string;
}

interface StoreValue {
  workspace: Workspace | null;
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  selected: Claim | null;
  notices: Notice[];
  busy: boolean;
  refresh: () => Promise<void>;
  select: (id: string | null) => void;
  run: <T>(label: string, action: () => Promise<T>) => Promise<T | null>;
  notify: (text: string, tone?: Notice['tone']) => void;
  dismiss: (id: number) => void;
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }): JSX.Element {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [busy, setBusy] = useState(false);
  const noticeId = useRef(0);

  const notify = useCallback((text: string, tone: Notice['tone'] = 'plain') => {
    const id = (noticeId.current += 1);
    setNotices((current) => [...current.slice(-2), { id, tone, text }]);
    // Long enough to read a sentence about a kernel result, short enough not to
    // sit on top of the thing it is describing.
    setTimeout(() => setNotices((current) => current.filter((n) => n.id !== id)), 7000);
  }, []);

  const dismiss = useCallback((id: number) => {
    setNotices((current) => current.filter((n) => n.id !== id));
  }, []);

  const refresh = useCallback(async () => {
    try {
      const next = await api.workspace();
      setWorkspace(next);
      setError(null);
      setSelectedId((current) => {
        if (current && next.claims.some((c) => c.id === current)) return current;
        return next.claims[0]?.id ?? null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = useCallback(
    async <T,>(label: string, action: () => Promise<T>): Promise<T | null> => {
      setBusy(true);
      try {
        const result = await action();
        await refresh();
        return result;
      } catch (err) {
        // Say what failed and what the server said about it. No "something went
        // wrong" — this audience will forgive a tool that fails and never
        // forgive one that is vague about it.
        const detail = err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err);
        notify(`${label} failed — ${detail}`, 'bad');
        return null;
      } finally {
        setBusy(false);
      }
    },
    [refresh, notify],
  );

  const selected = useMemo(
    () => workspace?.claims.find((c) => c.id === selectedId) ?? null,
    [workspace, selectedId],
  );

  const value = useMemo<StoreValue>(
    () => ({
      workspace,
      loading,
      error,
      selectedId,
      selected,
      notices,
      busy,
      refresh,
      select: setSelectedId,
      run,
      notify,
      dismiss,
    }),
    [workspace, loading, error, selectedId, selected, notices, busy, refresh, run, notify, dismiss],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const value = useContext(StoreContext);
  if (!value) throw new Error('useStore must be used inside a StoreProvider.');
  return value;
}

/** Hash routing. Five screens do not need a router library. */
export type Route =
  | { name: 'workspace' }
  | { name: 'graph' }
  | { name: 'bench'; searchId: string | null }
  | { name: 'connect' }
  | { name: 'trust' }
  | { name: 'share'; claimId: string | null };

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  switch (parts[0]) {
    case 'graph':
      return { name: 'graph' };
    case 'bench':
      return { name: 'bench', searchId: parts[1] ?? null };
    case 'connect':
      return { name: 'connect' };
    case 'trust':
      return { name: 'trust' };
    case 'share':
      return { name: 'share', claimId: parts[1] ?? null };
    default:
      return { name: 'workspace' };
  }
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));

  useEffect(() => {
    const onChange = (): void => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  return route;
}

export function navigate(path: string): void {
  window.location.hash = path.startsWith('#') ? path : `#${path}`;
}
