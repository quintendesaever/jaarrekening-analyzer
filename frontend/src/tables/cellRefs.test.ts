import { describe, expect, it } from "vitest";
import type { AnalysisResult, TableColumn, TableRow } from "../types";
import {
  cellRefKind,
  parseCellRef,
  resolveCellValue,
  type CellResolveContext,
} from "./cellRefs";

function line(code: string, current: number | null, previous: number | null) {
  return {
    section: "income_statement",
    label: code,
    footnote: "",
    code,
    current,
    previous,
  };
}

function analysis(): AnalysisResult {
  return {
    schema_format: "VOL-kap",
    company_name: "Test",
    balance_assets: [line("29/58", 400, 200)],
    balance_liabilities: [],
    income_statement: [
      line("70", 1000, 800),
      line("60", 300, 250),
      line("66A", 50, 40),
      line("60/66A", 350, 290),
    ],
    appropriation_of_result: [],
    ratios: [
      {
        id: "current_ratio",
        name: "Current ratio",
        category: "liquiditeit",
        value: 1.5,
        unit: "x",
        formula: "29/58 / 17/49",
        missing_codes: [],
      },
    ],
    balance_structure: [],
    income_structure: [],
    warnings: [],
    validations: [],
  };
}

function context(
  column: TableColumn,
  rawCells: string[] = [""],
): CellResolveContext {
  const columns: TableColumn[] = [
    { id: "boekjaar", label: "Boekjaar" },
    { id: "vorig", label: "Vorig" },
  ];
  const row: TableRow = {
    id: "r1",
    label: "Rij",
    cells: rawCells.length >= 2 ? rawCells : [rawCells[0] ?? "", ""],
  };
  const index = columns.findIndex((item) => item.id === column.id);
  return {
    row,
    columns,
    cellIndex: index < 0 ? 0 : index,
    column,
    result: analysis(),
    amountFormat: "full",
  };
}

describe("parseCellRef", () => {
  it("keeps existing direct forms", () => {
    expect(parseCellRef("mar:29/58")).toMatchObject({
      kind: "mar",
      expr: "29/58",
      year: "auto",
    });
    expect(parseCellRef("mar.vorig:70")).toMatchObject({
      kind: "mar",
      expr: "70",
      year: "previous",
    });
    expect(parseCellRef("ratio:current_ratio")).toMatchObject({
      kind: "ratio",
      id: "current_ratio",
    });
    expect(parseCellRef("cell:boekjaar")).toMatchObject({
      kind: "cell",
      columnRef: "boekjaar",
    });
    expect(parseCellRef("pct:vorig,boekjaar")).toMatchObject({
      kind: "pct",
      fromRef: "vorig",
      toRef: "boekjaar",
    });
  });

  it("treats equals-prefixed input as a calculation", () => {
    expect(parseCellRef("=mar:70 / 2")).toEqual({
      kind: "calc",
      source: "=mar:70 / 2",
    });
    expect(cellRefKind("=1+2")).toBe("calc");
  });
});

describe("resolveCellValue", () => {
  const boekjaar = { id: "boekjaar", label: "Boekjaar" };
  const vorig = { id: "vorig", label: "Vorig" };

  it("still evaluates direct MAR plus/minus expressions", () => {
    const resolved = resolveCellValue("mar:70-60", context(boekjaar));
    expect(resolved.missing).toBe(false);
    expect(resolved.text).toBe("700");
  });

  it("resolves auto year from the destination column", () => {
    expect(resolveCellValue("=mar:70", context(boekjaar)).text).toBe("1.000");
    expect(resolveCellValue("=mar:70", context(vorig)).text).toBe("800");
  });

  it("formats successful calculations and keeps division decimals", () => {
    const half = resolveCellValue("=mar:29/58 / 2", context(boekjaar));
    expect(half.missing).toBe(false);
    expect(half.text).toBe("200");

    const ratioPct = resolveCellValue(
      "=ratio:current_ratio * 100",
      context(boekjaar),
    );
    expect(ratioPct.text).toBe("150");

    const change = resolveCellValue(
      "=(mar.boekjaar:70 - mar.vorig:70) / mar.vorig:70 * 100",
      context(boekjaar),
    );
    expect(change.missing).toBe(false);
    expect(change.text).toBe("25");

    const fraction = resolveCellValue("=10 / 4", context(boekjaar));
    expect(fraction.missing).toBe(false);
    expect(fraction.text).toBe("2,5");
  });

  it("renders failed calculations as an em dash with a tooltip", () => {
    const missing = resolveCellValue("=mar:999", context(boekjaar));
    expect(missing).toMatchObject({
      text: "—",
      missing: true,
      title: "Ontbrekende MAR-code(s): 999",
    });

    const zero = resolveCellValue("=mar:70 / 0", context(boekjaar));
    expect(zero).toMatchObject({
      text: "—",
      missing: true,
      title: "Delen door nul",
    });

    const bad = resolveCellValue("=1+", context(boekjaar));
    expect(bad.text).toBe("—");
    expect(bad.missing).toBe(true);
    expect(bad.title).toBe("Ongeldige formule");
  });

  it("evaluates number-only formulas without analysis data", () => {
    const ctx = context(boekjaar);
    ctx.result = null;
    const resolved = resolveCellValue("=2 * (3 + 1)", ctx);
    expect(resolved.missing).toBe(false);
    expect(resolved.text).toBe("8");
  });
});
