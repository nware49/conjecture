/**
 * The API client.
 *
 * Every shape here mirrors what the server derives. In particular `view` is
 * computed server-side by the domain, so the client renders a claim's state
 * rather than deciding it. That is deliberate: there is one place that knows
 * what "proved" means, and it is not in the browser.
 */
export type ClaimState = 'open' | 'in_progress' | 'proved' | 'refuted' | 'stale';
export type MarkState = 'open' | 'partial' | 'proved' | 'refuted' | 'stale';
export type SyncState = 'synced' | 'lean-behind' | 'prose-behind' | 'diverged';
export interface ClaimView {
    state: ClaimState;
    stateLabel: string;
    mark: MarkState;
    fill: number;
    summary: string;
    rung: number;
    rungLabel: string;
    rungDescription: string;
    method: 'lean-kernel' | 'exhaustion' | null;
    methodLabel: string | null;
    scope: string | null;
    sorryCount: number;
    gapCount: number;
    percent: number;
    verifiedSteps: number;
    totalSteps: number;
    staleness: {
        field: string;
        name: string;
        was: string;
        now: string;
    }[];
    trustsCompiler: boolean;
    customAxioms: string[];
}
export interface Claim {
    id: string;
    title: string;
    declaration: string;
    statement: {
        prose: string;
        lean: string;
        assumptions: string[];
        sync: SyncState;
        syncMessage: string;
    };
    steps: {
        id: string;
        text: string;
        status: 'verified' | 'gap' | 'blocked' | 'pending';
        citations: {
            name: string;
            origin: string;
        }[];
        elapsedMs: number | null;
    }[];
    gaps: {
        id: string;
        label: string;
        line: number;
        column: number;
        goal: string | null;
    }[];
    view: ClaimView;
    receipt: {
        engine: string;
        method: string;
        scope: string | null;
        declaration: string;
        axioms: {
            axioms: {
                name: string;
                kind: string;
            }[];
            standardOnly: boolean;
            trustsCompiler: boolean;
        };
        sorryCount: number;
        accepted: boolean;
        elapsedMs: number;
        verifiedAt: string;
    } | null;
    refutation: {
        witness: {
            assignment: Record<string, string>;
            evaluation: string;
        };
        authority: 'computed' | 'kernel-confirmed';
        candidatesChecked: number;
        elapsedMs: number;
        foundAt: string;
    } | null;
    dependsOn: string[];
    supersededBy: string | null;
    createdAt: string;
    updatedAt: string;
}
export type EngineHealth = {
    status: 'ready';
    kind: string;
    detail: string;
} | {
    status: 'building';
    kind: string;
    detail: string;
} | {
    status: 'unavailable';
    kind: string;
    reason: string;
};
export interface Workspace {
    project: {
        id: string;
        name: string;
        root: string;
        pinLabel: string;
        inheritedSorries: number;
        limits: {
            maxHeartbeats: number;
            elaborationTimeoutMs: number;
        };
    } | null;
    engine: EngineHealth;
    claims: Claim[];
    counts: {
        byState: Record<ClaimState, number>;
        total: number;
        totalSorries: number;
        provedFraction: number;
    };
    canVerify: boolean;
    blockedReason: string | null;
    /** What a remote pin cannot see. Null for a local project. */
    pinCaveat: string | null;
}
export interface TraceRow {
    assignment: Record<string, string>;
    values: Record<string, string>;
    holds: boolean;
}
export type SearchOutcome = {
    kind: 'witness';
    witness: {
        assignment: Record<string, string>;
        evaluation: string;
    };
    candidatesChecked: number;
    elapsedMs: number;
    trace: TraceRow[];
    usedProbabilisticPrimality: boolean;
} | {
    kind: 'exhausted';
    candidatesChecked: number;
    elapsedMs: number;
    trace: TraceRow[];
    usedProbabilisticPrimality: boolean;
} | {
    kind: 'budget';
    reason: 'time' | 'candidates';
    candidatesChecked: number;
    elapsedMs: number;
    trace: TraceRow[];
    usedProbabilisticPrimality: boolean;
} | {
    kind: 'error';
    message: string;
    position: {
        line: number;
        column: number;
    } | null;
    candidatesChecked: number;
    elapsedMs: number;
};
export interface SearchRecord {
    id: string;
    claimId: string | null;
    status: 'running' | 'done' | 'cancelled' | 'failed';
    progress: {
        candidatesChecked: number;
        elapsedMs: number;
        fraction: number | null;
    };
    spaceSize: string;
    startedAt: string;
    finishedAt: string | null;
    outcome: SearchOutcome | null;
    sentence: string;
    variables: {
        name: string;
        from: string;
        to: string;
        step: string;
    }[];
    strategy: 'enumerate' | 'random';
    budgetMs: number;
    definitions: string;
    predicate: string;
}
export interface GraphNode {
    id: string;
    title: string;
    declaration: string;
    state: ClaimState;
    fill: number;
    layer: number;
    onCriticalPath: boolean;
    invalidated: boolean;
}
export interface DependencyGraph {
    nodes: GraphNode[];
    edges: {
        from: string;
        to: string;
        onCriticalPath: boolean;
        dead: boolean;
    }[];
    goal: string | null;
    blockers: string[];
    cycles: string[][];
    layerCount: number;
}
export interface Example {
    id: string;
    title: string;
    prose: string;
    lean: string;
    note: string;
    expect: string;
    request: {
        definitions: string;
        predicate: string;
        variables: {
            name: string;
            from: string;
            to: string;
            step: string;
        }[];
        strategy: string;
        budgetMs: number;
        maxCandidates: number;
        report: {
            label: string;
            expr: string;
        }[];
    };
}
export declare class ApiError extends Error {
    readonly status: number;
    readonly detail: string | null;
    constructor(status: number, message: string, detail: string | null);
}
export declare const api: {
    workspace: () => Promise<Workspace>;
    examples: () => Promise<Example[]>;
    createClaim: (input: {
        title: string;
        prose?: string;
        lean?: string;
    }) => Promise<Claim>;
    updateClaim: (id: string, input: {
        title?: string;
        prose?: string;
        lean?: string;
        confirmSync?: boolean;
    }) => Promise<Claim>;
    deleteClaim: (id: string) => Promise<unknown>;
    verify: (id: string) => Promise<{
        claim: Claim;
        diagnostics: unknown[];
        error: string | null;
    }>;
    weaken: (id: string) => Promise<Claim>;
    startSearch: (id: string, body: unknown) => Promise<SearchRecord>;
    search: (id: string) => Promise<SearchRecord>;
    searches: () => Promise<SearchRecord[]>;
    cancelSearch: (id: string) => Promise<unknown>;
    applySearch: (id: string) => Promise<Claim>;
    graph: (goal: string | null) => Promise<DependencyGraph>;
    connect: (root: string) => Promise<{
        workspace: Workspace;
        steps: unknown;
    }>;
    connectEndpoint: (endpoint: string, project?: string) => Promise<{
        workspace: Workspace;
        steps: unknown;
    }>;
    disconnect: () => Promise<Workspace>;
};
/** Subscribe to a search's progress. Returns an unsubscribe function. */
export declare function watchSearch(id: string, handlers: {
    onProgress?: (record: SearchRecord['progress']) => void;
    onDone?: (record: SearchRecord) => void;
}): () => void;
//# sourceMappingURL=api.d.ts.map