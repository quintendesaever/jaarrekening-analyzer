"""Tests for live table configuration store, API, and validation."""

from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

import pytest
import yaml
from fastapi.testclient import TestClient

from app.main import app
from app.middleware.rate_limit import RateLimitMiddleware
from app.tables.store import BUNDLED_TABLES_PATH, seed_if_missing
from app.tables.validate import validate_tables_config

ADMIN = "test-admin-token"

TABLE_IDS = (
    "cashflow",
    "herwerkte_balans",
    "herwerkte_resultatenrekening_full",
    "herwerkte_resultatenrekening_verkort_micro",
)


def _rate_limit_middleware() -> RateLimitMiddleware | None:
    current = app.middleware_stack
    seen: set[int] = set()
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        if isinstance(current, RateLimitMiddleware):
            return current
        current = getattr(current, "app", None)
    return None


@contextmanager
def _client(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, token: str | None = ADMIN
) -> Iterator[TestClient]:
    monkeypatch.setenv("RATIOS_CONFIG_PATH", str(tmp_path / "ratios.yaml"))
    monkeypatch.setenv("TABLES_CONFIG_PATH", str(tmp_path / "tables.yaml"))
    if token is None:
        monkeypatch.delenv("ADMIN_TOKEN", raising=False)
    else:
        monkeypatch.setenv("ADMIN_TOKEN", token)
    with TestClient(app) as client:
        middleware = _rate_limit_middleware()
        original = middleware.max_requests if middleware is not None else None
        if middleware is not None:
            middleware._hits.clear()
            middleware.max_requests = 10_000
        try:
            yield client
        finally:
            if middleware is not None and original is not None:
                middleware.max_requests = original
                middleware._hits.clear()


def _auth(token: str = ADMIN) -> dict[str, str]:
    return {"X-Admin-Token": token}


def _by_id(tables: list[dict]) -> dict[str, dict]:
    return {item["id"]: item for item in tables}


