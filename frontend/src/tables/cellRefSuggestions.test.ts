import { describe, expect, it } from "vitest";
import type { RatioSpec, TableColumn } from "../types";
import {
  applyCellRefSuggestion,
  detectRefContext,
  formulaOperandFragment,
  getCellRefSuggestions,
} from "./cellRefSuggestions";

const columns: TableColumn[] = [
  { id: "boekjaar", label: "Boekjaar" },
  { id: "vorig", label: "Vorig" },
];

const ratioSpecs: RatioSpec[] = [
  {
    id: "current_ratio",
    name: "Current ratio",
    category: "liquiditeit",
    numerator: "29/58",
  },
];

describe("formulaOperandFragment", () => {
  it("starts a new operand after =, operators and opening parentheses", () => {
    expect(formulaOperandFragment("=mar:29")?.text).toBe("mar:29");
    expect(formulaOperandFragment("=mar:29/58 +")?.text).toBe("");
    expect(formulaOperandFragment("=mar:29/58 + mar:7")?.text).toBe("mar:7");
    expect(formulaOperandFragment("=(mar.boekjaar:")?.text).toBe(
      "mar.boekjaar:",
    );
    expect(formulaOperandFragment("=-")?.text).toBe("");
  });

  it("does not treat the slash inside a MAR code as an operator", () => {
    expect(formulaOperandFragment("=mar:29/58")?.text).toBe("mar:29/58");
    expect(formulaOperandFragment("=mar:29/58 /")?.text).toBe("");
  });
});

describe("getCellRefSuggestions", () => {
  it("keeps direct-reference suggestions", () => {
    const items = getCellRefSuggestions("mar:29", columns, ratioSpecs);
    expect(items.some((item) => item.insert === "mar:29/58")).toBe(true);
    expect(items[0]?.replaceStart).toBe(0);
  });

  it("suggests MAR and ratio refs after = and operators", () => {
    const afterEq = getCellRefSuggestions("=", columns, ratioSpecs);
    expect(afterEq.some((item) => item.kind === "mar")).toBe(true);
    expect(afterEq.some((item) => item.insert === "ratio:current_ratio")).toBe(
      true,
    );

    const afterOp = getCellRefSuggestions("=mar:29/58 + ", columns, ratioSpecs);
    expect(afterOp.some((item) => item.kind === "mar")).toBe(true);

    const afterParen = getCellRefSuggestions("=(", columns, ratioSpecs);
    expect(afterParen.length).toBeGreaterThan(0);
  });

  it("replaces only the current operand fragment", () => {
    const value = "=mar:29/58 + mar:7";
    const ctx = detectRefContext(value);
    expect(ctx?.type).toBe("mar");
    const items = getCellRefSuggestions(value, columns, ratioSpecs);
    const pick = items.find((item) => item.insert === "mar:70");
    expect(pick).toBeTruthy();
    expect(applyCellRefSuggestion(value, pick!)).toBe("=mar:29/58 + mar:70");
  });

  it("completes a year-prefixed operand without rewriting the formula", () => {
    const value = "=(mar.boekjaar:7";
    const items = getCellRefSuggestions(value, columns, ratioSpecs);
    const pick = items.find((item) => item.insert === "mar.boekjaar:70");
    expect(pick?.insert).toBe("mar.boekjaar:70");
    expect(applyCellRefSuggestion(value, pick!)).toBe("=(mar.boekjaar:70");
  });
});
