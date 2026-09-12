"""Unit tests for PDF line/row extraction helpers (no live PDF required)."""

from __future__ import annotations

from app.pdf.extractor import (
    Row,
    TextLine,
    cluster_text_lines,
    detect_section_header,
    expand_highlights_to_content_width,
    extract_rows_from_lines,
    extract_rows_from_text,
    is_stop_header,
    merge_cluster,
    parse_amount,
    parse_code_first_line,
    parse_line,
    realign_single_amount_by_geometry,
    row_to_statement,
    should_skip,
)
from app.models.schemas import ScanHighlight


MINI_JAARREKENING_LINES = [
    "IDENTITEIT",
    "Naam: Voorbeeld BV",
    "MIC-inb 3.1",
    "JAARREKENING",
    "ACTIVA",
    "5 / 55",
    "Vlottende activa 29/58 200.000 180.000",
    "Handelsvorderingen 40 1.234.567 1.100.000",
    "Totaal der activa 20/58 500.000 480.000",
    "PASSIVA",
    "Kortlopende schulden 42/48 100.000 90.000",
    "Totaal der passiva 10/49 500.000 480.000",
    "RESULTATENREKENING",
    "Omzet 70 80.000 70.000",
    "RESULTAATVERWERKING",
    "Overgedragen winst 14 12.000 10.000",
    "TOELICHTING",
    "Iets na de poort 99 1 1",
]


def _by_code(rows: list[Row]) -> dict[str, Row]:
    return {row.code: row for row in rows}


def test_parse_amount_strips_belgian_thousands() -> None:
    assert parse_amount("1.234.567") == 1_234_567
    assert parse_amount("-1.109.904") == -1_109_904
    assert parse_amount("80") == 80


def test_detect_section_and_stop_headers() -> None:
    assert detect_section_header("ACTIVA") == "balans_activa"
    assert detect_section_header("VLOTTENDE ACTIVA") == "balans_activa"
    assert detect_section_header("PASSIVA") == "balans_passiva"
    assert detect_section_header("RESULTATENREKENING") == "resultatenrekening"
    assert detect_section_header("RESULTAATVERWERKING") == "resultaatverwerking"
    assert detect_section_header("Handelsvorderingen 40 100") is None

    assert is_stop_header("TOELICHTING") is True
    assert is_stop_header("SOCIALE BALANS") is True
    assert is_stop_header("VOL-kap 6.1") is True
    assert is_stop_header("Omzet 70 80.000") is False


def test_should_skip_headers_and_keep_statement_rows() -> None:
    assert should_skip("") is True
    assert should_skip("BALANS NA WINSTVERDELING") is True
    assert should_skip("Codes Boekjaar") is True
    assert should_skip("MIC-inb 3.1") is True
    assert should_skip("5 / 55") is True
    assert should_skip("Vlottende activa 29/58 200.000") is False


def test_parse_line_paren_code_and_toelichting() -> None:
    paren = parse_line(
        "Kapitaalsubsidies (9905) 1.093.780 3.554.703",
        "balans_passiva",
    )
    assert paren is not None
    assert paren.code == "9905"
    assert paren.omschrijving == "Kapitaalsubsidies"
    assert paren.boekjaar == 1_093_780
    assert paren.vorig_boekjaar == 3_554_703

    with_note = parse_line(
        "Handelsvorderingen 3.1.2 40 10.000 9.000",
        "balans_activa",
    )
    assert with_note is not None
    assert with_note.code == "40"
    assert with_note.toelichting == "3.1.2"
    assert with_note.boekjaar == 10_000


def test_parse_line_requires_description_unless_disabled() -> None:
    assert parse_line("40 10.000 9.000", "balans_activa") is None
    bare = parse_line("40 10.000 9.000", "balans_activa", require_description=False)
    assert bare is not None
    assert bare.code == "40"
    assert bare.omschrijving == ""
    assert bare.boekjaar == 10_000


