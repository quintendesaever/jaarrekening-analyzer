import { useEffect, useMemo, useState } from "react";
import {
  ApiError,
  getRatiosConfig,
  getTablesConfig,
  getTablesHistory,
  resetTablesConfig,
  restoreTablesHistory,
  saveTablesConfig,
} from "../api/client";
import type {
  FinancialTableConfig,
  ModelKind,
  RatioSpec,
  TableHistoryEntry,
  TabellenViewId,
  TablesConfigMeta,
} from "../types";
import {
  MODEL_LABELS,
  tableIdForView,
  VIEW_ITEMS,
  type ResultGroup,
} from "../tables/views";
import { tableHasModelOverrides } from "../tables/rowCells";
import {
  addTableColumn,
  addTableRow,
  EditableFinancialTable,
} from "./EditableFinancialTable";
import { PlusIcon, ResetIcon, SaveIcon } from "./icons";
import { ConfigPanelHeader } from "./ConfigPanelHeader";
import { SubTabs } from "./SubTabs";

const ADMIN_TOKEN_KEY = "ratioConfigAdminToken";

function loadAdminToken(): string {
  return sessionStorage.getItem(ADMIN_TOKEN_KEY) ?? "";
}

function persistAdminToken(token: string) {
  if (token) {
    sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
  } else {
    sessionStorage.removeItem(ADMIN_TOKEN_KEY);
  }
}

function formatUpdatedAt(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("nl-BE");
}

function cloneTables(tables: FinancialTableConfig[]): FinancialTableConfig[] {
  return tables.map((table) => ({
    ...table,
    model_scope: [...table.model_scope],
    columns: table.columns.map((column) => ({ ...column })),
    rows: table.rows.map((row) => ({
      ...row,
      cells: [...row.cells],
      cells_by_model: row.cells_by_model
        ? Object.fromEntries(
            Object.entries(row.cells_by_model).map(([kind, cells]) => [
              kind,
              [...cells],
            ]),
          )
        : undefined,
    })),
  }));
}

function serializeTables(tables: FinancialTableConfig[]): string {
  return JSON.stringify(tables);
}

