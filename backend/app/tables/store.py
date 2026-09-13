"""Persistent live table configuration (YAML on the data volume).

Bundled backend/config/tables.yaml is the canonical default. On first start,
if the override file is missing, it is copied once to TABLES_CONFIG_PATH
or to a tables.yaml sibling of the ratios override path.
"""

from __future__ import annotations

import os
from pathlib import Path

import yaml

from app.configstore.yaml_store import StaleConfigError, YamlConfigStore
from app.ratios.store import override_path as ratios_override_path
from app.tables.validate import parse_tables_yaml, validate_tables_config

CONFIG_DIR = Path(__file__).resolve().parents[2] / "config"
BUNDLED_TABLES_PATH = CONFIG_DIR / "tables.yaml"
HISTORY_KEEP = 20


def _override_path() -> Path:
    raw = os.environ.get("TABLES_CONFIG_PATH", "").strip()
    if raw:
        return Path(raw)
    return ratios_override_path().with_name("tables.yaml")


_store = YamlConfigStore(
    bundled_path=BUNDLED_TABLES_PATH,
    get_override_path=_override_path,
    get_history_dir=lambda: _override_path().parent / "tables-history",
    history_keep=HISTORY_KEEP,
    kind="table",
)


def override_path() -> Path:
    return _store.override_path()


def meta_path() -> Path:
    return _store.meta_path()


def history_dir() -> Path:
    return _store.history_dir()


def current_meta() -> dict:
    return _store.current_meta()


def tables_config_source() -> str:
    return _store.source()


def load_active_tables() -> list[dict]:
    return parse_tables_yaml(_store.load_text())


def _compact_row(row: dict) -> dict:
    """Keep YAML free of the default data-row kind."""
    if row.get("kind") != "row":
        return row
    return {key: value for key, value in row.items() if key != "kind"}


def dump_tables(tables: list[dict]) -> str:
    compacted = [
        {
            **table,
            "rows": [_compact_row(row) for row in table.get("rows", [])],
        }
        for table in tables
    ]
    return yaml.safe_dump({"tables": compacted}, allow_unicode=True, sort_keys=False)


def persist_tables(
    tables: list[dict], *, expected_version: int | None
) -> tuple[list[dict], dict]:
    validated = validate_tables_config(tables)
    new_meta = _store.persist_text(
        dump_tables(validated), expected_version=expected_version
    )
    return validated, new_meta


def reset_to_bundled() -> tuple[list[dict], dict]:
    text, new_meta = _store.reset_to_bundled(validate=parse_tables_yaml)
    return parse_tables_yaml(text), new_meta


def seed_if_missing() -> None:
    _store.seed_if_missing(validate=parse_tables_yaml)


def list_history() -> list[dict]:
    return _store.list_history()


def restore_history(
    version: int, *, expected_version: int | None = None
) -> tuple[list[dict], dict]:
    text, new_meta = _store.restore_history(
        version,
        expected_version=expected_version,
        validate=parse_tables_yaml,
    )
    return parse_tables_yaml(text), new_meta


def config_fields(tables: list[dict] | None = None) -> dict:
    payload = tables if tables is not None else load_active_tables()
    meta = current_meta()
    return {
        "tables": payload,
        "source": tables_config_source(),
        "version": meta["version"],
        "updated_at": meta.get("updated_at"),
    }


# Re-export so API routes can catch the shared exception from this module too.
__all__ = [
    "BUNDLED_TABLES_PATH",
    "StaleConfigError",
    "config_fields",
    "current_meta",
    "history_dir",
    "list_history",
    "load_active_tables",
    "meta_path",
    "override_path",
    "persist_tables",
    "reset_to_bundled",
    "restore_history",
    "seed_if_missing",
]
