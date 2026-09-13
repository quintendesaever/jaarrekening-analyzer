import type { AmountFormat } from "../types";

/** Format bedragen als nl-BE (punt als duizendtallen-scheiding). */
export function formatAmount(
  value: number | null | undefined,
  format: AmountFormat = "full",
): string {
  if (value === null || value === undefined) return "—";
  if (format === "compact") {
    return new Intl.NumberFormat("nl-BE", {
      notation: "compact",
      compactDisplay: "short",
      maximumFractionDigits: 1,
    }).format(value);
  }
  return new Intl.NumberFormat("nl-BE", { maximumFractionDigits: 0 }).format(
    value,
  );
}

/**
 * Format een ratio-waarde volgens de unit uit ratios.yaml:
 * - "%" → twee decimalen + %
 * - "x" → twee decimalen (current ratio e.d.)
 * - "EUR" → afgerond bedrag + " EUR"
 * - anders → twee decimalen
 */
export function formatRatio(value: number | null, unit: string): string {
  if (value === null) return "N/A";
  if (unit === "%") return `${value.toFixed(2)}%`;
  if (unit === "x") return value.toFixed(2);
  if (unit === "EUR") return `${formatAmount(Math.round(value))} EUR`;
  return value.toFixed(2);
}

export function formatSignedPercent(change: number): string {
  const sign = change > 0 ? "+" : "";
  return `${sign}${change.toFixed(1)}%`;
}

/**
 * Table display for calculated cell results.
 * Whole numbers match amount formatting; divisions keep useful decimals.
 */
export function formatCalcResult(
  value: number,
  format: AmountFormat = "full",
): string {
  if (!Number.isFinite(value)) return "—";
  const nearest = Math.round(value);
  if (Math.abs(value - nearest) < 1e-9) {
    return formatAmount(nearest, format);
  }
  if (format === "compact") {
    return new Intl.NumberFormat("nl-BE", {
      notation: "compact",
      compactDisplay: "short",
      maximumFractionDigits: 2,
    }).format(value);
  }
  return new Intl.NumberFormat("nl-BE", {
    maximumFractionDigits: 4,
    minimumFractionDigits: 0,
  }).format(value);
}
