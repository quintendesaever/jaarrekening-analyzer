import type { ModelKind, TabellenViewId } from "../types";

export const VIEW_ITEMS: { id: TabellenViewId; label: string }[] = [
  { id: "cashflow", label: "Cashflow" },
  { id: "herwerkte_balans", label: "Herwerkte balans" },
  {
    id: "herwerkte_resultatenrekening",
    label: "Herwerkte resultatenrekening",
  },
];

export const MODEL_LABELS: Record<ModelKind, string> = {
  full: "Volledig",
  verkort: "Verkort",
  micro: "Micro",
};

export const MODEL_ORDER: ModelKind[] = ["full", "verkort", "micro"];

export type ResultGroup = "full" | "verkort_micro";

export function tableIdForView(
  view: TabellenViewId,
  resultGroup: ResultGroup,
): string {
  if (view === "cashflow") return "cashflow";
  if (view === "herwerkte_balans") return "herwerkte_balans";
  return resultGroup === "full"
    ? "herwerkte_resultatenrekening_full"
    : "herwerkte_resultatenrekening_verkort_micro";
}

export function resultGroupForModels(models: ModelKind[]): ResultGroup {
  return models.includes("full") ? "full" : "verkort_micro";
}

export function defaultSelectedModels(): ModelKind[] {
  return ["full"];
}

/**
 * Keep a non-empty selection when switching tabs.
 * Cashflow / balans: preserve any subset.
 * Results: keep Full alone or Verkort/Micro. A mixed Full+short
 * selection drops Full so the short-model work is not discarded.
 */
export function normalizeSelectedModels(
  view: TabellenViewId,
  selected: ModelKind[],
): ModelKind[] {
  const next = MODEL_ORDER.filter((kind) => selected.includes(kind));
  if (next.length === 0) return defaultSelectedModels();
  if (view !== "herwerkte_resultatenrekening") return next;

  const hasFull = next.includes("full");
  const shorts = next.filter((kind) => kind === "verkort" || kind === "micro");
  if (hasFull && shorts.length > 0) return shorts;
  if (hasFull) return ["full"];
  return shorts;
}

export function formatModelList(models: ModelKind[]): string {
  return models.map((kind) => MODEL_LABELS[kind]).join(", ");
}

/**
 * Toggle a model while keeping a non-empty selection.
 * Results: Volledig is incompatible with Verkort/Micro (different table structure).
 * Cashflow / balans: any non-empty subset of the three models.
 */
export function toggleModelSelection(
  view: TabellenViewId,
  selected: ModelKind[],
  clicked: ModelKind,
): ModelKind[] {
  if (selected.includes(clicked)) {
    if (selected.length === 1) return selected;
    return selected.filter((kind) => kind !== clicked);
  }

  if (view === "herwerkte_resultatenrekening") {
    if (clicked === "full" || selected.includes("full")) {
      return [clicked];
    }
    return MODEL_ORDER.filter(
      (kind) =>
        (kind === "verkort" || kind === "micro") &&
        (selected.includes(kind) || kind === clicked),
    );
  }

  return MODEL_ORDER.filter(
    (kind) => selected.includes(kind) || kind === clicked,
  );
}
