/**
 * Branded identifiers. The domain has several kinds of string id flying around
 * and mixing a ClaimId with a StepId is exactly the sort of bug that is
 * invisible in review, so the compiler holds them apart.
 */

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type ClaimId = Brand<string, 'ClaimId'>;
export type StepId = Brand<string, 'StepId'>;
export type GapId = Brand<string, 'GapId'>;
export type ProjectId = Brand<string, 'ProjectId'>;
export type SearchId = Brand<string, 'SearchId'>;

export const asClaimId = (s: string): ClaimId => s as ClaimId;
export const asStepId = (s: string): StepId => s as StepId;
export const asGapId = (s: string): GapId => s as GapId;
export const asProjectId = (s: string): ProjectId => s as ProjectId;
export const asSearchId = (s: string): SearchId => s as SearchId;

const SLUG_MAX = 48;

/**
 * A readable, stable slug. Ids show up in URLs, in Lean declaration names and
 * in receipts, so they are worth keeping legible rather than opaque.
 */
export function slugify(input: string): string {
  const base = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining marks left by NFKD
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/_+$/g, '');
  return base.length > 0 ? base : 'claim';
}

/**
 * Make `desired` unique against `taken` by appending _2, _3, … — the same
 * convention Lean users see from the elaborator, so it reads as native.
 */
export function uniqueSlug(desired: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = slugify(desired);
  if (!used.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}_${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

/**
 * A Lean-legal declaration name derived from a claim title. Lean identifiers
 * cannot start with a digit, which titles routinely do ("2-adic bound").
 */
export function leanDeclName(title: string): string {
  const slug = slugify(title);
  return /^[0-9]/.test(slug) ? `c_${slug}` : slug;
}
