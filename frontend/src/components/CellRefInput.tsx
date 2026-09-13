import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { cellRefKind } from "../tables/cellRefs";
import {
  getCellRefSuggestions,
  type CellRefSuggestion,
} from "../tables/cellRefSuggestions";
import type { RatioSpec, TableColumn } from "../types";

interface CellRefInputProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  column: TableColumn;
  cellIndex: number;
  columns: TableColumn[];
  ratioSpecs: RatioSpec[];
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
}

function CellRefBadge({ kind }: { kind: ReturnType<typeof cellRefKind> }) {
  if (!kind) return null;
  const styles: Record<string, string> = {
    mar: "bg-violet-50 text-violet-700 ring-violet-200",
    ratio: "bg-sky-50 text-sky-700 ring-sky-200",
    cell: "bg-amber-50 text-amber-800 ring-amber-200",
    pct: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  };
  return (
    <span
      className={`shrink-0 rounded px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ${styles[kind]}`}
    >
      {kind}
    </span>
  );
}

export function CellRefInput({
  value,
  onChange,
  disabled,
  columns,
  ratioSpecs,
  placeholder,
  className,
  ariaLabel,
}: CellRefInputProps) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const refKind = cellRefKind(value);
  const suggestions = open
    ? getCellRefSuggestions(value, columns, ratioSpecs)
    : [];

  useEffect(() => {
    setActiveIndex(0);
  }, [value, suggestions.length]);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  function showSuggestions(next: string) {
    const items = getCellRefSuggestions(next, columns, ratioSpecs);
    setOpen(items.length > 0);
  }

  function pick(suggestion: CellRefSuggestion) {
    onChange(suggestion.insert);
    setOpen(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) {
      if (event.key === "ArrowDown" && getCellRefSuggestions(value, columns, ratioSpecs).length > 0) {
        setOpen(true);
        event.preventDefault();
      }
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => (i + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
    } else if (event.key === "Enter" && suggestions[activeIndex]) {
      event.preventDefault();
      pick(suggestions[activeIndex]);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} className="relative min-w-0 flex-1">
      <div className="flex items-center gap-1">
        <CellRefBadge kind={refKind} />
        <input
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(event) => {
            const next = event.target.value;
            onChange(next);
            showSuggestions(next);
          }}
          onFocus={() => showSuggestions(value)}
          onKeyDown={handleKeyDown}
          aria-label={ariaLabel}
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-autocomplete="list"
          className={className}
        />
      </div>
      {open && suggestions.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 top-full z-50 mt-1 max-h-56 w-72 overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
        >
          {suggestions.map((item, index) => (
            <li key={`${item.kind}-${item.insert}`} role="option" aria-selected={index === activeIndex}>
              <button
                type="button"
                className={`flex w-full flex-col items-start gap-0.5 px-2.5 py-1.5 text-left text-sm ${
                  index === activeIndex
                    ? "bg-emerald-50 text-emerald-900"
                    : "text-slate-800 hover:bg-slate-50"
                }`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pick(item)}
              >
                <span className="font-mono text-[13px]">{item.label}</span>
                {item.detail ? (
                  <span className="text-xs text-slate-500">{item.detail}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
