import type { ModelKind, TableRow } from "../types";

function padCells(cells: string[], columnCount: number): string[] {
  const result = [...cells];
  while (result.length < columnCount) result.push("");
  return result.slice(0, columnCount);
}

/** Cell values for a row in the selected model (override or shared default). */
export function cellsForModel(
  row: TableRow,
  model: ModelKind,
  columnCount: number,
): string[] {
  const override = row.cells_by_model?.[model];
  return padCells(override ?? row.cells, columnCount);
}

export function rowHasModelOverride(row: TableRow, model: ModelKind): boolean {
  return row.cells_by_model?.[model] !== undefined;
}

export function tableHasModelOverrides(
  rows: TableRow[],
  model: ModelKind,
): boolean {
  return rows.some((row) => rowHasModelOverride(row, model));
}

export function updateCellsForModel(
  row: TableRow,
  model: ModelKind,
  cells: string[],
  modelsInScope: ModelKind[],
): TableRow {
  if (modelsInScope.length <= 1) {
    return { ...row, cells };
  }
  return {
    ...row,
    cells_by_model: {
      ...(row.cells_by_model ?? {}),
      [model]: cells,
    },
  };
}

export function inferModelFromSchema(
  schema: string | null | undefined,
): ModelKind | null {
  if (!schema) return null;
  const upper = schema.toUpperCase();
  if (upper.includes("MIC")) return "micro";
  if (upper.includes("VK") || upper.includes("VERKORT")) return "verkort";
  if (upper.includes("VOL") || upper.includes("FULL")) return "full";
  return null;
}
