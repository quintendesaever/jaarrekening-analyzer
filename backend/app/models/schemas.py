"""Pydantic-modellen voor de analyse-API.

Dit is de JSON-vorm die de frontend ontvangt na `POST /api/analyze`.
Bedragen zijn hele euro's (integers), niet centen — zoals in de NBB-PDF.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class StatementLine(BaseModel):
    """Eén regel uit balans of resultatenrekening, geëxtraheerd uit de PDF."""

    section: str  # bijv. balans_activa, balans_passiva, resultatenrekening
    label: str  # omschrijving zoals in de jaarrekening
    footnote: str = ""  # toelichtingsnummer (bijv. "3.1.2")
    code: str  # MAR-code (bijv. "70" of "29/58")
    current: int | None = None  # bedrag huidig boekjaar in EUR
    previous: int | None = None  # bedrag vorig boekjaar in EUR


class RatioSpec(BaseModel):
    """Config-entry voor één ratio (spiegel van ratios.yaml)."""

    id: str
    name: str
    category: str = "overig"
    numerator: str
    denominator: str | None = None
    multiply: float = 1
    unit: str = ""
    enabled: bool = True


class RatiosConfigResponse(BaseModel):
    """Antwoord van GET /api/ratios — actieve serverconfiguratie."""

    ratios: list[RatioSpec]
    source: str = "bundled"  # bundled | saved
    version: int = 1
    updated_at: str | None = None
    dashboard_ratio_count: int = 3
    categories: list[str] = Field(default_factory=list)
    dashboard_key_ids: dict[str, list[str]] = Field(default_factory=dict)


class RatioHistoryEntry(BaseModel):
    version: int
    updated_at: str | None = None


class RatioHistoryResponse(BaseModel):
    items: list[RatioHistoryEntry]


TableType = Literal["cashflow", "herwerkte_balans", "herwerkte_resultatenrekening"]
ModelKind = Literal["full", "verkort", "micro"]


class TableColumn(BaseModel):
    id: str
    label: str = ""


class TableRow(BaseModel):
    id: str
    label: str = ""
    cells: list[str] = Field(default_factory=list)
    indent: int = 0
    info: str = ""
    cells_by_model: dict[str, list[str]] = Field(default_factory=dict)
    kind: Literal["row", "divider"] = "row"


class FinancialTableConfig(BaseModel):
    """Eén configureerbare financiële tabel (Cashflow / herwerkte staten)."""

    id: str
    type: TableType
    model_scope: list[ModelKind]
    columns: list[TableColumn]
    rows: list[TableRow]


class TablesConfigResponse(BaseModel):
    """Antwoord van GET /api/tables — actieve tabelconfiguratie."""

    tables: list[FinancialTableConfig]
    source: str = "bundled"  # bundled | saved
    version: int = 1
    updated_at: str | None = None


class TableHistoryEntry(BaseModel):
    version: int
    updated_at: str | None = None


class TableHistoryResponse(BaseModel):
    items: list[TableHistoryEntry]


class RatioResult(BaseModel):
    """Eén berekende financiële ratio uit ratios.yaml."""

    id: str  # machine-id, bijv. current_ratio
    name: str  # leesbare naam voor de UI
    category: str  # liquiditeit, solvabiliteit of rentabiliteit
    value: float | None  # None als berekening niet mogelijk was
    unit: str  # bijv. ratio, pct, days
    formula: str  # menselijk leesbare formule voor de UI
    missing_codes: list[str] = Field(
        default_factory=list
    )  # MAR-codes die ontbraken en de ratio blokkeerden


class StructureItem(BaseModel):
    """Percentage-verdeling van een post t.o.v. een totaal (balans of omzet)."""

    code: str
    label: str
    current: int | None  # bedrag huidig boekjaar in EUR
    previous: int | None  # bedrag vorig boekjaar in EUR
    pct_current: float | None  # aandeel huidig jaar (0–100)
    pct_previous: float | None  # aandeel vorig jaar (0–100)


class ScanHighlight(BaseModel):
    """Bounding box van een geëxtraheerde regel (pdfplumber-coördinaten, top-left)."""

    page: int  # 0-based
    x0: float
    top: float
    x1: float
    bottom: float
    section: str
    code: str


class PageSize(BaseModel):
    """PDF-pagina-afmetingen in punten (zelfde ruimte als ScanHighlight)."""

    width: float
    height: float


class RatioComputeRequest(BaseModel):
    """Herbereken ratio's op bestaande staten (zonder PDF opnieuw te parsen)."""

    balance_assets: list[StatementLine]
    balance_liabilities: list[StatementLine]
    income_statement: list[StatementLine]
    ratios: list[RatioSpec] | None = None


class RatioComputeResponse(BaseModel):
    """Antwoord van POST /api/ratios/compute."""

    ratios: list[RatioResult]
    validations: list[str]


class AnalyzeJobCreated(BaseModel):
    job_id: str
    status: str


class AnalysisResult(BaseModel):
    """Volledig antwoord van de analyse-pipeline — dit serialiseert naar JSON."""

    schema_format: str | None = None  # bijv. VOL-kap, MIC-inb
    company_name: str | None = None  # ondernemingsnaam uit NBB-identiteit
    balance_assets: list[StatementLine]  # balans activa
    balance_liabilities: list[StatementLine]  # balans passiva
    income_statement: list[StatementLine]  # resultatenrekening
    appropriation_of_result: list[StatementLine] = Field(
        default_factory=list
    )  # resultaatverwerking
    ratios: list[RatioResult]  # ratio's
    balance_structure: list[StructureItem]  # structurele verdeling van de balans
    income_structure: list[StructureItem]  # structurele verdeling van de resultatenrekening
    warnings: list[str] = Field(default_factory=list)  # niet-fatale meldingen (bijv. ontbrekende codes)
    validations: list[str] = Field(default_factory=list)  # balanscontroles
    highlights: list[ScanHighlight] = Field(default_factory=list)
    page_count: int | None = None
    page_sizes: list[PageSize] = Field(default_factory=list)


class AnalyzeJobStatus(BaseModel):
    job_id: str
    status: str
    current_stage: str | None = None
    current_stage_label: str | None = None
    completed_stages: list[str] = Field(default_factory=list)
    stage_labels: dict[str, str] = Field(default_factory=dict)
    stage_order: list[str] = Field(default_factory=list)
    error: str | None = None
    error_stage: str | None = None
    error_stage_label: str | None = None
    error_detail: str | None = None
    result: AnalysisResult | None = None
