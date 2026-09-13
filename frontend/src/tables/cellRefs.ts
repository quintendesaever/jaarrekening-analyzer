import type {
  AmountFormat,
  AnalysisResult,
  RatioResult,
  StatementLine,
  TableColumn,
  TableRow,
} from "../types";
import {
  formatAmount,
  formatCalcResult,
  formatRatio,
  formatSignedPercent,
} from "../utils/format";
import {
  evaluateCellFormula,
  parseCellFormula,
  type FormulaResolveEnv,
} from "./cellFormula";

export type CellYear = "current" | "previous";

export type ParsedCellRef =
  | { kind: "literal"; text: string }
  | { kind: "calc"; source: string }
  | { kind: "mar"; expr: string; year: CellYear | "auto" }
  | { kind: "ratio"; id: string }
  | { kind: "cell"; columnRef: string }
  | { kind: "pct"; fromRef: string; toRef: string };

export interface ResolvedCell {
  text: string;
  title?: string;
  isRef: boolean;
  missing: boolean;
}

export interface CellResolveContext {
  row: TableRow;
  columns: TableColumn[];
  cellIndex: number;
  column: TableColumn;
  result: AnalysisResult | null | undefined;
  amountFormat?: AmountFormat;
}

const CODE_ALIASES: Record<string, readonly string[]> = {
  "70/76A": ["70"],
};

const MAX_RESOLVE_DEPTH = 12;

function allStatementLines(result: AnalysisResult): StatementLine[] {
  return [
    ...result.balance_assets,
    ...result.balance_liabilities,
    ...result.income_statement,
    ...(result.appropriation_of_result ?? []),
  ];
}

function buildAmountMaps(lines: StatementLine[]): {
  current: Map<string, number>;
  previous: Map<string, number>;
} {
  const current = new Map<string, number>();
  const previous = new Map<string, number>();
  for (const line of lines) {
    const code = line.code.trim();
    if (!code) continue;
    if (line.current !== null) current.set(code, line.current);
    if (line.previous !== null) previous.set(code, line.previous);
  }
  return { current, previous };
}

function lookupCode(
  maps: { current: Map<string, number>; previous: Map<string, number> },
  code: string,
  year: CellYear,
): number | null {
  const store = year === "current" ? maps.current : maps.previous;
  if (store.has(code)) return store.get(code) ?? null;
  for (const alias of CODE_ALIASES[code] ?? []) {
    if (store.has(alias)) return store.get(alias) ?? null;
  }
  return null;
}

export function evaluateMarExpr(
  expr: string,
  maps: { current: Map<string, number>; previous: Map<string, number> },
  year: CellYear,
): { value: number | null; missing: string[] } {
  const trimmed = expr.trim();
  if (!trimmed) return { value: null, missing: [] };

  if (!trimmed.includes("+") && !trimmed.includes("-")) {
    const value = lookupCode(maps, trimmed, year);
    return value === null ? { value: null, missing: [trimmed] } : { value, missing: [] };
  }

  const parts = trimmed.split(/\s*([+-])\s*/);
  if (!parts.length || !parts[0]?.trim()) {
    return { value: null, missing: [trimmed] };
  }

  const first = lookupCode(maps, parts[0].trim(), year);
  if (first === null) return { value: null, missing: [parts[0].trim()] };

  let total = first;
  for (let i = 1; i < parts.length; i += 2) {
    const op = parts[i];
    const token = parts[i + 1]?.trim() ?? "";
    if (!token) return { value: null, missing: [trimmed] };
    const value = lookupCode(maps, token, year);
    if (value === null) return { value: null, missing: [token] };
    total = op === "+" ? total + value : total - value;
  }
  return { value: total, missing: [] };
}

export function defaultYearForColumn(column: TableColumn): CellYear {
  const key = `${column.id} ${column.label}`.toLowerCase();
  if (
    key.includes("vorig") ||
    key.includes("previous") ||
    key.includes("prev")
  ) {
    return "previous";
  }
  return "current";
}

