"""Representative analyze-path slice: extraction → MAR → ratios, plus analyze_pdf wiring."""

from __future__ import annotations

import pytest

from app.mar.aggregator import CodeAggregator
from app.models.schemas import ScanHighlight, StatementLine
from app.pdf.extractor import extract_rows_from_text, row_to_statement
from app.ratios.engine import compute_ratios, validate_balance
from app.services.analyzer import analyze_pdf, compute_from_statements

from tests.test_extractor import MINI_JAARREKENING_LINES


CURRENT_RATIO_SPEC = {
    "id": "current_ratio",
    "name": "Current ratio",
    "category": "liquiditeit",
    "numerator": "29/58",
    "denominator": "42/48",
    "multiply": 1,
    "unit": "x",
    "enabled": True,
}


def _statements_from_extracted_rows() -> dict[str, list[StatementLine]]:
    result = extract_rows_from_text(MINI_JAARREKENING_LINES)
    return {section: [row_to_statement(row) for row in rows] for section, rows in result.rows.items()}


def test_extraction_feeds_aggregator_and_current_ratio() -> None:
    statements = _statements_from_extracted_rows()
    all_lines = (
        statements["balans_activa"]
        + statements["balans_passiva"]
        + statements["resultatenrekening"]
    )
    aggregator = CodeAggregator(all_lines)

    assert aggregator.get("29/58") == 200_000
    assert aggregator.get("42/48") == 100_000
    assert aggregator.get("20/58") == 500_000
    assert aggregator.get("10/49") == 500_000
    assert aggregator.get("70") == 80_000
    assert aggregator.evaluate_expr("29/58 - 42/48") == (100_000, [])

    ratios = compute_ratios(aggregator, specs=[CURRENT_RATIO_SPEC])
    assert len(ratios) == 1
    assert ratios[0].id == "current_ratio"
    assert ratios[0].value == 2.0
    assert ratios[0].missing_codes == []

    validations = validate_balance(aggregator)
    assert validations == ["Totaal activa = totaal passiva (500.000 EUR)"]


def test_code_aggregator_alias_and_missing_expr() -> None:
    aggregator = CodeAggregator(
        [
            StatementLine(
                section="resultatenrekening",
                label="Omzet",
                code="70",
                current=80_000,
                previous=70_000,
            )
        ]
    )
    assert aggregator.get("70/76A") == 80_000
    value, missing = aggregator.evaluate_expr("29/58 - 3")
    assert value is None
    assert missing == ["29/58"]


def test_compute_from_statements_returns_ratio_and_validation() -> None:
    statements = _statements_from_extracted_rows()
    ratios, validations = compute_from_statements(
        statements["balans_activa"],
        statements["balans_passiva"],
        statements["resultatenrekening"],
        ratio_specs=[CURRENT_RATIO_SPEC],
    )
    assert ratios[0].value == 2.0
    assert "Totaal activa = totaal passiva" in validations[0]


def test_analyze_pdf_rejects_scanned_pdf(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.services.analyzer.is_text_pdf", lambda _pdf: False)

    with pytest.raises(ValueError, match="Gescande PDF"):
        analyze_pdf(b"%PDF-fake")


def test_analyze_pdf_wires_extract_to_analysis_result(monkeypatch: pytest.MonkeyPatch) -> None:
    statements = _statements_from_extracted_rows()
    highlights = [
        ScanHighlight(
            page=0,
            x0=10.0,
            top=20.0,
            x1=400.0,
            bottom=32.0,
            section="balans_activa",
            code="29/58",
        )
    ]
    stages: list[str] = []

    def fake_extract(_pdf: bytes):
        return (
            statements,
            "MIC-inb",
            highlights,
            2,
            [(595.0, 842.0)],
            "Voorbeeld BV",
        )

    monkeypatch.setattr("app.services.analyzer.is_text_pdf", lambda _pdf: True)
    monkeypatch.setattr("app.services.analyzer.extract_statements", fake_extract)

    result = analyze_pdf(b"%PDF-text", ratio_specs=[CURRENT_RATIO_SPEC], on_progress=stages.append)

    assert result.schema_format == "MIC-inb"
    assert result.company_name == "Voorbeeld BV"
    assert result.page_count == 2
    assert result.page_sizes[0].width == 595.0
    assert [line.code for line in result.balance_assets] == ["29/58", "40", "20/58"]
    assert [line.code for line in result.balance_liabilities] == ["42/48", "10/49"]
    assert result.income_statement[0].code == "70"
    assert result.appropriation_of_result[0].code == "14"
    assert result.ratios[0].value == 2.0
    assert result.warnings == []
    assert result.validations == ["Totaal activa = totaal passiva (500.000 EUR)"]
    assert result.highlights[0].code == "29/58"
    assert stages == ["validate_pdf", "extract", "aggregate", "ratios", "finalize"]


def test_analyze_pdf_warns_when_balance_and_income_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    empty = {
        "balans_activa": [],
        "balans_passiva": [],
        "resultatenrekening": [],
        "resultaatverwerking": [],
    }

    monkeypatch.setattr("app.services.analyzer.is_text_pdf", lambda _pdf: True)
    monkeypatch.setattr(
        "app.services.analyzer.extract_statements",
        lambda _pdf: (empty, None, [], 1, [], None),
    )

    result = analyze_pdf(b"%PDF-empty", ratio_specs=[CURRENT_RATIO_SPEC])
    assert "Geen balans gevonden in de PDF." in result.warnings
    assert "Geen resultatenrekening gevonden in de PDF." in result.warnings
    assert result.ratios[0].value is None
    assert result.ratios[0].missing_codes == ["29/58", "42/48"]


def test_validate_balance_flags_mismatch() -> None:
    aggregator = CodeAggregator(
        [
            StatementLine(section="balans_activa", label="Totaal", code="20/58", current=100),
            StatementLine(section="balans_passiva", label="Totaal", code="10/49", current=90),
        ]
    )
    [message] = validate_balance(aggregator)
    assert message.startswith("WAARSCHUWING")
    assert "100" in message
    assert "90" in message
