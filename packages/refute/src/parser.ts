/**
 * Recursive-descent parser for the definition language.
 *
 * Deliberately small. It exists so a claim about integers can be written down
 * and searched without ever reaching `eval()` or a floating-point number.
 */

import type { BinaryOp, Clause, Expr, Pattern, Program } from './ast.js';
import { ParseError, type Position } from './errors.js';
import { tokenize, type Token } from './lexer.js';

class Parser {
  private index = 0;

  constructor(private readonly tokens: readonly Token[]) {}

  private get current(): Token {
    return this.tokens[this.index]!;
  }

  private at(kind: Token['kind'], text?: string): boolean {
    const token = this.current;
    return token.kind === kind && (text === undefined || token.text === text);
  }

  private take(): Token {
    const token = this.current;
    if (token.kind !== 'eof') this.index += 1;
    return token;
  }

  private expect(kind: Token['kind'], text?: string): Token {
    if (!this.at(kind, text)) {
      const want = text ?? kind;
      const got = this.current.kind === 'eof' ? 'end of input' : JSON.stringify(this.current.text);
      throw new ParseError(`Expected ${want}, got ${got}.`, this.current.pos);
    }
    return this.take();
  }

  private skipNewlines(): void {
    while (this.at('newline')) this.take();
  }

  // ── program ────────────────────────────────────────────────────────────

  parseProgram(): Program {
    const clauses: Clause[] = [];
    this.skipNewlines();
    while (!this.at('eof')) {
      clauses.push(this.parseClause());
      if (!this.at('eof')) {
        if (!this.at('newline')) {
          throw new ParseError(
            `Expected a line break between definitions, got ${JSON.stringify(this.current.text)}.`,
            this.current.pos,
          );
        }
        this.skipNewlines();
      }
    }
    return { clauses };
  }

  private parseClause(): Clause {
    const nameToken = this.expect('ident');
    const pos = nameToken.pos;
    const params: Pattern[] = [];

    if (this.at('lparen')) {
      this.take();
      if (!this.at('rparen')) {
        params.push(this.parsePattern());
        while (this.at('comma')) {
          this.take();
          params.push(this.parsePattern());
        }
      }
      this.expect('rparen');
    }

    let guard: Expr | null = null;
    if (this.at('keyword', 'when')) {
      this.take();
      guard = this.parseExpr();
    }

    this.expect('op', '=');
    const body = this.parseExpr();
    return { name: nameToken.text, params, guard, body, pos };
  }

  private parsePattern(): Pattern {
    if (this.at('number')) {
      const token = this.take();
      return { kind: 'literal', value: token.value!, pos: token.pos };
    }
    if (this.at('op', '-') && this.tokens[this.index + 1]?.kind === 'number') {
      const pos = this.take().pos;
      const token = this.take();
      return { kind: 'literal', value: -token.value!, pos };
    }
    const token = this.expect('ident');
    return { kind: 'binding', name: token.text, pos: token.pos };
  }

  // ── expressions, loosest binding first ─────────────────────────────────

  parseExpr(): Expr {
    if (this.at('keyword', 'if')) return this.parseIf();
    if (this.at('keyword', 'let')) return this.parseLet();
    return this.parseOr();
  }

  private parseIf(): Expr {
    const pos = this.expect('keyword', 'if').pos;
    const cond = this.parseExpr();
    this.expect('keyword', 'then');
    const then = this.parseExpr();
    this.expect('keyword', 'else');
    const otherwise = this.parseExpr();
    return { kind: 'if', cond, then, otherwise, pos };
  }

  private parseLet(): Expr {
    const pos = this.expect('keyword', 'let').pos;
    const name = this.expect('ident').text;
    this.expect('op', '=');
    const value = this.parseExpr();
    this.expect('keyword', 'in');
    const body = this.parseExpr();
    return { kind: 'let', name, value, body, pos };
  }