def test_parse_code_first_line() -> None:
    row = parse_code_first_line("3.1.2 40 10.000 9.000", "balans_activa")
    assert row is not None
    assert row.code == "40"
    assert row.toelichting == "3.1.2"
    assert row.omschrijving == ""
    assert row.boekjaar == 10_000
    assert row.vorig_boekjaar == 9_000
    assert parse_code_first_line("geen code hier", "balans_activa") is None


def test_extract_rows_from_text_state_machine() -> None:
    result = extract_rows_from_text(MINI_JAARREKENING_LINES)

    assert result.schema_format == "MIC-inb"
    assert result.company_name == "Voorbeeld BV"

    activa = _by_code(result.rows["balans_activa"])
    assert activa["29/58"].boekjaar == 200_000
    assert activa["29/58"].vorig_boekjaar == 180_000
    assert activa["40"].boekjaar == 1_234_567
    assert activa["20/58"].boekjaar == 500_000

    passiva = _by_code(result.rows["balans_passiva"])
    assert passiva["42/48"].boekjaar == 100_000
    assert passiva["10/49"].boekjaar == 500_000

    income = _by_code(result.rows["resultatenrekening"])
    assert income["70"].omschrijving == "Omzet"
    assert income["70"].boekjaar == 80_000

    appropriation = _by_code(result.rows["resultaatverwerking"])
    assert appropriation["14"].boekjaar == 12_000

    all_codes = {row.code for rows in result.rows.values() for row in rows}
    assert "99" not in all_codes


def test_extract_rows_from_lines_joins_continuation_and_code_first() -> None:
    lines = [
        TextLine("JAARREKENING"),
        TextLine("ACTIVA"),
        TextLine("Handelsvorderingen"),
        TextLine("(handelsgoederen)"),
        TextLine("40 1.234.567 1.100.000"),
        TextLine("Liquide middelen"),
        TextLine("54 18.600 17.000"),
    ]
    result = extract_rows_from_lines(lines)
    activa = _by_code(result.rows["balans_activa"])

    assert activa["40"].omschrijving == "Handelsvorderingen (handelsgoederen)"
    assert activa["40"].boekjaar == 1_234_567
    assert activa["54"].omschrijving == "Liquide middelen"
    assert activa["54"].boekjaar == 18_600


def test_extract_ignores_rows_before_jaarrekening_and_without_section() -> None:
    result = extract_rows_from_text(
        [
            "Omzet 70 80.000 70.000",
            "JAARREKENING",
            "Handelsvorderingen 40 100 90",
            "ACTIVA",
            "Vlottende activa 29/58 200 180",
        ]
    )
    activa = _by_code(result.rows["balans_activa"])
    assert "70" not in activa
    assert "40" not in activa
    assert activa["29/58"].boekjaar == 200


def test_repeated_jaarrekening_title_is_skipped() -> None:
    result = extract_rows_from_text(
        [
            "JAARREKENING",
            "ACTIVA",
            "Vlottende activa 29/58 200 180",
            "JAARREKENING",
            "Totaal der activa 20/58 500 480",
        ]
    )
    codes = [row.code for row in result.rows["balans_activa"]]
    assert codes == ["29/58", "20/58"]


def test_cluster_text_lines_merges_wrap_but_not_distinct_codes() -> None:
    wrap = [
        TextLine("Handelsvorderingen", page=0, top=100.0),
        TextLine("40 100 90", page=0, top=108.0),
    ]
    merged = cluster_text_lines(wrap)
    assert len(merged) == 1
    assert [part.text for part in merged[0]] == ["Handelsvorderingen", "40 100 90"]

    distinct = [
        TextLine("Vlottende activa 29/58 200 180", page=0, top=100.0),
        TextLine("Handelsvorderingen 40 100 90", page=0, top=108.0),
    ]
    split = cluster_text_lines(distinct)
    assert len(split) == 2


