import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Download, ListChecks, Search } from "lucide-react";
import { api } from "../lib/api";
import { dateLabel, formatCount } from "../lib/app-helpers";

type AuditTab = "errors" | "actions";

type AuditErrorRow = {
  id: string;
  diskName: string;
  category: string;
  phase: string;
  code: string | null;
  message: string;
  relativePath: string | null;
  createdAt: string;
};

type AuditErrorGroup = {
  key: string;
  diskName: string;
  category: string;
  phase: string;
  code: string | null;
  message: string;
  count: number;
  firstAt: string;
  lastAt: string;
  samplePath: string | null;
};

type AuditErrorsResponse = {
  total: number;
  summary: Array<{ category: string; phase: string; count: number }>;
  errors: AuditErrorRow[];
  groups?: AuditErrorGroup[];
  nextCursor: string | null;
};

type AuditActionRow = {
  id: string;
  action: string;
  status: "started" | "succeeded" | "failed";
  actorType: string;
  actorId: string | null;
  target: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
};

type AuditActionsResponse = {
  actions: AuditActionRow[];
  nextCursor: string | null;
};

type AuditViewProps = {
  diskQuery: string;
  noDisksSelected: boolean;
  refreshKey: number;
  locale: string;
};

const ageOptions = [
  { value: "", label: "Todo el historial" },
  { value: "1", label: "Últimas 24 horas" },
  { value: "7", label: "Últimos 7 días" },
  { value: "30", label: "Últimos 30 días" },
  { value: "90", label: "Últimos 90 días" }
];

const actionLabels: Record<string, string> = {
  "file.delete": "Borrado de archivo",
  "scan.finish": "Escaneo finalizado",
  "download.queue.clear": "Cola de descargas vaciada",
  "download.history.clear": "Historial de descargas limpiado",
  "maintenance.prune": "Limpieza por retención"
};

const statusLabels: Record<AuditActionRow["status"], string> = {
  started: "En curso",
  succeeded: "Completada",
  failed: "Fallida"
};

function useDebouncedValue(value: string, delay = 300): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [delay, value]);
  return debounced;
}

