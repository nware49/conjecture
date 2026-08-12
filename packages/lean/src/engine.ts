/**
 * The Lean engine port.
 *
 * Everything upstream of the kernel is a suggestion. This interface is the only
 * way anything in the product reaches the thing that decides, and it is
 * deliberately narrow: elaborate a file, report what Lean said.
 */

import type { AxiomReport, EngineHealth, SourcePos } from '@conjecture/core';
import type { Diagnostic, GoalState, SorryHole } from './diagnostics.js';

export interface ElaborateRequest {
  /** Where to write the file, relative to the project root. */
  readonly relativePath: string;
  readonly source: string;
  /** Declaration to run `#print axioms` against, when there is one. */
  readonly declaration: string | null;
  readonly maxHeartbeats: number;
  readonly timeoutMs: number;
}

export interface ElaborationResult {
  readonly diagnostics: readonly Diagnostic[];
  readonly sorries: readonly SorryHole[];
  readonly goals: readonly GoalState[];
  /** Null when `#print axioms` was not run or produced nothing readable. */
  readonly axioms: AxiomReport | null;
  /**
   * True when Lean exited cleanly with no error diagnostics. On its own this
   * is not "proved" — a file full of `sorry` also elaborates cleanly.
   */
  readonly kernelAccepted: boolean;
  readonly elapsedMs: number;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  /** Lines of output that were not JSON. Kept, never discarded. */
  readonly unparsed: readonly string[];
  readonly stderr: string;
}

export interface EngineError {
  readonly message: string;
  readonly detail: string | null;
}

export interface LeanEngine {
  readonly kind: 'lean-process' | 'unavailable';
  health(): Promise<EngineHealth>;
  elaborate(request: ElaborateRequest): Promise<ElaborationResult | EngineError>;
  dispose(): Promise<void>;
}

export function isEngineError(value: ElaborationResult | EngineError): value is EngineError {
  return 'message' in value && !('diagnostics' in value);
}

/** Position helper used when a diagnostic arrives without one. */
export const ORIGIN: SourcePos = { line: 1, column: 0 };

/**
 * Wrap a user's Lean in the options the workspace pins, and append the axiom
 * query. The header is counted so reported positions can be mapped back to the
 * user's own line numbers — an off-by-N here would point every error at the
 * wrong line.
 */
export function buildSource(request: ElaborateRequest): { text: string; headerLines: number } {
  const header = [`set_option maxHeartbeats ${request.maxHeartbeats}`, ''];
  const footer =
    request.declaration === null ? [] : ['', `#print axioms ${request.declaration}`];
  return {
    text: [...header, request.source, ...footer].join('\n'),
    headerLines: header.length,
  };
}

/** Shift a diagnostic back into the user's coordinate system. */
export function unshiftDiagnostic(diagnostic: Diagnostic, headerLines: number): Diagnostic {
  const shift = (pos: SourcePos): SourcePos => ({
    line: Math.max(1, pos.line - headerLines),
    column: pos.column,
  });
  return {
    ...diagnostic,
    range: { start: shift(diagnostic.range.start), end: shift(diagnostic.range.end) },
  };
}