def test_seed_when_override_missing(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TABLES_CONFIG_PATH", str(tmp_path / "tables.yaml"))
    monkeypatch.setenv("RATIOS_CONFIG_PATH", str(tmp_path / "ratios.yaml"))
    override = tmp_path / "tables.yaml"
    assert not override.exists()
    seed_if_missing()
    assert override.is_file()
    bundled = yaml.safe_load(BUNDLED_TABLES_PATH.read_text(encoding="utf-8"))
    saved = yaml.safe_load(override.read_text(encoding="utf-8"))
    assert [item["id"] for item in saved["tables"]] == [
        item["id"] for item in bundled["tables"]
    ]
    assert (tmp_path / "tables.meta.json").is_file()


def test_existing_override_not_overwritten_by_seed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("TABLES_CONFIG_PATH", str(tmp_path / "tables.yaml"))
    monkeypatch.setenv("RATIOS_CONFIG_PATH", str(tmp_path / "ratios.yaml"))
    bundled = yaml.safe_load(BUNDLED_TABLES_PATH.read_text(encoding="utf-8"))
    bundled["tables"][0]["rows"][0]["label"] = "Custom cashflow label"
    override = tmp_path / "tables.yaml"
    override.write_text(
        yaml.safe_dump(bundled, allow_unicode=True, sort_keys=False),
        encoding="utf-8",
    )
    seed_if_missing()
    saved = yaml.safe_load(override.read_text(encoding="utf-8"))
    assert saved["tables"][0]["rows"][0]["label"] == "Custom cashflow label"


def test_get_returns_four_configurations(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    with _client(tmp_path, monkeypatch) as client:
        current = client.get("/api/tables").json()
        ids = [item["id"] for item in current["tables"]]
        assert ids == list(TABLE_IDS)
        by_id = _by_id(current["tables"])
        assert by_id["cashflow"]["type"] == "cashflow"
        assert by_id["cashflow"]["model_scope"] == ["full", "verkort", "micro"]
        assert by_id["herwerkte_balans"]["type"] == "herwerkte_balans"
        assert by_id["herwerkte_balans"]["model_scope"] == ["full", "verkort", "micro"]
        assert by_id["herwerkte_resultatenrekening_full"]["type"] == (
            "herwerkte_resultatenrekening"
        )
        assert by_id["herwerkte_resultatenrekening_full"]["model_scope"] == ["full"]
        assert by_id["herwerkte_resultatenrekening_verkort_micro"]["type"] == (
            "herwerkte_resultatenrekening"
        )
        assert by_id["herwerkte_resultatenrekening_verkort_micro"]["model_scope"] == [
            "verkort",
            "micro",
        ]
        for table in current["tables"]:
            for row in table["rows"]:
                assert len(row["cells"]) == len(table["columns"])


def test_save_persists_and_reload(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    with _client(tmp_path, monkeypatch) as client:
        current = client.get("/api/tables").json()
        tables = current["tables"]
        tables[0]["rows"][0]["label"] = "Gewijzigde operationele cashflow"
        tables[0]["rows"][0]["cells"][1] = "100"
        saved = client.put(
            "/api/tables",
            json={"tables": tables, "version": current["version"]},
            headers=_auth(),
        )
        assert saved.status_code == 200, saved.text
        body = saved.json()
        assert body["tables"][0]["rows"][0]["label"] == "Gewijzigde operationele cashflow"
        assert body["tables"][0]["rows"][0]["cells"][1] == "100"
        assert body["version"] == current["version"] + 1
        assert body["source"] == "saved"
        assert (tmp_path / "tables-history").is_dir()
        assert not (tmp_path / "history").exists() or not any(
            (tmp_path / "history").glob("*.yaml")
        )

    with _client(tmp_path, monkeypatch) as client:
        reloaded = client.get("/api/tables").json()
        assert reloaded["tables"][0]["rows"][0]["label"] == (
            "Gewijzigde operationele cashflow"
        )
        disk = yaml.safe_load((tmp_path / "tables.yaml").read_text(encoding="utf-8"))
        assert disk["tables"][0]["rows"][0]["label"] == "Gewijzigde operationele cashflow"


def test_reset_restores_bundled(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    bundled = yaml.safe_load(BUNDLED_TABLES_PATH.read_text(encoding="utf-8"))
    with _client(tmp_path, monkeypatch) as client:
        current = client.get("/api/tables").json()
        tables = current["tables"]
        tables[0]["rows"][0]["label"] = "Tijdelijke naam"
        client.put(
            "/api/tables",
            json={"tables": tables, "version": current["version"]},
            headers=_auth(),
        )
        reset = client.post("/api/tables/reset", headers=_auth())
        assert reset.status_code == 200, reset.text
        assert (
            reset.json()["tables"][0]["rows"][0]["label"]
            == bundled["tables"][0]["rows"][0]["label"]
        )


def test_cells_length_must_match_columns(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    with _client(tmp_path, monkeypatch) as client:
        current = client.get("/api/tables").json()
        tables = current["tables"]
        tables[0]["rows"][0]["cells"] = ["only-one"]
        response = client.put(
            "/api/tables",
            json={"tables": tables, "version": current["version"]},
            headers=_auth(),
        )
        assert response.status_code == 422
        assert "cellen" in response.json()["detail"]


def test_missing_table_rejected(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    with _client(tmp_path, monkeypatch) as client:
        current = client.get("/api/tables").json()
        tables = current["tables"][1:]
        response = client.put(
            "/api/tables",
            json={"tables": tables, "version": current["version"]},
            headers=_auth(),
        )
        assert response.status_code == 422
        assert "Ontbrekende" in response.json()["detail"]


def test_wrong_model_scope_rejected(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    with _client(tmp_path, monkeypatch) as client:
        current = client.get("/api/tables").json()
        tables = current["tables"]
        full = next(
            item
            for item in tables
            if item["id"] == "herwerkte_resultatenrekening_full"
        )
        full["model_scope"] = ["verkort", "micro"]
        response = client.put(
            "/api/tables",
            json={"tables": tables, "version": current["version"]},
            headers=_auth(),
        )
        assert response.status_code == 422


def test_empty_list_rejected(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    with _client(tmp_path, monkeypatch) as client:
        current = client.get("/api/tables").json()
        response = client.put(
            "/api/tables",
            json={"tables": [], "version": current["version"]},
            headers=_auth(),
        )
        assert response.status_code == 422


def test_missing_and_incorrect_admin_token(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    with _client(tmp_path, monkeypatch) as client:
        current = client.get("/api/tables").json()
        payload = {"tables": current["tables"], "version": current["version"]}
        missing = client.put("/api/tables", json=payload)
        assert missing.status_code == 401
        wrong = client.put(
            "/api/tables",
            json=payload,
            headers=_auth("wrong-token"),
        )
        assert wrong.status_code == 401


def test_writes_disabled_without_admin_token(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    with _client(tmp_path, monkeypatch, token=None) as client:
        current = client.get("/api/tables").json()
        response = client.put(
            "/api/tables",
            json={"tables": current["tables"], "version": current["version"]},
            headers=_auth("anything"),
        )
        assert response.status_code == 503
        assert "ADMIN_TOKEN" in response.json()["detail"]


def test_stale_version_conflict(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    with _client(tmp_path, monkeypatch) as client:
        current = client.get("/api/tables").json()
        tables = current["tables"]
        tables[0]["rows"][0]["label"] = "Eerste tab"
        first = client.put(
            "/api/tables",
            json={"tables": tables, "version": current["version"]},
            headers=_auth(),
        )
        assert first.status_code == 200
        stale = client.put(
            "/api/tables",
            json={"tables": tables, "version": current["version"]},
            headers=_auth(),
        )
        assert stale.status_code == 409
        assert "Laad opnieuw" in stale.json()["detail"]
        live = client.get("/api/tables").json()
        assert live["tables"][0]["rows"][0]["label"] == "Eerste tab"


def test_history_snapshot_and_restore(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    with _client(tmp_path, monkeypatch) as client:
        current = client.get("/api/tables").json()
        original_label = current["tables"][0]["rows"][0]["label"]
        tables = current["tables"]
        tables[0]["rows"][0]["label"] = "Na snapshot"
        saved = client.put(
            "/api/tables",
            json={"tables": tables, "version": current["version"]},
            headers=_auth(),
        )
        assert saved.status_code == 200
        history = client.get("/api/tables/history").json()["items"]
        assert history
        snapshot_version = history[0]["version"]
        restored = client.post(
            f"/api/tables/history/{snapshot_version}/restore",
            headers=_auth(),
        )
        assert restored.status_code == 200, restored.text
        assert restored.json()["tables"][0]["rows"][0]["label"] == original_label
        assert restored.json()["version"] == saved.json()["version"] + 1


def test_results_tables_are_independent(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    with _client(tmp_path, monkeypatch) as client:
        current = client.get("/api/tables").json()
        tables = current["tables"]
        by_id = _by_id(tables)
        by_id["herwerkte_resultatenrekening_full"]["rows"][0]["label"] = "Full only"
        by_id["herwerkte_resultatenrekening_verkort_micro"]["rows"][0]["label"] = (
            "Verkort shared"
        )
        saved = client.put(
            "/api/tables",
            json={"tables": tables, "version": current["version"]},
            headers=_auth(),
        )
        assert saved.status_code == 200, saved.text
        reloaded = _by_id(saved.json()["tables"])
        assert reloaded["herwerkte_resultatenrekening_full"]["rows"][0]["label"] == (
            "Full only"
        )
        assert reloaded["herwerkte_resultatenrekening_verkort_micro"]["rows"][0][
            "label"
        ] == "Verkort shared"


def test_validate_rejects_unknown_table_id() -> None:
    bundled = yaml.safe_load(BUNDLED_TABLES_PATH.read_text(encoding="utf-8"))
    bundled["tables"][0]["id"] = "unknown_table"
    with pytest.raises(ValueError, match="Onbekende tabel-id"):
        validate_tables_config(bundled["tables"])


def test_validate_accepts_row_indent_and_info() -> None:
    bundled = yaml.safe_load(BUNDLED_TABLES_PATH.read_text(encoding="utf-8"))
    bundled["tables"][0]["rows"][0]["indent"] = 2
    bundled["tables"][0]["rows"][0]["info"] = "Toelichting"
    validated = validate_tables_config(bundled["tables"])
    row = validated[0]["rows"][0]
    assert row["indent"] == 2
    assert row["info"] == "Toelichting"


def test_validate_accepts_divider_row() -> None:
    bundled = yaml.safe_load(BUNDLED_TABLES_PATH.read_text(encoding="utf-8"))
    table = bundled["tables"][0]
    table["rows"].insert(
        1,
        {"id": "cf-divider-1", "kind": "divider"},
    )
    validated = validate_tables_config(bundled["tables"])
    divider = validated[0]["rows"][1]
    assert divider["kind"] == "divider"
    assert divider["label"] == ""
    assert len(divider["cells"]) == len(validated[0]["columns"])
    assert divider["cells_by_model"] == {}
    assert "kind" not in validated[0]["rows"][0]


def test_validate_rejects_unknown_row_kind() -> None:
    bundled = yaml.safe_load(BUNDLED_TABLES_PATH.read_text(encoding="utf-8"))
    bundled["tables"][0]["rows"][0]["kind"] = "spacer"
    with pytest.raises(ValueError, match="onbekend rijtype"):
        validate_tables_config(bundled["tables"])


def test_validate_accepts_cells_by_model() -> None:
    bundled = yaml.safe_load(BUNDLED_TABLES_PATH.read_text(encoding="utf-8"))
    table = bundled["tables"][0]
    col_count = len(table["columns"])
    table["rows"][0]["cells_by_model"] = {
        "verkort": table["rows"][0]["cells"],
        "micro": ["mar:70", *([""] * (col_count - 1))],
    }
    validated = validate_tables_config(bundled["tables"])
    row = validated[0]["rows"][0]
    assert "verkort" in row["cells_by_model"]
    assert row["cells_by_model"]["micro"][0] == "mar:70"


def test_validate_rejects_invalid_indent() -> None:
    bundled = yaml.safe_load(BUNDLED_TABLES_PATH.read_text(encoding="utf-8"))
    bundled["tables"][0]["rows"][0]["indent"] = 99
    with pytest.raises(ValueError, match="indent moet tussen"):
        validate_tables_config(bundled["tables"])


def test_validate_rejects_empty_columns() -> None:
    bundled = yaml.safe_load(BUNDLED_TABLES_PATH.read_text(encoding="utf-8"))
    bundled["tables"][0]["columns"] = []
    bundled["tables"][0]["rows"][0]["cells"] = []
    with pytest.raises(ValueError, match="minstens één kolom"):
        validate_tables_config(bundled["tables"])


def test_sibling_path_when_tables_env_missing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("RATIOS_CONFIG_PATH", str(tmp_path / "ratios.yaml"))
    monkeypatch.delenv("TABLES_CONFIG_PATH", raising=False)
    from app.tables.store import override_path

    assert override_path() == tmp_path / "tables.yaml"
