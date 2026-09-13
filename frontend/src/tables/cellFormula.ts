import { MAR_LABELS } from "../i18n/marLabels";

export const MAX_FORMULA_DEPTH = 16;

export type FormulaYear = "current" | "previous" | "auto";

export type FormulaAst =
  | { type: "number"; value: number }
  | { type: "mar"; expr: string; year: FormulaYear }
  | { type: "ratio"; id: string }
  | { type: "unary"; op: "+" | "-"; arg: FormulaAst }
  | {
      type: "binary";
      op: "+" | "-" | "*" | "/";
      left: FormulaAst;
      right: FormulaAst;
    };

export type FormulaParseResult =
  | { ok: true; ast: FormulaAst }
  | { ok: false; error: string };

export type FormulaEvalResult =
  | { ok: true; value: number }
  | { ok: false; error: string };

export interface FormulaResolveEnv {
  resolveMar: (expr: string, year: FormulaYear) => FormulaEvalResult;
  resolveRatio: (id: string) => FormulaEvalResult;
}

type OpChar = "+" | "-" | "*" | "/";

type Token =
  | { kind: "number"; value: number }
  | { kind: "mar"; expr: string; year: FormulaYear }
  | { kind: "ratio"; id: string }
  | { kind: "op"; op: OpChar }
  | { kind: "lparen" }
  | { kind: "rparen" };

const INVALID = "Ongeldige formule";
const MISSING_PAREN = "Ontbrekende haakje(s)";
const TOO_DEEP = "Te diepe formule";

const KNOWN_MAR_CODES = Object.keys(MAR_LABELS).sort(
  (a, b) => b.length - a.length,
);

const MAR_YEAR_PREFIX =
  /^mar\.(current|previous|prev|boekjaar|vorig):/i;
const AT_YEAR_PREFIX = /^@(current|previous|prev):/i;
const FALLBACK_MAR = /^[0-9A-Za-z]+(?:\/[0-9A-Za-z]+)*/;

function yearFromAlias(token: string): FormulaYear {
  const value = token.toLowerCase();
  if (value === "previous" || value === "prev" || value === "vorig") {
    return "previous";
  }
  if (value === "current" || value === "boekjaar") {
    return "current";
  }
  return "auto";
}

function matchKnownMarCode(input: string): string | null {
  const upper = input.toUpperCase();
  for (const code of KNOWN_MAR_CODES) {
    if (!upper.startsWith(code.toUpperCase())) continue;
    const next = input[code.length];
    if (next && /[0-9A-Za-z]/.test(next)) continue;
    return code;
  }
  return null;
}

function consumeMarCode(input: string): string | null {
  const known = matchKnownMarCode(input);
  if (known) return known;
  const fallback = FALLBACK_MAR.exec(input);
  return fallback?.[0] || null;
}

function isWs(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

function consumeMarToken(
  body: string,
  start: number,
  year: FormulaYear,
): { token: Token; next: number } | string {
  let i = start;
  while (i < body.length && isWs(body[i]!)) i++;
  const code = consumeMarCode(body.slice(i));
  if (!code) return INVALID;
  return { token: { kind: "mar", expr: code, year }, next: i + code.length };
}

export function tokenizeCellFormula(body: string): Token[] | string {
  const tokens: Token[] = [];
  let i = 0;

  while (i < body.length) {
    while (i < body.length && isWs(body[i]!)) i++;
    if (i >= body.length) break;

    const rest = body.slice(i);

    const marYear = MAR_YEAR_PREFIX.exec(rest);
    if (marYear) {
      const consumed = consumeMarToken(
        body,
        i + marYear[0].length,
        yearFromAlias(marYear[1]),
      );
      if (typeof consumed === "string") return consumed;
      tokens.push(consumed.token);
      i = consumed.next;
      continue;
    }

    if (/^mar:/i.test(rest)) {
      const consumed = consumeMarToken(body, i + 4, "auto");
      if (typeof consumed === "string") return consumed;
      tokens.push(consumed.token);
      i = consumed.next;
      continue;
    }

    const atYear = AT_YEAR_PREFIX.exec(rest);
    if (atYear) {
      const consumed = consumeMarToken(
        body,
        i + atYear[0].length,
        yearFromAlias(atYear[1]),
      );
      if (typeof consumed === "string") return consumed;
      tokens.push(consumed.token);
      i = consumed.next;
      continue;
    }

    if (rest.startsWith("@")) {
      const consumed = consumeMarToken(body, i + 1, "auto");
      if (typeof consumed === "string") return consumed;
      tokens.push(consumed.token);
      i = consumed.next;
      continue;
    }

    const ratioPrefix = /^(ratio:|ratio\/)/i.exec(rest);
    if (ratioPrefix) {
      i += ratioPrefix[0].length;
      while (i < body.length && isWs(body[i]!)) i++;
      const idMatch = /^[A-Za-z_][A-Za-z0-9_]*/.exec(body.slice(i));
      if (!idMatch) return INVALID;
      i += idMatch[0].length;
      tokens.push({ kind: "ratio", id: idMatch[0] });
      continue;
    }

    const num = /^(\d+(?:[.,]\d+)?|\.\d+)/.exec(rest);
    if (num) {
      const value = Number(num[1].replace(",", "."));
      if (!Number.isFinite(value)) return INVALID;
      tokens.push({ kind: "number", value });
      i += num[1].length;
      continue;
    }

    const ch = body[i]!;
    if (ch === "+" || ch === "-" || ch === "*" || ch === "/") {
      tokens.push({ kind: "op", op: ch });
      i++;
      continue;
    }
    if (ch === "(") {
      tokens.push({ kind: "lparen" });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ kind: "rparen" });
      i++;
      continue;
    }

    return INVALID;
  }

  return tokens;
}