export function AuditView({ diskQuery, noDisksSelected, refreshKey, locale }: AuditViewProps) {
  const [tab, setTab] = useState<AuditTab>("errors");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [sinceDays, setSinceDays] = useState("");
  const [grouped, setGrouped] = useState(true);
  const [status, setStatus] = useState("");
  const [errorsData, setErrorsData] = useState<AuditErrorsResponse | null>(null);
  const [actions, setActions] = useState<AuditActionRow[]>([]);
  const [actionsCursor, setActionsCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failure, setFailure] = useState("");
  const q = useDebouncedValue(search.trim());

  const params = useMemo(() => {
    const result = new URLSearchParams();
    if (q) result.set("q", q);
    if (sinceDays) result.set("sinceDays", sinceDays);
    if (tab === "errors") {
      if (diskQuery) result.set("diskIds", diskQuery);
      if (category) result.set("category", category);
    } else if (status) {
      result.set("status", status);
    }
    return result;
  }, [category, diskQuery, q, sinceDays, status, tab]);

  useEffect(() => {
    if (tab === "errors" && noDisksSelected) {
      setErrorsData(null);
      return;
    }
    let active = true;
    setLoading(true);
    setFailure("");
    const request = tab === "errors"
      ? api<AuditErrorsResponse>(`/api/audit/errors?${params.toString()}&limit=100${grouped ? "&grouped=true" : ""}`).then((response) => {
        if (active) setErrorsData(response);
      })
      : api<AuditActionsResponse>(`/api/audit/actions?${params.toString()}&limit=100`).then((response) => {
        if (!active) return;
        setActions(response.actions);
        setActionsCursor(response.nextCursor);
      });
    request
      .catch((reason) => {
        if (active) setFailure(reason instanceof Error ? reason.message : "No se pudo cargar la auditoría.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [grouped, noDisksSelected, params, refreshKey, tab]);

  // Each tab searches different fields, so a search does not carry over.
  function switchTab(next: AuditTab) {
    if (next === tab) return;
    setSearch("");
    setTab(next);
  }

  async function loadMore() {
    setLoadingMore(true);
    try {
      if (tab === "errors" && errorsData?.nextCursor) {
        const response = await api<AuditErrorsResponse>(`/api/audit/errors?${params.toString()}&limit=100&cursor=${errorsData.nextCursor}`);
        setErrorsData({ ...response, errors: [...errorsData.errors, ...response.errors] });
      } else if (tab === "actions" && actionsCursor) {
        const response = await api<AuditActionsResponse>(`/api/audit/actions?${params.toString()}&limit=100&cursor=${actionsCursor}`);
        setActions((current) => [...current, ...response.actions]);
        setActionsCursor(response.nextCursor);
      }
    } catch (reason) {
      setFailure(reason instanceof Error ? reason.message : "No se pudieron cargar más registros.");
    } finally {
      setLoadingMore(false);
    }
  }

  const categories = useMemo(() => {
    const totals = new Map<string, number>();
    for (const item of errorsData?.summary ?? []) totals.set(item.category, (totals.get(item.category) ?? 0) + item.count);
    return [...totals.entries()].sort((left, right) => right[1] - left[1]);
  }, [errorsData?.summary]);

  const exportHref = `/api/audit/export?type=${tab}&${params.toString()}`;
  const hasMore = tab === "errors" ? Boolean(!grouped && errorsData?.nextCursor) : Boolean(actionsCursor);

  return (
    <section className="vc-view vc-audit" aria-label="Auditoría">
      <div className="vc-tabs" role="tablist" aria-label="Tipo de registro">
        <button role="tab" aria-selected={tab === "errors"} className={tab === "errors" ? "is-active" : ""} onClick={() => switchTab("errors")} type="button">
          <AlertTriangle size={16} />
          Errores del agente
          {errorsData ? <span className="vc-tab-count">{formatCount(errorsData.total)}</span> : null}
        </button>
        <button role="tab" aria-selected={tab === "actions"} className={tab === "actions" ? "is-active" : ""} onClick={() => switchTab("actions")} type="button">
          <ListChecks size={16} />
          Registro de acciones
        </button>
      </div>

      <div className="vc-panel vc-audit-toolbar">
        <label className="vc-search is-inline">
          <Search size={16} aria-hidden="true" />
          <span className="vc-visually-hidden">Buscar en la auditoría</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={tab === "errors" ? "Buscar mensaje, ruta o código" : "Buscar acción, objetivo o error"}
          />
        </label>
        {tab === "errors" ? (
          <label className="vc-inline-field">
            <span>Categoría</span>
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="">Todas</option>
              {categories.map(([name, count]) => <option key={name} value={name}>{`${name} (${count})`}</option>)}
            </select>
          </label>
        ) : (
          <label className="vc-inline-field">
            <span>Estado</span>
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">Todos</option>
              <option value="succeeded">Completadas</option>
              <option value="failed">Fallidas</option>
              <option value="started">En curso</option>
            </select>
          </label>
        )}
        <label className="vc-inline-field">
          <span>Antigüedad</span>
          <select value={sinceDays} onChange={(event) => setSinceDays(event.target.value)}>
            {ageOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        {tab === "errors" ? (
          <label className="vc-switch">
            <input type="checkbox" checked={grouped} onChange={(event) => setGrouped(event.target.checked)} />
            <span>Agrupar repetidos</span>
          </label>
        ) : null}
        <span className="vc-toolbar-spacer" />
        <a className="vc-button is-small" href={exportHref} download>
          <Download size={14} />
          Exportar CSV
        </a>
      </div>

      {tab === "errors" && errorsData && errorsData.summary.length > 0 ? (
        <div className="vc-audit-summary" aria-label="Resumen por categoría y fase">
          {errorsData.summary.slice(0, 8).map((item) => (
            <button
              key={`${item.category}:${item.phase}`}
              className={`vc-filter-chip ${category === item.category ? "is-active" : ""}`}
              onClick={() => setCategory(category === item.category ? "" : item.category)}
              type="button"
            >
              <span>{`${item.category} · ${item.phase}`}</span>
              <strong>{formatCount(item.count)}</strong>
            </button>
          ))}
        </div>
      ) : null}

      {failure ? <div className="form-error">{failure}</div> : null}
      {tab === "errors" && noDisksSelected ? <div className="empty">Selecciona al menos un disco para ver sus errores.</div> : null}
      {loading && !errorsData && tab === "errors" ? <div className="loading">Cargando...</div> : null}

      {tab === "errors" && errorsData ? (
        <div className={`vc-panel vc-audit-list ${loading ? "is-loading" : ""}`}>
          {grouped ? (
            (errorsData.groups ?? []).map((group) => (
              <details className="vc-audit-row" key={group.key}>
                <summary>
                  <span className="vc-audit-count" title="Repeticiones">{formatCount(group.count)}×</span>
                  <span className="vc-audit-main">
                    <strong>{group.message}</strong>
                    <span>{`${group.diskName} · ${group.category} · ${group.phase}${group.code ? ` · ${group.code}` : ""}`}</span>
                  </span>
                  <span className="vc-audit-date">{dateLabel(group.lastAt, locale)}</span>
                </summary>
                <dl className="vc-audit-detail">
                  <div><dt>Primera vez</dt><dd>{dateLabel(group.firstAt, locale)}</dd></div>
                  <div><dt>Última vez</dt><dd>{dateLabel(group.lastAt, locale)}</dd></div>
                  <div className="is-wide"><dt>Ruta de ejemplo</dt><dd>{group.samplePath ?? "-"}</dd></div>
                </dl>
              </details>
            ))
          ) : (
            errorsData.errors.map((error) => (
              <details className="vc-audit-row" key={error.id}>
                <summary>
                  <span className={`vc-audit-badge is-${error.category}`}>{error.category}</span>
                  <span className="vc-audit-main">
                    <strong>{error.message}</strong>
                    <span>{`${error.diskName} · ${error.phase}${error.code ? ` · ${error.code}` : ""}`}</span>
                  </span>
                  <span className="vc-audit-date">{dateLabel(error.createdAt, locale)}</span>
                </summary>
                <dl className="vc-audit-detail">
                  <div className="is-wide"><dt>Ruta</dt><dd>{error.relativePath ?? "-"}</dd></div>
                  <div className="is-wide"><dt>Mensaje completo</dt><dd>{error.message}</dd></div>
                </dl>
              </details>
            ))
          )}
          {(grouped ? (errorsData.groups ?? []).length : errorsData.errors.length) === 0 && !loading ? (
            <div className="empty">No hay errores registrados para estos filtros.</div>
          ) : null}
        </div>
      ) : null}

      {tab === "actions" ? (
        <div className={`vc-panel vc-audit-list ${loading ? "is-loading" : ""}`}>
          {actions.map((action) => (
            <details className="vc-audit-row" key={action.id}>
              <summary>
                <span className={`vc-audit-status is-${action.status}`}>{statusLabels[action.status]}</span>
                <span className="vc-audit-main">
                  <strong>{actionLabels[action.action] ?? action.action}</strong>
                  <span>{[action.target, action.actorType === "companion" ? "Companion" : action.actorId ?? action.actorType].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="vc-audit-date">{dateLabel(action.createdAt, locale)}</span>
              </summary>
              <dl className="vc-audit-detail">
                <div><dt>Acción</dt><dd>{action.action}</dd></div>
                <div><dt>Completada</dt><dd>{action.completedAt ? dateLabel(action.completedAt, locale) : "-"}</dd></div>
                {action.errorMessage ? <div className="is-wide"><dt>Error</dt><dd>{`${action.errorCode ? `${action.errorCode}: ` : ""}${action.errorMessage}`}</dd></div> : null}
              </dl>
            </details>
          ))}
          {actions.length === 0 && !loading ? <div className="empty">No hay acciones registradas para estos filtros.</div> : null}
        </div>
      ) : null}

      {hasMore ? (
        <button className="vc-button vc-load-more" disabled={loadingMore} onClick={() => void loadMore()} type="button">
          {loadingMore ? "Cargando..." : "Cargar más"}
        </button>
      ) : null}
    </section>
  );
}