function yearFromToken(token: string): CellYear | "auto" {
  const value = token.toLowerCase();
  if (value === "previous" || value === "prev" || value === "vorig") {
    return "previous";
  }
  if (value === "current" || value === "boekjaar") {
    return "current";
  }
  return "auto";
}

export function parseCellRef(raw: string): ParsedCellRef {
  const text = raw.trim();
  if (!text) return { kind: "literal", text: "" };

  if (text.startsWith("=")) {
    return { kind: "calc", source: text };
  }

  const pctMatch = /^pct:([^,]+),([^,]+)$/i.exec(text);
  if (pctMatch) {
    return {
      kind: "pct",
      fromRef: pctMatch[1].trim(),
      toRef: pctMatch[2].trim(),
    };
  }

  const cellMatch = /^cell:(.+)$/i.exec(text);
  if (cellMatch) {
    return { kind: "cell", columnRef: cellMatch[1].trim() };
  }

  const ratioMatch = /^(?:ratio:|ratio\/)(.+)$/i.exec(text);
  if (ratioMatch) {
    return { kind: "ratio", id: ratioMatch[1].trim() };
  }

  const marYear = /^mar\.(current|previous|prev|boekjaar|vorig):(.+)$/i.exec(text);
  if (marYear) {
    return {
      kind: "mar",
      expr: marYear[2].trim(),
      year: yearFromToken(marYear[1]),
    };
  }

  const atYear = /^@(current|previous|prev):(.+)$/i.exec(text);
  if (atYear) {
    return {
      kind: "mar",
      expr: atYear[2].trim(),
      year: yearFromToken(atYear[1]),
    };
  }

  const marSimple = /^mar:(.+)$/i.exec(text);
  if (marSimple) {
    return { kind: "mar", expr: marSimple[1].trim(), year: "auto" };
  }

  const atSimple = /^@(.+)$/i.exec(text);
  if (atSimple) {
    return { kind: "mar", expr: atSimple[1].trim(), year: "auto" };
  }

  return { kind: "literal", text: raw };
}

export function isCellRef(raw: string): boolean {
  return parseCellRef(raw).kind !== "literal";
}

export function cellRefKind(
  raw: string,
): "mar" | "ratio" | "cell" | "pct" | "calc" | null {
  const parsed = parseCellRef(raw);
  if (parsed.kind === "literal") return null;
  return parsed.kind;
}

function findColumnIndex(columns: TableColumn[], ref: string): number {
  const needle = ref.trim().toLowerCase();
  return columns.findIndex(
    (column) =>
      column.id.toLowerCase() === needle ||
      column.label.trim().toLowerCase() === needle,
  );
}

function findRatio(
  ratios: RatioResult[] | undefined,
  id: string,
): RatioResult | undefined {
  const needle = id.trim().toLowerCase();
  return ratios?.find((ratio) => ratio.id.toLowerCase() === needle);
}

interface NumericResult {
  value: number | null;
  missing: boolean;
  title?: string;
}

function resolveColumnRef(
  columnRef: string,
  context: CellResolveContext,
  depth: number,
  visiting: Set<number>,
): NumericResult {
  const targetIndex = findColumnIndex(context.columns, columnRef);
  if (targetIndex < 0) {
    return {
      value: null,
      missing: true,
      title: `Onbekende kolom: ${columnRef}`,
    };
  }
  if (visiting.has(targetIndex)) {
    return { value: null, missing: true, title: "Circulaire celverwijzing" };
  }
  const raw = context.row.cells[targetIndex] ?? "";
  return resolveCellNumeric(
    raw,
    {
      ...context,
      cellIndex: targetIndex,
      column: context.columns[targetIndex],
    },
    depth + 1,
    visiting,
  );
}