function parseTokens(tokens: Token[]): FormulaParseResult {
  let pos = 0;
  let overflow = false;

  const peek = (): Token | undefined => tokens[pos];
  const take = (): Token | undefined => tokens[pos++];
  const unbalancedParens = (): boolean => {
    const opens = tokens.filter((token) => token.kind === "lparen").length;
    const closes = tokens.filter((token) => token.kind === "rparen").length;
    return opens !== closes;
  };

  const descend = (depth: number): boolean => {
    if (depth <= MAX_FORMULA_DEPTH) return true;
    overflow = true;
    return false;
  };

  const parsePrimary = (depth: number): FormulaAst | null => {
    if (!descend(depth)) return null;
    const tok = take();
    if (!tok) return null;
    if (tok.kind === "number") return { type: "number", value: tok.value };
    if (tok.kind === "mar") {
      return { type: "mar", expr: tok.expr, year: tok.year };
    }
    if (tok.kind === "ratio") return { type: "ratio", id: tok.id };
    if (tok.kind === "lparen") {
      const inner = parseExpr(depth + 1);
      if (!inner) return null;
      const close = take();
      if (close?.kind !== "rparen") return null;
      return inner;
    }
    return null;
  };

  const parseUnary = (depth: number): FormulaAst | null => {
    if (!descend(depth)) return null;
    const tok = peek();
    if (tok?.kind === "op" && (tok.op === "+" || tok.op === "-")) {
      take();
      const arg = parseUnary(depth + 1);
      if (!arg) return null;
      return { type: "unary", op: tok.op, arg };
    }
    return parsePrimary(depth);
  };

  const parseTerm = (depth: number): FormulaAst | null => {
    if (!descend(depth)) return null;
    let left = parseUnary(depth);
    if (!left) return null;
    while (peek()?.kind === "op") {
      const op = peek();
      if (op?.kind !== "op" || (op.op !== "*" && op.op !== "/")) break;
      take();
      const right = parseUnary(depth);
      if (!right) return null;
      left = { type: "binary", op: op.op, left, right };
    }
    return left;
  };

  const parseExpr = (depth: number): FormulaAst | null => {
    if (!descend(depth)) return null;
    let left = parseTerm(depth);
    if (!left) return null;
    while (peek()?.kind === "op") {
      const op = peek();
      if (op?.kind !== "op" || (op.op !== "+" && op.op !== "-")) break;
      take();
      const right = parseTerm(depth);
      if (!right) return null;
      left = { type: "binary", op: op.op, left, right };
    }
    return left;
  };

  if (tokens.length === 0) return { ok: false, error: INVALID };
  const ast = parseExpr(0);
  if (overflow) return { ok: false, error: TOO_DEEP };
  if (!ast) {
    if (unbalancedParens()) return { ok: false, error: MISSING_PAREN };
    return { ok: false, error: INVALID };
  }
  if (pos !== tokens.length) {
    if (unbalancedParens()) return { ok: false, error: MISSING_PAREN };
    return { ok: false, error: INVALID };
  }
  return { ok: true, ast };
}

export function parseCellFormula(raw: string): FormulaParseResult {
  const text = raw.trim();
  if (!text.startsWith("=")) return { ok: false, error: INVALID };
  const body = text.slice(1);
  if (!body.trim()) return { ok: false, error: INVALID };
  const tokens = tokenizeCellFormula(body);
  if (typeof tokens === "string") return { ok: false, error: tokens };
  return parseTokens(tokens);
}

export function evaluateCellFormula(
  ast: FormulaAst,
  env: FormulaResolveEnv,
  depth = 0,
): FormulaEvalResult {
  if (depth > MAX_FORMULA_DEPTH) return { ok: false, error: TOO_DEEP };

  if (ast.type === "number") return { ok: true, value: ast.value };
  if (ast.type === "mar") return env.resolveMar(ast.expr, ast.year);
  if (ast.type === "ratio") return env.resolveRatio(ast.id);

  if (ast.type === "unary") {
    const inner = evaluateCellFormula(ast.arg, env, depth + 1);
    if (!inner.ok) return inner;
    const value = ast.op === "-" ? -inner.value : inner.value;
    if (!Number.isFinite(value)) {
      return { ok: false, error: "Geen geldig resultaat" };
    }
    return { ok: true, value };
  }

  const left = evaluateCellFormula(ast.left, env, depth + 1);
  if (!left.ok) return left;
  const right = evaluateCellFormula(ast.right, env, depth + 1);
  if (!right.ok) return right;

  if (ast.op === "/" && right.value === 0) {
    return { ok: false, error: "Delen door nul" };
  }

  let value: number;
  switch (ast.op) {
    case "+":
      value = left.value + right.value;
      break;
    case "-":
      value = left.value - right.value;
      break;
    case "*":
      value = left.value * right.value;
      break;
    case "/":
      value = left.value / right.value;
      break;
  }

  if (!Number.isFinite(value)) {
    return { ok: false, error: "Geen geldig resultaat" };
  }
  return { ok: true, value };
}
