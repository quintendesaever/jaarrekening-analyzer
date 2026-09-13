/** Eén regel uit balans of resultatenrekening (spiegel van backend StatementLine). */
export interface StatementLine {
  section: string;
  label: string;
  footnote: string;
  code: string;
  current: number | null; // bedrag huidig boekjaar in EUR
  previous: number | null; // bedrag vorig boekjaar in EUR
}

/** Config-entry voor één ratio (spiegel van ratios.yaml). */
export interface RatioSpec {
  id: string;
  name: string;
  category: string;
  numerator: string;
  denominator?: string | null;
  multiply?: number;
  unit?: string;
  enabled?: boolean;
}

export interface RatiosConfigMeta {
  ratios: RatioSpec[];
  source: "bundled" | "saved";
  version: number;
  updated_at: string | null;
  dashboard_ratio_count: number;
  categories: string[];
  dashboard_key_ids: Record<string, string[]>;
}

export interface RatioHistoryEntry {
  version: number;
  updated_at: string | null;
}

export type TableType =
  | "cashflow"
  | "herwerkte_balans"
  | "herwerkte_resultatenrekening";

export type ModelKind = "full" | "verkort" | "micro";

export interface TableColumn {
  id: string;
  label: string;
}

export type TableRowKind = "row" | "divider";

export interface TableRow {
  id: string;
  label: string;
  cells: string[];
  /** Visual nesting level for the omschrijving (0 = none). Stacks. */
  indent?: number;
  /** Optional row note shown via the info (i) badge. */
  info?: string;
  /** Per-model cell overrides when formulas differ between Full / Verkort / Micro. */
  cells_by_model?: Partial<Record<ModelKind, string[]>>;
  /** `divider` renders a horizontal rule instead of data cells. */
  kind?: TableRowKind;
}

export interface FinancialTableConfig {
  id: string;
  type: TableType;
  model_scope: ModelKind[];
  columns: TableColumn[];
  rows: TableRow[];
}

export interface TablesConfigMeta {
  tables: FinancialTableConfig[];
  source: "bundled" | "saved";
  version: number;
  updated_at: string | null;
}

export interface TableHistoryEntry {
  version: number;
  updated_at: string | null;
}

export type TabellenViewId =
  | "cashflow"
  | "herwerkte_balans"
  | "herwerkte_resultatenrekening";

/** Eén berekende ratio (spiegel van backend RatioResult). */
export interface RatioResult {
  id: string;
  name: string;
  category: string; // liquiditeit | solvabiliteit | rentabiliteit
  value: number | null;
  unit: string; // %, x, EUR
  formula: string;
  missing_codes: string[]; // MAR-codes die ontbraken
}

/** Percentage-verdeling t.o.v. een totaal (balans/omzet). */
export interface StructureItem {
  code: string;
  label: string;
  current: number | null;
  previous: number | null;
  pct_current: number | null;
  pct_previous: number | null;
}

/** Bounding box van een geëxtraheerde regel (pdfplumber top-left, PDF-punten). */
export interface ScanHighlight {
  page: number; // 0-based
  x0: number;
  top: number;
  x1: number;
  bottom: number;
  section: string;
  code: string;
}

export interface PageSize {
  width: number;
  height: number;
}

/**
 * Volledig antwoord van POST /api/analyze.
 * Velden komen 1-op-1 overeen met backend AnalysisResult.
 */
export interface AnalysisResult {
  schema_format: string | null; // bijv. VOL-kap, MIC-inb
  company_name?: string | null; // ondernemingsnaam uit NBB-identiteit
  balance_assets: StatementLine[]; // balans activa
  balance_liabilities: StatementLine[]; // balans passiva
  income_statement: StatementLine[]; // resultatenrekening
  appropriation_of_result: StatementLine[]; // resultaatverwerking
  ratios: RatioResult[]; // berekende ratio's
  balance_structure: StructureItem[]; // aandeel per activapost
  income_structure: StructureItem[]; // aandeel t.o.v. omzet
  warnings: string[]; // niet-fatale meldingen
  validations: string[]; // balanscontroles
  highlights?: ScanHighlight[];
  page_count?: number | null;
  page_sizes?: PageSize[];
}

export type AnalysisStatus =
  | "idle"
  | "selected"
  | "analyzing"
  | "completed"
  | "error"
  | "canceled";

export type AnalyzeJobStatusValue =
  | "queued"
  | "running"
  | "completed"
  | "error"
  | "canceled";

export interface AnalyzeJobStatus {
  job_id: string;
  status: AnalyzeJobStatusValue;
  current_stage: string | null;
  current_stage_label: string | null;
  completed_stages: string[];
  stage_labels: Record<string, string>;
  stage_order: string[];
  error: string | null;
  error_stage: string | null;
  error_stage_label: string | null;
  error_detail: string | null;
  result: AnalysisResult | null;
}

export interface AnalyzeJobCreated {
  job_id: string;
  status: string;
}

export interface RatioComputeResponse {
  ratios: RatioResult[];
  validations: string[];
}

export type AmountFormat = "full" | "compact";

export type StatementSectionId =
  | "balans_activa"
  | "balans_passiva"
  | "resultatenrekening"
  | "resultaatverwerking";

export interface SourceSelection {
  section: StatementSectionId;
  code: string;
  occurrenceIndex: number;
  page: number;
}

export type Tab =
  | "dashboard"
  | "pdf_scan"
  | "tables"
  | "ratios"
  | "ratio_config"
  | "tabellen"
  | "tabellen_config"
  | "settings";
