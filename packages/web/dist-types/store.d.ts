/**
 * Workspace state.
 *
 * Mutations go to the server and the whole workspace comes back. That keeps
 * exactly one derivation of "what state is this claim in" — the domain's —
 * rather than a second, drifting copy in the browser.
 */
import { type ReactNode } from 'react';
import { type Claim, type Workspace } from './api.js';
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
export declare function StoreProvider({ children }: {
    children: ReactNode;
}): JSX.Element;
export declare function useStore(): StoreValue;
/** Hash routing. Five screens do not need a router library. */
export type Route = {
    name: 'workspace';
} | {
    name: 'graph';
} | {
    name: 'bench';
    searchId: string | null;
} | {
    name: 'connect';
} | {
    name: 'trust';
} | {
    name: 'share';
    claimId: string | null;
};
export declare function parseRoute(hash: string): Route;
export declare function useRoute(): Route;
export declare function navigate(path: string): void;
export {};
//# sourceMappingURL=store.d.ts.map