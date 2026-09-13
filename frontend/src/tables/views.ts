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