function formulaEnv(context: CellResolveContext): FormulaResolveEnv {
  return {
    resolveMar(expr, year) {
      if (!context.result) {
        return {
          ok: false,
          error: "Analyseer eerst een PDF om deze verwijzing te berekenen.",
        };
      }
      const resolvedYear =
        year === "auto" ? defaultYearForColumn(context.column) : year;
      const maps = buildAmountMaps(allStatementLines(context.result));
      const { value, missing } = evaluateMarExpr(expr, maps, resolvedYear);
      if (value === null) {
        return {
          ok: false,
          error: missing.length
            ? `Ontbrekende MAR-code(s): ${missing.join(", ")}`
            : `Geen bedrag voor ${expr}`,
        };
      }
      return { ok: true, value };
    },
    resolveRatio(id) {
      if (!context.result) {
        return {
          ok: false,
          error: "Analyseer eerst een PDF om deze verwijzing te berekenen.",
        };
      }
      const ratio = findRatio(context.result.ratios, id);
      if (!ratio) {
        return { ok: false, error: `Onbekende ratio-id: ${id}` };
      }
      if (ratio.value === null) {
        return {
          ok: false,
          error: ratio.missing_codes.length
            ? `Ratio ${ratio.id}: ontbrekende codes ${ratio.missing_codes.join(", ")}`
            : `Ratio ${ratio.id}: geen waarde`,
        };
      }
      return { ok: true, value: ratio.value };
    },
  };
}

function resolveFormula(raw: string, context: CellResolveContext): NumericResult {
  const parsed = parseCellFormula(raw);
  if (!parsed.ok) {
    return { value: null, missing: true, title: parsed.error };
  }
  const evaluated = evaluateCellFormula(parsed.ast, formulaEnv(context));
  if (!evaluated.ok) {
    return { value: null, missing: true, title: evaluated.error };
  }
  return { value: evaluated.value, missing: false, title: raw.trim() };
}

function resolveCellNumeric(
  raw: string,
  context: CellResolveContext,
  depth = 0,
  visiting = new Set<number>(),
): NumericResult {
  if (depth > MAX_RESOLVE_DEPTH) {
    return { value: null, missing: true, title: "Te diepe verwijzing" };
  }

  const parsed = parseCellRef(raw);

  if (parsed.kind === "calc") {
    return resolveFormula(raw, context);
  }

  if (parsed.kind === "literal") {
    const num = Number(raw.trim().replace(/\s/g, "").replace(",", "."));
    if (!Number.isNaN(num) && raw.trim() !== "") {
      return { value: num, missing: false };
    }
    return { value: null, missing: false };
  }

  if (!context.result) {
    return {
      value: null,
      missing: true,
      title: "Analyseer eerst een PDF om deze verwijzing te berekenen.",
    };
  }

  if (parsed.kind === "ratio") {
    const ratio = findRatio(context.result.ratios, parsed.id);
    if (!ratio) {
      return {
        value: null,
        missing: true,
        title: `Onbekende ratio-id: ${parsed.id}`,
      };
    }
    if (ratio.value === null) {
      return {
        value: null,
        missing: true,
        title: ratio.missing_codes.length
          ? `Ratio ${ratio.id}: ontbrekende codes ${ratio.missing_codes.join(", ")}`
          : `Ratio ${ratio.id}: geen waarde`,
      };
    }
    return { value: ratio.value, missing: false, title: ratio.name };
  }

  if (parsed.kind === "cell") {
    visiting.add(context.cellIndex);
    const result = resolveColumnRef(parsed.columnRef, context, depth, visiting);
    visiting.delete(context.cellIndex);
    return result;
  }

  if (parsed.kind === "pct") {
    visiting.add(context.cellIndex);
    const from = resolveColumnRef(parsed.fromRef, context, depth, visiting);
    const to = resolveColumnRef(parsed.toRef, context, depth, visiting);
    visiting.delete(context.cellIndex);
    if (from.missing || to.missing || from.value === null || to.value === null) {
      return {
        value: null,
        missing: true,
        title: from.title ?? to.title ?? "Kon percentage niet berekenen",
      };
    }
    if (from.value === 0) {
      return {
        value: null,
        missing: true,
        title: "Delen door nul (basisbedrag is 0)",
      };
    }
    const pct = ((to.value - from.value) / Math.abs(from.value)) * 100;
    return {
      value: pct,
      missing: false,
      title: `${parsed.fromRef} → ${parsed.toRef}`,
    };
  }

  const year =
    parsed.year === "auto"
      ? defaultYearForColumn(context.column)
      : parsed.year;
  const maps = buildAmountMaps(allStatementLines(context.result));
  const { value, missing } = evaluateMarExpr(parsed.expr, maps, year);
  if (value === null) {
    return {
      value: null,
      missing: true,
      title: missing.length
        ? `Ontbrekende MAR-code(s): ${missing.join(", ")}`
        : `Geen bedrag voor ${parsed.expr}`,
    };
  }
  return {
    value,
    missing: false,
    title: `${parsed.expr} (${year === "current" ? "boekjaar" : "vorig"})`,
  };
}

