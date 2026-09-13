"""Validation for editable financial-table configuration."""

from __future__ import annotations

from typing import Any

import yaml

TABLE_IDS = (
    "cashflow",
    "herwerkte_balans",
    "herwerkte_resultatenrekening_full",
    "herwerkte_resultatenrekening_verkort_micro",
)

TABLE_TYPES = ("cashflow", "herwerkte_balans", "herwerkte_resultatenrekening")
MODEL_KINDS = ("full", "verkort", "micro")

EXPECTED: dict[str, tuple[str, tuple[str, ...]]] = {
    "cashflow": ("cashflow", ("full", "verkort", "micro")),
    "herwerkte_balans": ("herwerkte_balans", ("full", "verkort", "micro")),
    "herwerkte_resultatenrekening_full": (
        "herwerkte_resultatenrekening",
        ("full",),
    ),
    "herwerkte_resultatenrekening_verkort_micro": (
        "herwerkte_resultatenrekening",
        ("verkort", "micro"),
    ),
}

TABLE_KEYS = frozenset({"id", "type", "model_scope", "columns", "rows"})
COLUMN_KEYS = frozenset({"id", "label"})
ROW_KEYS = frozenset({"id", "label", "cells", "indent", "info", "cells_by_model", "kind"})
ROW_KINDS = ("row", "divider")
MAX_ROW_INDENT = 6


def _as_str(value: object, *, field: str) -> str:
    if value is None:
        return ""
    if isinstance(value, bool) or isinstance(value, (dict, list)):
        raise ValueError(f"Veld '{field}' moet tekst zijn.")
    if isinstance(value, (int, float)):
        if isinstance(value, float) and value.is_integer():
            return str(int(value))
        return str(value)
    if isinstance(value, str):
        return value
    raise ValueError(f"Veld '{field}' moet tekst zijn.")


def _require_id(value: object, *, what: str) -> str:
    text = _as_str(value, field="id").strip()
    if not text:
        raise ValueError(f"{what} heeft een lege id.")
    return text


def _unknown_keys(raw: dict, allowed: frozenset[str], *, what: str) -> None:
    extra = [key for key in raw if key not in allowed]
    if extra:
        raise ValueError(f"{what} bevat onbekende velden: {', '.join(extra)}.")


def _validate_column(raw: object, *, table_id: str) -> dict[str, str]:
    if not isinstance(raw, dict):
        raise ValueError(f"Tabel '{table_id}': kolom moet een object zijn.")
    _unknown_keys(raw, COLUMN_KEYS, what=f"Tabel '{table_id}': kolom")
    return {
        "id": _require_id(raw.get("id"), what=f"Tabel '{table_id}': kolom"),
        "label": _as_str(raw.get("label"), field="label"),
    }


def _validate_indent(value: object, *, table_id: str, row_id: str) -> int:
    if value is None or value == "":
        return 0
    if isinstance(value, bool) or isinstance(value, (dict, list)):
        raise ValueError(
            f"Tabel '{table_id}', rij '{row_id}': indent moet een geheel getal zijn."
        )
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return 0
        if not text.isdigit():
            raise ValueError(
                f"Tabel '{table_id}', rij '{row_id}': indent moet een geheel getal zijn."
            )
        value = int(text)
    if not isinstance(value, int):
        raise ValueError(
            f"Tabel '{table_id}', rij '{row_id}': indent moet een geheel getal zijn."
        )
    if value < 0 or value > MAX_ROW_INDENT:
        raise ValueError(
            f"Tabel '{table_id}', rij '{row_id}': indent moet tussen 0 en "
            f"{MAX_ROW_INDENT} liggen."
        )
    return value


def _validate_cells_list(
    cells_raw: object, *, table_id: str, row_id: str, column_count: int, field: str
) -> list[str]:
    if not isinstance(cells_raw, list):
        raise ValueError(
            f"Tabel '{table_id}', rij '{row_id}': {field} moet een lijst zijn."
        )
    cells = [_as_str(item, field=field) for item in cells_raw]
    if len(cells) != column_count:
        raise ValueError(
            f"Tabel '{table_id}', rij '{row_id}' heeft {len(cells)} cellen in {field}, "
            f"verwacht {column_count}."
        )
    return cells


def _validate_cells_by_model(
    raw: object, *, table_id: str, row_id: str, column_count: int
) -> dict[str, list[str]]:
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise ValueError(
            f"Tabel '{table_id}', rij '{row_id}': cells_by_model moet een object zijn."
        )
    result: dict[str, list[str]] = {}
    for key, value in raw.items():
        kind = _as_str(key, field="cells_by_model").strip()
        if kind not in MODEL_KINDS:
            raise ValueError(
                f"Tabel '{table_id}', rij '{row_id}': onbekend model '{kind}'."
            )
        result[kind] = _validate_cells_list(
            value,
            table_id=table_id,
            row_id=row_id,
            column_count=column_count,
            field=f"cells_by_model.{kind}",
        )
    return result