function mapWriteError(err: unknown): string {
  if (err instanceof ApiError && err.status === 401) {
    return "Ongeldig admin-wachtwoord.";
  }
  if (err instanceof ApiError && err.status === 409) {
    return err.message;
  }
  if (err instanceof ApiError && err.status === 422) {
    return err.message;
  }
  if (err instanceof ApiError && err.status === 503) {
    return err.message;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return "Netwerkfout. Probeer opnieuw.";
}

interface TableConfigPanelProps {
  onDirtyChange?: (dirty: boolean) => void;
}

export function TableConfigPanel({ onDirtyChange }: TableConfigPanelProps) {
  const [adminToken, setAdminToken] = useState(loadAdminToken);
  const [draft, setDraft] = useState<FinancialTableConfig[]>([]);
  const [saved, setSaved] = useState<FinancialTableConfig[]>([]);
  const [meta, setMeta] = useState<Pick<
    TablesConfigMeta,
    "source" | "version" | "updated_at"
  > | null>(null);
  const [history, setHistory] = useState<TableHistoryEntry[]>([]);
  const [view, setView] = useState<TabellenViewId>("cashflow");
  const [resultGroup, setResultGroup] = useState<ResultGroup>("full");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [ratioSpecs, setRatioSpecs] = useState<RatioSpec[]>([]);
  // null = "all models" mode (edits shared row.cells); a specific kind = override mode
  const [editModel, setEditModel] = useState<ModelKind | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  const dirty = useMemo(
    () => serializeTables(draft) !== serializeTables(saved),
    [draft, saved],
  );

  const activeTableId = tableIdForView(view, resultGroup);
  const activeTable = draft.find((table) => table.id === activeTableId) ?? null;

  useEffect(() => {
    // Reset to all-mode when switching tables
    setEditModel(null);
  }, [activeTable?.id]);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    return () => onDirtyChange?.(false);
  }, [onDirtyChange]);

  function applyServerConfig(config: TablesConfigMeta) {
    const tables = cloneTables(config.tables);
    setDraft(tables);
    setSaved(cloneTables(tables));
    setMeta({
      source: config.source,
      version: config.version,
      updated_at: config.updated_at,
    });
  }

  async function loadConfig() {
    setLoading(true);
    setError(null);
    try {
      const config = await getTablesConfig();
      applyServerConfig(config);
      const items = await getTablesHistory().catch(() => [] as TableHistoryEntry[]);
      setHistory(items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kon configuratie niet laden.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadConfig();
    void getRatiosConfig()
      .then(setRatioSpecs)
      .catch(() => setRatioSpecs([]));
  }, []);

  function handleTokenChange(value: string) {
    setAdminToken(value);
    persistAdminToken(value);
  }

  function updateActiveTable(next: FinancialTableConfig) {
    setDraft((current) =>
      current.map((table) => (table.id === next.id ? next : table)),
    );
  }

  async function handleSave() {
    if (!adminToken.trim()) {
      setError("Vul het admin-wachtwoord in om op te slaan.");
      return;
    }
    if (!meta) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await saveTablesConfig(
        draft,
        adminToken.trim(),
        meta.version,
      );
      applyServerConfig(result);
      setHistory(await getTablesHistory().catch(() => []));
      setNotice("Alle tabelconfiguraties zijn opgeslagen.");
    } catch (err) {
      setError(mapWriteError(err));
    } finally {
      setSaving(false);
    }
  }

  function handleDiscard() {
    if (
      !window.confirm(
        "Niet-opgeslagen wijzigingen in alle tabelconfiguraties verwerpen?",
      )
    ) {
      return;
    }
    setDraft(cloneTables(saved));
    setError(null);
    setNotice("Wijzigingen verworpen.");
  }

  async function handleReset() {
    if (!adminToken.trim()) {
      setError("Vul het admin-wachtwoord in om te resetten.");
      return;
    }
    if (
      !window.confirm(
        "De actieve configuratie wordt vervangen door de standaard tables.yaml. Alle vier de tabellen worden hersteld. Doorgaan?",
      )
    ) {
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await resetTablesConfig(adminToken.trim());
      applyServerConfig(result);
      setHistory(await getTablesHistory().catch(() => []));
      setNotice("Standaardconfiguratie hersteld.");
    } catch (err) {
      setError(mapWriteError(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleRestore(version: number) {
    if (!adminToken.trim()) {
      setError("Vul het admin-wachtwoord in om een snapshot te herstellen.");
      return;
    }
    if (
      !window.confirm(
        `Snapshot versie ${version} terugzetten als nieuwe actieve configuratie? Alle vier de tabellen worden hersteld.`,
      )
    ) {
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await restoreTablesHistory(version, adminToken.trim());
      applyServerConfig(result);
      setHistory(await getTablesHistory().catch(() => []));
      setNotice(`Versie ${version} hersteld als nieuwe configuratie.`);
    } catch (err) {
      setError(mapWriteError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-w-0 space-y-3">
      <ConfigPanelHeader
        title="Tabellen configuratie"
        summary="Bewerk de herwerkte tabellen voor alle gebruikers."
        meta={
          meta
            ? `· v${meta.version} · ${meta.source === "saved" ? "opgeslagen" : "standaard"}`
            : undefined
        }
        dirty={dirty}
        helpOpen={helpOpen}
        onHelpToggle={() => setHelpOpen((open) => !open)}
        adminToken={adminToken}
        onAdminTokenChange={handleTokenChange}
        helpContent={
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="font-medium text-slate-700">Celverwijzingen</p>
                <ul className="mt-1.5 space-y-1 text-xs leading-relaxed">
                  <li>
                    <code className="rounded bg-slate-100 px-1 font-mono">mar:29/58</code>{" "}
                    — bedrag uit PDF
                  </li>
                  <li>
                    <code className="rounded bg-slate-100 px-1 font-mono">ratio:id</code>{" "}
                    — berekende ratio
                  </li>
                  <li>
                    <code className="rounded bg-slate-100 px-1 font-mono">cell:boekjaar</code>{" "}
                    — andere kolom
                  </li>
                  <li>
                    <code className="rounded bg-slate-100 px-1 font-mono">pct:vorig,boekjaar</code>{" "}
                    — % verschil
                  </li>
                  <li>Typ een prefix voor suggesties.</li>
                </ul>
              </div>
              <div>
                <p className="font-medium text-slate-700">Rij &amp; model</p>
                <ul className="mt-1.5 space-y-1 text-xs leading-relaxed">
                  <li>
                    <span className="font-semibold">i</span> — toelichting rechts van de rijnaam
                  </li>
                  <li>← → — inspringing</li>
                  <li>
                    Selecteer één of meerdere modellen om tegelijk te bewerken
                  </li>
                  <li>Opslaan schrijft alle vier tabellen als één versie.</li>
                </ul>
              </div>
            </div>
            <div className="mt-3 grid gap-3 border-t border-slate-100 pt-3 sm:grid-cols-2">
              <label className="block text-xs font-medium text-slate-600">
                Admin-wachtwoord
                <input
                  type="password"
                  value={adminToken}
                  autoComplete="off"
                  onChange={(event) => handleTokenChange(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900"
                />
              </label>
              <div className="text-xs text-slate-500">
                <p>Laatst bijgewerkt: {formatUpdatedAt(meta?.updated_at ?? null)}</p>
              </div>
            </div>
          </>
        }
        toolbar={
          <>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving || loading || !dirty || !adminToken.trim()}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              <SaveIcon />
              {saving ? "Opslaan…" : "Opslaan"}
            </button>
            <button
              type="button"
              onClick={handleDiscard}
              disabled={saving || loading || !dirty}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-sm font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-50"
            >
              Verwerpen
            </button>
            <button
              type="button"
              onClick={() => void handleReset()}
              disabled={saving || loading || !adminToken.trim()}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-sm font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-50"
            >
              <ResetIcon />
              Reset
            </button>
          </>
        }
      />

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {notice}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="space-y-3 border-b border-slate-100 p-3">
          <SubTabs items={VIEW_ITEMS} value={view} onChange={setView} />

          {view === "herwerkte_resultatenrekening" && (
            <div
              role="group"
              aria-label="Resultatenrekening variant"
              className="inline-flex overflow-hidden rounded-lg ring-1 ring-slate-200"
            >
              <button
                type="button"
                onClick={() => setResultGroup("full")}
                className={`px-3 py-1.5 text-sm font-medium ${
                  resultGroup === "full"
                    ? "bg-slate-800 text-white"
                    : "bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {MODEL_LABELS.full}
              </button>
              <button
                type="button"
                onClick={() => setResultGroup("verkort_micro")}
                className={`px-3 py-1.5 text-sm font-medium ${
                  resultGroup === "verkort_micro"
                    ? "bg-slate-800 text-white"
                    : "bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                Verkort + Micro
              </button>
            </div>
          )}

          {activeTable && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              {activeTable.model_scope.length > 1 && (
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
                    Bewerk
                  </span>
                  <div role="group" aria-label="Model bewerken" className="inline-flex flex-wrap gap-1">
                    {/* "Alle" = null / all-mode */}
                    <button
                      type="button"
                      aria-pressed={editModel === null}
                      onClick={() => setEditModel(null)}
                      className={`inline-flex items-center rounded-md px-2.5 py-1 text-sm font-medium ring-1 ${
                        editModel === null
                          ? "bg-slate-800 text-white ring-slate-800"
                          : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      Alle
                    </button>
                    {activeTable.model_scope.map((kind) => {
                      const hasOverrides = tableHasModelOverrides(activeTable.rows, kind);
                      return (
                        <button
                          key={kind}
                          type="button"
                          aria-pressed={editModel === kind}
                          onClick={() =>
                            setEditModel((prev) => (prev === kind ? null : kind))
                          }
                          className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-sm font-medium ring-1 ${
                            editModel === kind
                              ? "bg-slate-800 text-white ring-slate-800"
                              : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50"
                          }`}
                        >
                          {MODEL_LABELS[kind]}
                          {hasOverrides && (
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${
                                editModel === kind ? "bg-emerald-300" : "bg-emerald-500"
                              }`}
                              title="Heeft model-specifieke waarden"
                            />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              <div className="flex shrink-0 gap-1.5">
                <button
                  type="button"
                  disabled={saving || loading}
                  onClick={() => updateActiveTable(addTableRow(activeTable))}
                  className="inline-flex h-8 items-center gap-1 rounded-lg bg-white px-2.5 text-sm font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-50"
                >
                  <PlusIcon />
                  Rij
                </button>
                <button
                  type="button"
                  disabled={saving || loading}
                  onClick={() => updateActiveTable(addTableColumn(activeTable))}
                  className="inline-flex h-8 items-center gap-1 rounded-lg bg-white px-2.5 text-sm font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-50"
                >
                  <PlusIcon />
                  Kolom
                </button>
              </div>
            </div>
          )}
        </div>

        {activeTable && (
          <EditableFinancialTable
            table={activeTable}
            onChange={updateActiveTable}
            disabled={saving || loading}
            editable={true}
            ratioSpecs={ratioSpecs}
            activeModel={editModel}
          />
        )}

        {loading && (
          <p className="p-3 text-sm text-slate-600">Configuratie laden…</p>
        )}
      </div>

      {history.length > 0 && (
        <details className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-800">
            Geschiedenis ({history.length})
          </summary>
          <ul className="space-y-2 border-t border-slate-100 px-4 py-3">
            {history.slice(0, 20).map((item) => (
              <li
                key={item.version}
                className="flex flex-wrap items-center justify-between gap-2 text-sm"
              >
                <span className="text-slate-700">
                  v{item.version}
                  <span className="ml-2 text-slate-500">
                    {formatUpdatedAt(item.updated_at)}
                  </span>
                </span>
                <button
                  type="button"
                  disabled={saving || !adminToken.trim()}
                  onClick={() => void handleRestore(item.version)}
                  className="rounded-lg bg-white px-2.5 py-1 text-sm font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-50"
                >
                  Herstellen
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
