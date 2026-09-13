import type { ModelKind } from "../types";
import { MODEL_LABELS } from "../tables/views";

interface ModelMultiSelectProps {
  models: ModelKind[];
  selected: ModelKind[];
  onChange: (models: ModelKind[]) => void;
  hasOverrides?: (kind: ModelKind) => boolean;
  label?: string;
  ariaLabel?: string;
}

export function ModelMultiSelect({
  models,
  selected,
  onChange,
  hasOverrides,
  label = "Bewerk",
  ariaLabel = "Model selectie",
}: ModelMultiSelectProps) {
  if (models.length <= 1) return null;

  function toggle(kind: ModelKind) {
    if (selected.includes(kind)) {
      if (selected.length === 1) return;
      onChange(selected.filter((item) => item !== kind));
      return;
    }
    const next = models.filter(
      (item) => selected.includes(item) || item === kind,
    );
    onChange(next);
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
        {label}
      </span>
      <div
        role="group"
        aria-label={ariaLabel}
        className="inline-flex flex-wrap gap-1"
      >
        {models.map((kind) => {
          const active = selected.includes(kind);
          const overrides = hasOverrides?.(kind) ?? false;
          return (
            <button
              key={kind}
              type="button"
              aria-pressed={active}
              onClick={() => toggle(kind)}
              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-sm font-medium ring-1 ${
                active
                  ? "bg-slate-800 text-white ring-slate-800"
                  : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50"
              }`}
            >
              {MODEL_LABELS[kind]}
              {overrides && (
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    active ? "bg-emerald-300" : "bg-emerald-500"
                  }`}
                  title="Eigen formules"
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
