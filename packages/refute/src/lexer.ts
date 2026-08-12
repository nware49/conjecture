import { LexError, type Position } from './errors.js';

export type TokenKind =
  | 'number'
  | 'ident'
  | 'keyword'
  | 'op'
  | 'lparen'
  | 'rparen'
  | 'comma'
  | 'newline'
  | 'eof';

export interface Token {
  readonly kind: TokenKind;
  readonly text: string;
  readonly value?: bigint;
  readonly pos: Position;
}

const KEYWORDS = new Set(['if', 'then', 'else', 'let', 'in', 'when', 'true', 'false']);

/** Longest match first, so `<=` never lexes as `<` followed by `=`. */
const OPERATORS = [
  '==',
  '!=',
  '<=',
  '>=',
  '&&',
  '||',
  '+',
  '-',
  '*',
  '/',
  '%',
  '^',
  '<',
  '>',
  '=',
  '!',
];

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

function isIdentStart(ch: string): boolean {
  return /[A-Za-z_]/.test(ch);
}

function isIdentPart(ch: string): boolean {
  return /[A-Za-z0-9_']/.test(ch);
}

/**
 * Tokenise. Newlines are significant — they separate clauses — so they survive
 * as tokens rather than being eaten as whitespace.
 */
export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let offset = 0;
  let line = 1;
  let column = 0;

  const here = (): Position => ({ offset, line, column });

  const advance = (n: number): void => {
    for (let i = 0; i < n; i += 1) {
      if (source[offset] === '\n') {
        line += 1;
        column = 0;
      } else {
        column += 1;
      }
      offset += 1;
    }
  };

  while (offset < source.length) {
    const ch = source[offset]!;

    if (ch === '\n') {
      tokens.push({ kind: 'newline', text: '\n', pos: here() });
      advance(1);
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      advance(1);
      continue;
    }
    // `--` to end of line: Lean's comment syntax, so it needs no explaining.
    if (ch === '-' && source[offset + 1] === '-') {
      while (offset < source.length && source[offset] !== '\n') advance(1);
      continue;
    }
    if (ch === '#') {
      while (offset < source.length && source[offset] !== '\n') advance(1);
      continue;
    }

    if (isDigit(ch)) {
      const start = here();
      let text = '';
      while (offset < source.length && (isDigit(source[offset]!) || source[offset] === '_')) {
        if (source[offset] !== '_') text += source[offset];
        advance(1);
      }
      if (offset < source.length && source[offset] === '.') {
        throw new LexError(
          'Decimals are not supported. This engine works in exact integers, so a counterexample it reports is not a rounding artefact.',
          here(),
        );
      }
      tokens.push({ kind: 'number', text, value: BigInt(text), pos: start });
      continue;
    }

    if (isIdentStart(ch)) {
      const start = here();
      let text = '';
      while (offset < source.length && isIdentPart(source[offset]!)) {
        text += source[offset];
        advance(1);
      }
      tokens.push({ kind: KEYWORDS.has(text) ? 'keyword' : 'ident', text, pos: start });
      continue;
    }

    if (ch === '(') {
      tokens.push({ kind: 'lparen', text: '(', pos: here() });
      advance(1);
      continue;
    }
    if (ch === ')') {
      tokens.push({ kind: 'rparen', text: ')', pos: here() });
      advance(1);
      continue;
    }
    if (ch === ',') {
      tokens.push({ kind: 'comma', text: ',', pos: here() });
      advance(1);
      continue;
    }

    const op = OPERATORS.find((candidate) => source.startsWith(candidate, offset));
    if (op !== undefined) {
      const start = here();
      advance(op.length);
      tokens.push({ kind: 'op', text: op, pos: start });
      continue;
    }

    throw new LexError(`Unexpected character ${JSON.stringify(ch)}.`, here());
  }

  tokens.push({ kind: 'eof', text: '', pos: here() });
  return tokens;
}
