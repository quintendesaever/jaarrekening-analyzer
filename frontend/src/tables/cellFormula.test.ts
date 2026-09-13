import { describe, expect, it } from "vitest";
import {
  evaluateCellFormula,
  parseCellFormula,
  tokenizeCellFormula,
} from "./cellFormula";
import type { FormulaYear } from "./cellFormula";

const amounts: Record<string, { current: number; previous: number }> = {
  "29/58": { current: 400, previous: 200 },
  "70": { current: 1000, previous: 800 },
  "60": { current: 300, previous: 250 },
  "66A": { current: 50, previous: 40 },
  "60/66A": { current: 350, previous: 290 },
};

const ratios: Record<string, number> = {
  current_ratio: 1.5,
};

function evalFormula(source: string, year: FormulaYear = "current") {
  const parsed = parseCellFormula(source);
  if (!parsed.ok) return parsed;
  return evaluateCellFormula(parsed.ast, {
    resolveMar(expr, refYear) {
      const resolved = refYear === "auto" ? year : refYear;
      const row = amounts[expr];
      if (!row) return { ok: false, error: `Ontbrekende MAR-code(s): ${expr}` };
      return { ok: true, value: row[resolved] };
    },
    resolveRatio(id) {
      const value = ratios[id];
      if (value === undefined) {
        return { ok: false, error: `Onbekende ratio-id: ${id}` };
      }
      return { ok: true, value };
    },
  });
}

describe("tokenizeCellFormula", () => {
  it("keeps slash MAR codes as one token before division", () => {
    const tokens = tokenizeCellFormula("mar:29/58 / 2");
    expect(tokens).toEqual([
      { kind: "mar", expr: "29/58", year: "auto" },
      { kind: "op", op: "/" },
      { kind: "number", value: 2 },
    ]);
  });

  it("tokenizes explicit year aliases", () => {
    const tokens = tokenizeCellFormula("mar.boekjaar:70 - mar.vorig:70");
    expect(tokens).toEqual([
      { kind: "mar", expr: "70", year: "current" },
      { kind: "op", op: "-" },
      { kind: "mar", expr: "70", year: "previous" },
    ]);
  });
});

describe("parseCellFormula", () => {
  it("rejects empty and malformed formulas", () => {
    expect(parseCellFormula("=").ok).toBe(false);
    expect(parseCellFormula("=   ").ok).toBe(false);
    expect(parseCellFormula("=mar:").ok).toBe(false);
    expect(parseCellFormula("=1+").ok).toBe(false);
    expect(parseCellFormula("=foo").ok).toBe(false);
    expect(parseCellFormula("1+2").ok).toBe(false);
  });

  it("reports missing parentheses", () => {
    const parsed = parseCellFormula("=(1+2");
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toBe("Ontbrekende haakje(s)");
  });

  it("rejects excessive nesting", () => {
    const nested = `=${"(".repeat(20)}1${")".repeat(20)}`;
    const parsed = parseCellFormula(nested);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toBe("Te diepe formule");
  });
});

describe("evaluateCellFormula", () => {
  it("applies operator precedence", () => {
    expect(evalFormula("=2 + 3 * 4")).toEqual({ ok: true, value: 14 });
    expect(evalFormula("=10 - 6 / 2")).toEqual({ ok: true, value: 7 });
  });

  it("respects parentheses", () => {
    expect(evalFormula("=(2 + 3) * 4")).toEqual({ ok: true, value: 20 });
  });

  it("supports unary plus and minus", () => {
    expect(evalFormula("=-100 + 40")).toEqual({ ok: true, value: -60 });
    expect(evalFormula("=+5")).toEqual({ ok: true, value: 5 });
    expect(evalFormula("=-(2 + 3)")).toEqual({ ok: true, value: -5 });
    expect(evalFormula("=10 - -5")).toEqual({ ok: true, value: 15 });
  });

  it("divides slash MAR codes without treating the code slash as division", () => {
    expect(evalFormula("=mar:29/58 / 2")).toEqual({ ok: true, value: 200 });
  });

  it("subtracts MAR refs including slash codes", () => {
    expect(evalFormula("=mar:70 - mar:60/66A")).toEqual({ ok: true, value: 650 });
  });

  it("adds a number to a MAR ref", () => {
    expect(evalFormula("=mar:29/58 + 1000")).toEqual({ ok: true, value: 1400 });
  });

  it("multiplies a ratio", () => {
    expect(evalFormula("=ratio:current_ratio * 100")).toEqual({
      ok: true,
      value: 150,
    });
  });

  it("uses auto year from the destination column", () => {
    expect(evalFormula("=mar:70", "previous")).toEqual({ ok: true, value: 800 });
    expect(evalFormula("=mar:70", "current")).toEqual({ ok: true, value: 1000 });
  });

  it("uses explicit year aliases", () => {
    expect(
      evalFormula("=(mar.boekjaar:70 - mar.vorig:70) / mar.vorig:70 * 100"),
    ).toEqual({ ok: true, value: 25 });
  });

  it("supports decimal literals and mixed numbers", () => {
    expect(evalFormula("=1.5 * 2")).toEqual({ ok: true, value: 3 });
    expect(evalFormula("=2,5 + 0.5")).toEqual({ ok: true, value: 3 });
    expect(evalFormula("=-100 + mar:70")).toEqual({ ok: true, value: 900 });
  });

  it("reports missing MAR codes and unknown ratios", () => {
    expect(evalFormula("=mar:999")).toEqual({
      ok: false,
      error: "Ontbrekende MAR-code(s): 999",
    });
    expect(evalFormula("=ratio:missing_id")).toEqual({
      ok: false,
      error: "Onbekende ratio-id: missing_id",
    });
  });

  it("reports division by zero and non-finite results", () => {
    expect(evalFormula("=1 / 0")).toEqual({
      ok: false,
      error: "Delen door nul",
    });
    expect(evalFormula("=0 / 0")).toEqual({
      ok: false,
      error: "Delen door nul",
    });
  });
});
