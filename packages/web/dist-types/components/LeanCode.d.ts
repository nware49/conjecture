/**
 * Lean source, lightly marked up.
 *
 * Keywords get weight, comments recede, and `sorry` is called out in red
 * because it is the one token whose presence changes what the claim means.
 * No reformatting — the text shown is the text sent.
 */
export declare function LeanCode({ source, className }: {
    source: string;
    className?: string;
}): JSX.Element;
/**
 * A goal state, rendered verbatim from the server. This is the one panel on
 * screen the model is not allowed to write, so the only thing done to it is
 * putting weight on the turnstile.
 */
export declare function GoalBlock({ raw }: {
    raw: string;
}): JSX.Element;
//# sourceMappingURL=LeanCode.d.ts.map