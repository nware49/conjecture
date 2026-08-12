/**
 * Lean source, lightly marked up.
 *
 * Keywords get weight, comments recede, and `sorry` is called out in red
 * because it is the one token whose presence changes what the claim means.
 * No reformatting — the text shown is the text sent.
 */

import { Fragment, type ReactNode } from 'react';

const KEYWORDS = new Set([
  'theorem',
  'lemma',
  'example',
  'def',
  'by',
  'with',
  'induction',
  'rcases',
  'exact',
  'intro',
  'intros',
  'apply',
  'simp',
  'rfl',
  'cases',
  'match',
  'fun',
  'let',
  'have',
  'show',
  'calc',
  'from',
  'obtain',
  'refine',
  'constructor',
  'omega',
  'decide',
  'native_decide',
  'set_option',
  'open',
  'import',
  'namespace',
  'end',
  'variable',
  'instance',
  'structure',
]);

function markupLine(line: string, key: number): ReactNode {
  const commentAt = line.indexOf('--');
  const code = commentAt >= 0 ? line.slice(0, commentAt) : line;
  const comment = commentAt >= 0 ? line.slice(commentAt) : '';

  const pieces: ReactNode[] = [];
  const pattern = /([A-Za-z_][A-Za-z0-9_.']*)/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(code)) !== null) {
    if (match.index > last) pieces.push(code.slice(last, match.index));
    const word = match[1]!;
    if (word === 'sorry') {
      pieces.push(
        <span className="sorry" key={`${key}-${match.index}`}>
          {word}
        </span>,
      );
    } else if (KEYWORDS.has(word)) {
      pieces.push(
        <span className="kw" key={`${key}-${match.index}`}>
          {word}
        </span>,
      );
    } else {
      pieces.push(word);
    }
    last = match.index + word.length;
  }
  if (last < code.length) pieces.push(code.slice(last));
  if (comment) pieces.push(<span className="cm" key={`${key}-c`}>{comment}</span>);

  return (
    <Fragment key={key}>
      {pieces}
      {'\n'}
    </Fragment>
  );
}

export function LeanCode({ source, className }: { source: string; className?: string }): JSX.Element {
  const lines = source.replace(/\n$/, '').split('\n');
  return (
    <pre className={className ?? 'blk blk--code'} style={{ margin: 0 }}>
      {lines.map((line, index) => markupLine(line, index))}
    </pre>
  );
}

/**
 * A goal state, rendered verbatim from the server. This is the one panel on
 * screen the model is not allowed to write, so the only thing done to it is
 * putting weight on the turnstile.
 */
export function GoalBlock({ raw }: { raw: string }): JSX.Element {
  const lines = raw.split('\n');
  return (
    <pre className="info">
      {lines.map((line, index) => {
        const turnstile = line.trimStart().startsWith('⊢');
        return (
          <Fragment key={index}>
            {turnstile ? <span className="goal">{line}</span> : line}
            {index < lines.length - 1 ? '\n' : ''}
          </Fragment>
        );
      })}
    </pre>
  );
}