export function resolveCellValue(
  raw: string,
  context: CellResolveContext,
): ResolvedCell {
  const parsed = parseCellRef(raw);
  const amountFormat = context.amountFormat ?? "full";

  if (parsed.kind === "literal") {
    return { text: raw, isRef: false, missing: false };
  }

  if (parsed.kind === "calc") {
    const numeric = resolveFormula(raw, context);
    if (numeric.value === null) {
      return {
        text: "—",
        title: numeric.title,
        isRef: true,
        missing: true,
      };
    }
    return {
      text: formatCalcResult(numeric.value, amountFormat),
      title: numeric.title,
      isRef: true,
      missing: false,
    };
  }

  if (!context.result) {
    return {
      text: raw.trim(),
      title: "Analyseer eerst een PDF om deze verwijzing te berekenen.",
      isRef: true,
      missing: true,
    };
  }

  if (parsed.kind === "ratio") {
    const ratio = findRatio(context.result.ratios, parsed.id);
    if (!ratio) {
      return {
        text: "—",
        title: `Onbekende ratio-id: ${parsed.id}`,
        isRef: true,
        missing: true,
      };
    }
    if (ratio.value === null) {
      return {
        text: "—",
        title: ratio.missing_codes.length
          ? `Ratio ${ratio.id}: ontbrekende codes ${ratio.missing_codes.join(", ")}`
          : `Ratio ${ratio.id}: geen waarde`,
        isRef: true,
        missing: true,
      };
    }
    return {
      text: formatRatio(ratio.value, ratio.unit),
      title: `${ratio.name} (${ratio.id})`,
      isRef: true,
      missing: false,
    };
  }

  if (parsed.kind === "pct") {
    const numeric = resolveCellNumeric(raw, context);
    if (numeric.value === null) {
      return {
        text: "—",
        title: numeric.title,
        isRef: true,
        missing: numeric.missing,
      };
    }
    return {
      text: formatSignedPercent(numeric.value),
      title: numeric.title,
      isRef: true,
      missing: false,
    };
  }

  if (parsed.kind === "cell") {
    const numeric = resolveCellNumeric(raw, context);
    if (numeric.value === null) {
      return {
        text: "—",
        title: numeric.title,
        isRef: true,
        missing: numeric.missing,
      };
    }
    return {
      text: formatAmount(numeric.value, amountFormat),
      title: numeric.title ?? `cell:${parsed.columnRef}`,
      isRef: true,
      missing: false,
    };
  }

  const year =
    parsed.year === "auto"
      ? defaultYearForColumn(context.column)
      : parsed.year;
  const maps = buildAmountMaps(allStatementLines(context.result));
  const { value, missing } = evaluateMarExpr(parsed.expr, maps, year);
  if (value === null) {
    return {
      text: "—",
      title: missing.length
        ? `Ontbrekende MAR-code(s): ${missing.join(", ")}`
        : `Geen bedrag voor ${parsed.expr}`,
      isRef: true,
      missing: true,
    };
  }
  return {
    text: formatAmount(value, amountFormat),
    title: `${parsed.expr} (${year === "current" ? "boekjaar" : "vorig"})`,
    isRef: true,
    missing: false,
  };
}