  private parseBinaryLevel(ops: readonly string[], next: () => Expr): Expr {
    let left = next();
    while (this.current.kind === 'op' && ops.includes(this.current.text)) {
      const opToken = this.take();
      const right = next();
      left = {
        kind: 'binary',
        op: opToken.text as BinaryOp,
        left,
        right,
        pos: opToken.pos,
      };
    }
    return left;
  }

  private parseOr(): Expr {
    return this.parseBinaryLevel(['||'], () => this.parseAnd());
  }

  private parseAnd(): Expr {
    return this.parseBinaryLevel(['&&'], () => this.parseComparison());
  }

  private parseComparison(): Expr {
    // Non-associative: `a < b < c` is a mistake worth reporting, not a chain
    // to silently reinterpret.
    const left = this.parseAdditive();
    if (this.current.kind === 'op' && ['==', '!=', '<', '<=', '>', '>='].includes(this.current.text)) {
      const opToken = this.take();
      const right = this.parseAdditive();
      if (this.current.kind === 'op' && ['==', '!=', '<', '<=', '>', '>='].includes(this.current.text)) {
        throw new ParseError(
          'Chained comparisons are not supported. Write a < b && b < c.',
          this.current.pos,
        );
      }
      return { kind: 'binary', op: opToken.text as BinaryOp, left, right, pos: opToken.pos };
    }
    return left;
  }

  private parseAdditive(): Expr {
    return this.parseBinaryLevel(['+', '-'], () => this.parseMultiplicative());
  }

  private parseMultiplicative(): Expr {
    return this.parseBinaryLevel(['*', '/', '%'], () => this.parseUnary());
  }

  private parseUnary(): Expr {
    if (this.at('op', '-')) {
      const pos = this.take().pos;
      return { kind: 'unary', op: '-', operand: this.parseUnary(), pos };
    }
    if (this.at('op', '!')) {
      const pos = this.take().pos;
      return { kind: 'unary', op: '!', operand: this.parseUnary(), pos };
    }
    return this.parsePower();
  }

  private parsePower(): Expr {
    const base = this.parseAtom();
    if (this.at('op', '^')) {
      const pos = this.take().pos;
      // Right associative: 2^3^2 is 2^(3^2), as everywhere else in mathematics.
      const exponent = this.parseUnary();
      return { kind: 'binary', op: '^', left: base, right: exponent, pos };
    }
    return base;
  }

  private parseAtom(): Expr {
    const token = this.current;

    if (token.kind === 'number') {
      this.take();
      return { kind: 'num', value: token.value!, pos: token.pos };
    }

    if (token.kind === 'keyword' && (token.text === 'true' || token.text === 'false')) {
      this.take();
      return { kind: 'bool', value: token.text === 'true', pos: token.pos };
    }

    if (token.kind === 'ident') {
      this.take();
      if (this.at('lparen')) {
        this.take();
        const args: Expr[] = [];
        if (!this.at('rparen')) {
          args.push(this.parseExpr());
          while (this.at('comma')) {
            this.take();
            args.push(this.parseExpr());
          }
        }
        this.expect('rparen');
        return { kind: 'call', callee: token.text, args, pos: token.pos };
      }
      return { kind: 'var', name: token.text, pos: token.pos };
    }

    if (token.kind === 'lparen') {
      this.take();
      const inner = this.parseExpr();
      this.expect('rparen');
      return inner;
    }

    throw new ParseError(
      token.kind === 'eof'
        ? 'Unexpected end of input.'
        : `Unexpected ${JSON.stringify(token.text)}.`,
      token.pos,
    );
  }

  atEnd(): boolean {
    this.skipNewlines();
    return this.at('eof');
  }

  positionHere(): Position {
    return this.current.pos;
  }
}

export function parseProgram(source: string): Program {
  return new Parser(tokenize(source)).parseProgram();
}

/** Parse a single expression, e.g. the predicate under search. */
export function parseExpression(source: string): Expr {
  const parser = new Parser(tokenize(source));
  const expr = parser.parseExpr();
  if (!parser.atEnd()) {
    throw new ParseError('Unexpected trailing input after the expression.', parser.positionHere());
  }
  return expr;
}
