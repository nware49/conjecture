/**
 * `#print axioms` parsing.
 *
 * On success the bridge runs `#print axioms` and stores the result with the
 * proof. A proof without its receipt is treated as unverified, so this parser
 * sits directly on the path between "Lean exited 0" and "the square fills".
 */

import { reportAxioms, type AxiomReport } from '@conjecture/core';
import type { Diagnostic } from './diagnostics.js';

const DEPENDS = /^'?([^']+?)'?\s+depends on axioms:\s*\[([^\]]*)\]/s;
const NO_AXIOMS = /^'?([^']+?)'?\s+does not depend on any axioms/s;

export interface AxiomPrint {
  readonly declaration: string;
  readonly report: AxiomReport;
}

/**
 * Parse one `#print axioms foo` message.
 *
 * Returns null when the text is not an axiom report at all, which is different
 * from an empty axiom list — the latter is the strongest possible result and
 * must not be confused with "we did not look".
 */
export function parseAxiomMessage(text: string): AxiomPrint | null {
  const trimmed = text.trim();

  const none = NO_AXIOMS.exec(trimmed);
  if (none) {
    return { declaration: none[1]!.trim(), report: reportAxioms([]) };
  }

  const depends = DEPENDS.exec(trimmed);
  if (depends) {
    const names = depends[2]!
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name.length > 0);
    return { declaration: depends[1]!.trim(), report: reportAxioms(names) };
  }

  return null;
}

/** Find the axiom report for a given declaration among a run's diagnostics. */
export function findAxiomReport(
  diagnostics: readonly Diagnostic[],
  declaration: string,
): AxiomReport | null {
  for (const diagnostic of diagnostics) {
    const parsed = parseAxiomMessage(diagnostic.message);
    if (parsed === null) continue;
    if (parsed.declaration === declaration || parsed.declaration.endsWith(`.${declaration}`)) {
      return parsed.report;
    }
  }
  return null;
}

/** All axiom reports in a run, keyed by declaration. */
export function collectAxiomReports(
  diagnostics: readonly Diagnostic[],
): ReadonlyMap<string, AxiomReport> {
  const found = new Map<string, AxiomReport>();
  for (const diagnostic of diagnostics) {
    const parsed = parseAxiomMessage(diagnostic.message);
    if (parsed !== null) found.set(parsed.declaration, parsed.report);
  }
  return found;
}

/**
 * The lines shown under "Axioms used". Three quiet lines, not a badge — the
 * standard three are unremarkable and should look it.
 */
export function axiomLines(report: AxiomReport): readonly string[] {
  if (report.axioms.length === 0) return ['depends on no axioms'];
  return report.axioms.map((axiom) => axiom.name);
}

/** The sentence shown when the trusted base is larger than the standard three. */
export function extendedTrustNote(report: AxiomReport): string | null {
  if (report.dependsOnSorry) {
    return 'This declaration reaches sorryAx, so it is not proved whatever the build reported.';
  }
  if (report.trustsCompiler) {
    return 'Proved, using native_decide. This adds Lean.ofReduceBool, so the result depends on the Lean compiler being correct. Replace it with decide to remove that.';
  }
  if (report.custom.length > 0) {
    const names = report.custom.join(', ');
    return `Proved against ${report.custom.length === 1 ? 'an axiom' : 'axioms'} outside the standard three: ${names}.`;
  }
  return null;
}