def test_merge_cluster_puts_code_column_last() -> None:
    cluster = [
        TextLine("(+)/(-) 631/4 -1.109.904 407.102", page=0, x0=400.0, top=120.0),
        TextLine("Waardeverminderingen", page=0, x0=40.0, top=118.0),
        TextLine("(terugnemingen)", page=0, x0=40.0, top=126.0),
    ]
    merged = merge_cluster(cluster)
    assert merged.text.startswith("Waardeverminderingen")
    assert merged.text.endswith("407.102")
    assert "631/4" in merged.text
    assert merged.x0 == 40.0
    assert merged.x1 is None


def test_row_to_statement_maps_dutch_fields() -> None:
    statement = row_to_statement(
        Row(
            sectie="balans_activa",
            omschrijving="Vlottende activa (+)/(-)",
            toelichting="3.1",
            code="29 / 58",
            boekjaar=200,
            vorig_boekjaar=180,
        )
    )
    assert statement.section == "balans_activa"
    assert statement.label == "Vlottende activa"
    assert statement.footnote == "3.1"
    assert statement.code == "29/58"
    assert statement.current == 200
    assert statement.previous == 180


def test_realign_single_amount_moves_right_column_to_previous() -> None:
    row = Row(
        sectie="balans_activa",
        omschrijving="Onbeschikbaar",
        toelichting="",
        code="111",
        boekjaar=18_600,
        vorig_boekjaar=None,
    )
    line = TextLine("Onbeschikbaar 111 18.600", page=0, x0=40.0, top=200.0, x1=500.0, bottom=214.0)
    words = [
        {"text": "18.600", "x0": 420.0, "top": 201.0},
    ]
    aligned = realign_single_amount_by_geometry(row, line, words, column_mid_x=350.0)
    assert aligned.boekjaar is None
    assert aligned.vorig_boekjaar == 18_600


def test_realign_keeps_current_when_amount_is_left_of_midpoint() -> None:
    row = Row(
        sectie="balans_activa",
        omschrijving="Onbeschikbaar",
        toelichting="",
        code="111",
        boekjaar=18_600,
        vorig_boekjaar=None,
    )
    line = TextLine("Onbeschikbaar 111 18.600", page=0, x0=40.0, top=200.0, x1=500.0, bottom=214.0)
    words = [
        {"text": "18.600", "x0": 280.0, "top": 201.0},
    ]
    aligned = realign_single_amount_by_geometry(row, line, words, column_mid_x=350.0)
    assert aligned.boekjaar == 18_600
    assert aligned.vorig_boekjaar is None


def test_extract_rows_from_lines_records_highlights() -> None:
    result = extract_rows_from_lines(
        [
            TextLine("JAARREKENING"),
            TextLine("ACTIVA"),
            TextLine(
                "Vlottende activa 29/58 200 180",
                page=0,
                x0=40.0,
                top=120.0,
                x1=500.0,
                bottom=132.0,
            ),
        ]
    )
    assert len(result.highlights) == 1
    highlight = result.highlights[0]
    assert highlight.page == 0
    assert highlight.code == "29/58"
    assert highlight.section == "balans_activa"
    assert highlight.x0 == 40.0
    assert highlight.x1 == 500.0


def test_expand_highlights_to_content_width() -> None:
    highlights = [
        ScanHighlight(
            page=0, x0=40.0, top=100.0, x1=200.0, bottom=110.0, section="balans_activa", code="40"
        ),
        ScanHighlight(
            page=0, x0=50.0, top=120.0, x1=480.0, bottom=130.0, section="balans_activa", code="20/58"
        ),
    ]
    expanded = expand_highlights_to_content_width(highlights)
    assert {item.x0 for item in expanded} == {40.0}
    assert {item.x1 for item in expanded} == {480.0}
    assert [item.code for item in expanded] == ["40", "20/58"]
