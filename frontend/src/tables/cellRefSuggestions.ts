import { MAR_LABELS, nbbGlossaryLabel } from "../i18n/marLabels";
import type { RatioSpec, TableColumn } from "../types";

export interface CellRefSuggestion {
  insert: string;
  label: string;
  detail?: string;
  kind: "mar" | "ratio" | "cell" | "pct";
  replaceStart: number;
  replaceEnd: number;
}

export interface RefSuggestContext {
  type: "mar" | "ratio" | "cell" | "pct" | "formula";
  query: string;
  replaceStart: number;
  replaceEnd: number;
}

const MAR_CODES = Object.keys(MAR_LABELS).sort();

const REF_PREFIX =
  /^(mar\.(?:current|previous|prev|boekjaar|vorig):|mar:|@|ratio:|ratio\/)/i;

function isCodeColumn(column: TableColumn, index: number): boolean {
  const key = `${column.id} ${column.label}`.toLowerCase();
  return key.includes("code") || index === 0;
}

function amountColumns(columns: TableColumn[]): TableColumn[] {
  return columns.filter((column, index) => !isCodeColumn(column, index));
}

function isWs(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

/** Last operand fragment inside an `=` formula (not `/` inside a MAR code). */
export function formulaOperandFragment(
  value: string,
): { start: number; end: number; text: string } | null {
  if (!value.startsWith("=")) return null;
  let i = 1;
  let start = 1;
  let end = 1;

  const skipWs = () => {
    while (i < value.length && isWs(value[i]!)) i++;
  };

  skipWs();
  start = i;
  end = i;

  while (i < value.length) {
    skipWs();
    if (i >= value.length) {
      start = i;
      end = i;
      break;
    }

    const rest = value.slice(i);
    const prefix = REF_PREFIX.exec(rest);
    if (prefix) {
      start = i;
      i += prefix[0].length;
      const isRatio = prefix[0].toLowerCase().startsWith("ratio");
      if (isRatio) {
        while (i < value.length && /[A-Za-z0-9_]/.test(value[i]!)) i++;
      } else {
        while (i < value.length && /[0-9A-Za-z/]/.test(value[i]!)) i++;
      }
      end = i;
      continue;
    }

    if (
      /[0-9]/.test(value[i]!) ||
      (value[i] === "." && /[0-9]/.test(value[i + 1] ?? ""))
    ) {
      start = i;
      i++;
      while (i < value.length && /[0-9.]/.test(value[i]!)) i++;
      end = i;
      continue;
    }

    const ch = value[i]!;
    if ("+-*/()".includes(ch)) {
      i++;
      if (ch === ")") continue;
      skipWs();
      start = i;
      end = i;
      continue;
    }

    start = i;
    const begin = i;
    while (i < value.length && /[A-Za-z0-9_.:]/.test(value[i]!)) i++;
    if (i === begin) i++;
    end = i;
  }

  return { start, end, text: value.slice(start, end) };
}

function detectDirectRefContext(
  value: string,
  replaceStart: number,
  replaceEnd: number,
): RefSuggestContext | null {
  const mar = /^(mar\.(?:current|previous|prev|boekjaar|vorig):|mar:|@)(.*)$/i.exec(
    value,
  );
  if (mar) {
    return { type: "mar", query: mar[2], replaceStart, replaceEnd };
  }

  const ratio = /^(?:ratio:|ratio\/)(.*)$/i.exec(value);
  if (ratio) {
    return { type: "ratio", query: ratio[1], replaceStart, replaceEnd };
  }

  const cell = /^cell:(.*)$/i.exec(value);
  if (cell) {
    return { type: "cell", query: cell[1], replaceStart, replaceEnd };
  }

  const pct = /^pct:(.*)$/i.exec(value);
  if (pct) {
    return { type: "pct", query: pct[1], replaceStart, replaceEnd };
  }

  return null;
}

/** Detect whether the caret is in a ref prefix the user is still typing. */
export function detectRefContext(value: string): RefSuggestContext | null {
  const fragment = formulaOperandFragment(value);
  if (fragment) {
    const direct = detectDirectRefContext(
      fragment.text,
      fragment.start,
      fragment.end,
    );
    if (direct) return direct;
    return {
      type: "formula",
      query: fragment.text,
      replaceStart: fragment.start,
      replaceEnd: fragment.end,
    };
  }

  return detectDirectRefContext(value, 0, value.length);
}

function matchQuery(haystack: string, query: string): boolean {
  if (!query) return true;
  return haystack.toLowerCase().includes(query.toLowerCase());
}

function matchRank(haystack: string, query: string): number {
  if (!query) return 1;
  const value = haystack.toLowerCase();
  const q = query.toLowerCase();
  if (value === q) return 0;
  if (value.startsWith(q)) return 1;
  if (value.includes(q)) return 2;
  return 3;
}

function marPrefixOf(value: string): string {
  return (
    value.match(/^(mar\.(?:current|previous|prev|boekjaar|vorig):|mar:|@)/i)?.[0] ??
    "mar:"
  );
}

function marSuggestions(
  prefixSource: string,
  query: string,
  replaceStart: number,
  replaceEnd: number,
  limit: number,
): CellRefSuggestion[] {
  const prefix = marPrefixOf(prefixSource || "mar:");
  return MAR_CODES.filter((code) => {
    if (matchQuery(code, query)) return true;
    const label = nbbGlossaryLabel(code);
    return label ? matchQuery(label, query) : false;
  })
    .sort((a, b) => {
      const rank = matchRank(a, query) - matchRank(b, query);
      return rank !== 0 ? rank : a.localeCompare(b);
    })
    .slice(0, limit)
    .map((code) => {
      const insert =
        prefix.toLowerCase().startsWith("mar.") || prefix === "@"
          ? `${prefix}${code}`
          : `mar:${code}`;
      return {
        insert,
        label: code,
        detail: nbbGlossaryLabel(code) ?? undefined,
        kind: "mar" as const,
        replaceStart,
        replaceEnd,
      };
    });
}

function ratioSuggestions(
  query: string,
  ratioSpecs: RatioSpec[],
  replaceStart: number,
  replaceEnd: number,
  limit: number,
): CellRefSuggestion[] {
  const q = query.trim().toLowerCase();
  return ratioSpecs
    .filter(
      (spec) =>
        matchQuery(spec.id, q) ||
        matchQuery(spec.name, q) ||
        matchQuery(spec.category, q),
    )
    .sort((a, b) => {
      const rank = matchRank(a.id, q) - matchRank(b.id, q);
      return rank !== 0 ? rank : a.id.localeCompare(b.id);
    })
    .slice(0, limit)
    .map((spec) => ({
      insert: `ratio:${spec.id}`,
      label: spec.id,
      detail: spec.name,
      kind: "ratio" as const,
      replaceStart,
      replaceEnd,
    }));
}

export function applyCellRefSuggestion(
  value: string,
  suggestion: CellRefSuggestion,
): string {
  return (
    value.slice(0, suggestion.replaceStart) +
    suggestion.insert +
    value.slice(suggestion.replaceEnd)
  );
}

export function getCellRefSuggestions(
  value: string,
  columns: TableColumn[],
  ratioSpecs: RatioSpec[],
): CellRefSuggestion[] {
  const ctx = detectRefContext(value);
  if (!ctx) return [];

  const limit = 12;
  const { replaceStart, replaceEnd } = ctx;

  if (ctx.type === "formula") {
    const typed = ctx.query.trim();
    const looksRatio = /^(r|ra|rat|rati|ratio)$/i.test(typed);
    if (looksRatio) {
      return ratioSuggestions("", ratioSpecs, replaceStart, replaceEnd, limit);
    }
    if (!typed) {
      const mar = marSuggestions("mar:", "", replaceStart, replaceEnd, 8);
      const ratios = ratioSuggestions("", ratioSpecs, replaceStart, replaceEnd, 4);
      return [...mar, ...ratios];
    }
    const mar = marSuggestions("mar:", typed, replaceStart, replaceEnd, limit);
    const ratios = ratioSuggestions(typed, ratioSpecs, replaceStart, replaceEnd, limit);
    return [...mar, ...ratios].slice(0, limit);
  }

  if (ctx.type === "mar") {
    const prefixSource = value.slice(replaceStart, replaceEnd);
    return marSuggestions(
      prefixSource,
      ctx.query.trim(),
      replaceStart,
      replaceEnd,
      limit,
    );
  }

  if (ctx.type === "ratio") {
    return ratioSuggestions(
      ctx.query,
      ratioSpecs,
      replaceStart,
      replaceEnd,
      limit,
    );
  }

  if (ctx.type === "cell") {
    const q = ctx.query.trim().toLowerCase();
    return columns
      .filter(
        (column) => matchQuery(column.id, q) || matchQuery(column.label, q),
      )
      .slice(0, limit)
      .map((column) => ({
        insert: `cell:${column.id}`,
        label: column.id,
        detail: column.label || undefined,
        kind: "cell" as const,
        replaceStart,
        replaceEnd,
      }));
  }

  const q = ctx.query.trim().toLowerCase();
  const amounts = amountColumns(columns);
  const pairs: CellRefSuggestion[] = [];
  for (const from of amounts) {
    for (const to of amounts) {
      if (from.id === to.id) continue;
      const insert = `pct:${from.id},${to.id}`;
      const label = `${from.label || from.id} → ${to.label || to.id}`;
      if (!q || matchQuery(insert, q) || matchQuery(label, q)) {
        pairs.push({
          insert,
          label,
          detail: "% verschil",
          kind: "pct",
          replaceStart,
          replaceEnd,
        });
      }
    }
  }
  return pairs.slice(0, limit);
}