def _validate_row(
    raw: object, *, table_id: str, column_count: int
) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise ValueError(f"Tabel '{table_id}': rij moet een object zijn.")
    _unknown_keys(raw, ROW_KEYS, what=f"Tabel '{table_id}': rij")
    row_id = _require_id(raw.get("id"), what=f"Tabel '{table_id}': rij")
    kind_raw = raw.get("kind")
    if kind_raw is None or kind_raw == "":
        kind = "row"
    else:
        kind = _as_str(kind_raw, field="kind").strip()
        if kind not in ROW_KINDS:
            raise ValueError(
                f"Tabel '{table_id}', rij '{row_id}': onbekend rijtype '{kind}'."
            )
    if kind == "divider":
        cells = [""] * column_count
        row = {
            "id": row_id,
            "label": "",
            "cells": cells,
            "indent": 0,
            "info": "",
            "cells_by_model": {},
            "kind": "divider",
        }
        return row

    cells = _validate_cells_list(
        raw.get("cells") if raw.get("cells") is not None else [],
        table_id=table_id,
        row_id=row_id,
        column_count=column_count,
        field="cells",
    )
    return {
        "id": row_id,
        "label": _as_str(raw.get("label"), field="label"),
        "cells": cells,
        "indent": _validate_indent(
            raw.get("indent"), table_id=table_id, row_id=row_id
        ),
        "info": _as_str(raw.get("info"), field="info"),
        "cells_by_model": _validate_cells_by_model(
            raw.get("cells_by_model"),
            table_id=table_id,
            row_id=row_id,
            column_count=column_count,
        ),
    }


def _validate_table(raw: object) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise ValueError("Elke tabel moet een object zijn.")
    _unknown_keys(raw, TABLE_KEYS, what="Tabel")
    table_id = _require_id(raw.get("id"), what="Tabel")
    expected = EXPECTED.get(table_id)
    if expected is None:
        raise ValueError(f"Onbekende tabel-id '{table_id}'.")

    table_type = _as_str(raw.get("type"), field="type").strip()
    if table_type not in TABLE_TYPES:
        raise ValueError(f"Tabel '{table_id}': ongeldig type '{table_type}'.")
    if table_type != expected[0]:
        raise ValueError(
            f"Tabel '{table_id}' moet type '{expected[0]}' hebben, niet '{table_type}'."
        )

    scope_raw = raw.get("model_scope")
    if not isinstance(scope_raw, list) or not scope_raw:
        raise ValueError(f"Tabel '{table_id}': model_scope moet een niet-lege lijst zijn.")
    scope: list[str] = []
    seen: set[str] = set()
    for item in scope_raw:
        kind = _as_str(item, field="model_scope").strip()
        if kind not in MODEL_KINDS:
            raise ValueError(f"Tabel '{table_id}': onbekend model '{kind}'.")
        if kind in seen:
            raise ValueError(f"Tabel '{table_id}': dubbele model_scope-waarde '{kind}'.")
        seen.add(kind)
        scope.append(kind)
    if tuple(scope) != expected[1] and set(scope) != set(expected[1]):
        raise ValueError(
            f"Tabel '{table_id}' heeft onjuiste model_scope "
            f"(verwacht {' / '.join(expected[1])})."
        )
    scope = list(expected[1])

    columns_raw = raw.get("columns")
    if not isinstance(columns_raw, list) or not columns_raw:
        raise ValueError(f"Tabel '{table_id}' moet minstens één kolom hebben.")
    columns = [_validate_column(item, table_id=table_id) for item in columns_raw]
    column_ids = [col["id"] for col in columns]
    if len(column_ids) != len(set(column_ids)):
        raise ValueError(f"Tabel '{table_id}' heeft dubbele kolom-id's.")

    rows_raw = raw.get("rows")
    if not isinstance(rows_raw, list) or not rows_raw:
        raise ValueError(f"Tabel '{table_id}' moet minstens één rij hebben.")
    rows = [
        _validate_row(item, table_id=table_id, column_count=len(columns))
        for item in rows_raw
    ]
    row_ids = [row["id"] for row in rows]
    if len(row_ids) != len(set(row_ids)):
        raise ValueError(f"Tabel '{table_id}' heeft dubbele rij-id's.")

    return {
        "id": table_id,
        "type": table_type,
        "model_scope": scope,
        "columns": columns,
        "rows": rows,
    }


def validate_tables_config(tables: object) -> list[dict[str, Any]]:
    if not isinstance(tables, list):
        raise ValueError("Configuratie 'tables' moet een lijst zijn.")
    if not tables:
        raise ValueError("Configuratie moet de vier tabeldefinities bevatten.")

    validated = [_validate_table(item) for item in tables]
    found = [item["id"] for item in validated]
    if len(found) != len(set(found)):
        raise ValueError("Dubbele tabel-id's in de configuratie.")
    missing = [table_id for table_id in TABLE_IDS if table_id not in found]
    if missing:
        raise ValueError(f"Ontbrekende tabellen: {', '.join(missing)}.")
    extra = [table_id for table_id in found if table_id not in TABLE_IDS]
    if extra:
        raise ValueError(f"Onbekende tabellen: {', '.join(extra)}.")

    by_id = {item["id"]: item for item in validated}
    return [by_id[table_id] for table_id in TABLE_IDS]


def parse_tables_yaml(text: str) -> list[dict[str, Any]]:
    data = yaml.safe_load(text)
    if not isinstance(data, dict):
        raise ValueError("Ongeldige tables.yaml: root moet een object zijn.")
    return validate_tables_config(data.get("tables"))
