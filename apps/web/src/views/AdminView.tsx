import { useCallback, useEffect, useState } from "react";
import { Copy, Database, HardDrive, History, RefreshCw, Shield, Trash2 } from "lucide-react";
import { formatBytes } from "@videocat/shared";
import { api } from "../lib/api";
import { dateLabel, formatCount } from "../lib/app-helpers";
import type { AdminDiskOverview, AdminPurgeResponse, CompanionAdminItem, CompanionPairingCode } from "../lib/app-types";
import type { Disk } from "../types";

type MaintenanceResponse = {
  retentionDays: { agentErrors: number; auditActions: number; scans: number };
  totals: { agentErrors: number; auditActions: number; scans: number };
  eligible: { agentErrors: number; auditActions: number; scans: number };
};

type PruneResponse = {
  ok: boolean;
  removed: { agentErrors: number; auditActions: number; scans: number };
};

type AdminViewProps = {
  locale: string;
  refreshKey: number;
  mountedDiskIds: string[];
  onDiskPurged: (disk: Disk) => void;
};

const onlineWindowMs = 45_000;

export function AdminView({ locale, refreshKey, mountedDiskIds, onDiskPurged }: AdminViewProps) {
  const [disks, setDisks] = useState<AdminDiskOverview[]>([]);
  const [companions, setCompanions] = useState<CompanionAdminItem[]>([]);
  const [maintenance, setMaintenance] = useState<MaintenanceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pairingCode, setPairingCode] = useState<CompanionPairingCode | null>(null);
  const [companionBusy, setCompanionBusy] = useState(false);
  const [pendingRevocation, setPendingRevocation] = useState<string | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<string | null>(null);
  const [purgeConfirmation, setPurgeConfirmation] = useState("");
  const [purgingDiskId, setPurgingDiskId] = useState<string | null>(null);
  const [pruning, setPruning] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [overview, companionList, maintenanceInfo] = await Promise.all([
        api<{ disks: AdminDiskOverview[] }>("/api/admin/disks/overview"),
        api<{ companions: CompanionAdminItem[] }>("/api/companions"),
        api<MaintenanceResponse>("/api/admin/maintenance")
      ]);
      setDisks(overview.disks);
      setCompanions(companionList.companions);
      setMaintenance(maintenanceInfo);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo cargar la administración.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  async function createPairingCode() {
    setCompanionBusy(true);
    setError("");
    try {
      setPairingCode(await api<CompanionPairingCode>("/api/companions/pairing-code", { method: "POST", body: JSON.stringify({}) }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo generar el código de emparejamiento.");
    } finally {
      setCompanionBusy(false);
    }
  }

  async function revokeCompanion(id: string) {
    setCompanionBusy(true);
    setError("");
    try {
      await api(`/api/companions/${id}/revoke`, { method: "POST", body: JSON.stringify({}) });
      setPendingRevocation(null);
      setPairingCode(null);
      setMessage("Companion revocado. Tendrá que emparejarse de nuevo para conectarse.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo revocar el Companion.");
    } finally {
      setCompanionBusy(false);
    }
  }

  async function purgeDisk(disk: Disk) {
    setPurgingDiskId(disk.id);
    setMessage("");
    setError("");
    try {
      const response = await api<AdminPurgeResponse>(`/api/admin/disks/${disk.id}/catalog`, { method: "DELETE" });
      setPurgeTarget(null);
      setPurgeConfirmation("");
      setMessage(
        `Unidad "${response.disk.name}" limpia: ${response.deleted.files} videos, ${response.deleted.thumbnails} miniaturas, ` +
        `${response.deleted.errors} errores y ${response.deleted.scans} escaneos eliminados.` +
        (response.thumbnailFilesRemoved ? "" : ` Aviso: ${response.thumbnailFileWarning ?? "no se pudieron eliminar algunas miniaturas"}.`)
      );
      onDiskPurged(disk);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo limpiar la unidad.");
    } finally {
      setPurgingDiskId(null);
    }
  }

  async function pruneHistory() {
    setPruning(true);
    setMessage("");
    setError("");
    try {
      const response = await api<PruneResponse>("/api/admin/maintenance/prune", { method: "POST", body: JSON.stringify({}) });
      setMessage(
        `Retención aplicada: ${response.removed.agentErrors} errores, ${response.removed.auditActions} acciones y ${response.removed.scans} escaneos eliminados.`
      );
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo aplicar la retención.");
    } finally {
      setPruning(false);
    }
  }

  return (
    <section className="vc-view vc-admin" aria-label="Administración">
      {message ? <div className="vc-notice" role="status">{message}</div> : null}
      {error ? <div className="form-error">{error}</div> : null}

      <section className="vc-panel" aria-labelledby="admin-companions-title">
        <div className="vc-panel-head">
          <div>
            <h2 id="admin-companions-title">Companions</h2>
            <p>Cada PC se empareja con un código de un solo uso y recibe una credencial propia, cifrada y revocable.</p>
          </div>
          <button className="vc-button is-primary" disabled={companionBusy} onClick={() => void createPairingCode()} type="button">
            <Shield size={16} />
            Generar código
          </button>
        </div>
        <div className="vc-panel-body">
          {pairingCode ? (
            <div className="vc-pairing-code">
              <div>
                <span>Código de un solo uso</span>
                <strong>{pairingCode.code}</strong>
                <small>{`Expira a las ${new Date(pairingCode.expiresAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}. Ingrésalo en la configuración del Companion.`}</small>
              </div>
              <button
                className="vc-icon-button"
                onClick={() => {
                  void navigator.clipboard.writeText(pairingCode.code);
                  setMessage("Código de emparejamiento copiado.");
                }}
                aria-label="Copiar código"
                title="Copiar código"
                type="button"
              >
                <Copy size={17} />
              </button>
            </div>
          ) : null}
          <div className="vc-companion-list">
            {companions.map((companion) => {
              const online = !companion.revokedAt && Date.now() - new Date(companion.lastSeenAt).getTime() <= onlineWindowMs;
              const tunnel = companion.tunnel?.connected === true;
              return (
                <article className="vc-companion-row" key={companion.installationId}>
                  <span className={`vc-disk-dot ${online ? "is-mounted" : ""}`} aria-hidden="true" />
                  <div className="vc-companion-identity">
                    <strong>{companion.name || "VideoCAT Companion"}</strong>
                    <span>{`v${companion.version} · visto ${dateLabel(companion.lastSeenAt, locale)}`}</span>
                  </div>
                  <div className="vc-companion-badges">
                    <span className={`vc-badge ${companion.revokedAt ? "is-danger" : companion.authMode === "paired" ? "is-success" : "is-warning"}`}>
                      {companion.revokedAt ? "Revocado" : companion.authMode === "paired" ? "Credencial individual" : "Token heredado"}
                    </span>
                    <span className={`vc-badge ${tunnel ? "is-success" : ""}`}>{tunnel ? "Túnel seguro activo" : "Sin túnel"}</span>
                    {companion.tunnel?.capabilities?.streamRead ? <span className="vc-badge">Reproducción remota</span> : null}
                  </div>
                  {pendingRevocation === companion.installationId ? (
                    <div className="vc-inline-confirm">
                      <span>¿Revocar acceso?</span>
                      <button className="vc-button is-small is-danger" disabled={companionBusy} onClick={() => void revokeCompanion(companion.installationId)} type="button">Revocar</button>
                      <button className="vc-button is-small" onClick={() => setPendingRevocation(null)} type="button">Cancelar</button>
                    </div>
                  ) : (
                    <button
                      className="vc-icon-button is-ghost"
                      disabled={Boolean(companion.revokedAt) || companionBusy}
                      onClick={() => setPendingRevocation(companion.installationId)}
                      aria-label="Revocar Companion"
                      title="Revocar Companion"
                      type="button"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </article>
              );
            })}
            {!loading && companions.length === 0 ? <div className="empty">Todavía no hay Companions registrados.</div> : null}
          </div>
        </div>
      </section>

      <section className="vc-panel" aria-labelledby="admin-disks-title">
        <div className="vc-panel-head">
          <div>
            <h2 id="admin-disks-title">Discos</h2>
            <p>Uso físico reportado por el Companion y contenido catalogado. Vaciar el catálogo no borra archivos del disco.</p>
          </div>
          <button className="vc-icon-button" disabled={loading} onClick={() => void load()} aria-label="Actualizar" title="Actualizar" type="button">
            <RefreshCw size={16} />
          </button>
        </div>
        <div className="vc-admin-disks">
          {loading && disks.length === 0 ? <div className="loading">Cargando...</div> : null}
          {disks.map((item) => {
            const { disk } = item;
            const totalBytes = item.storage.totalBytes ?? disk.totalBytes ?? null;
            const freeBytes = item.storage.freeBytes ?? disk.freeBytes ?? null;
            const usedBytes = item.storage.usedBytes ?? (totalBytes != null && freeBytes != null ? totalBytes - freeBytes : null);
            const usedPercent = totalBytes && usedBytes != null ? Math.min(100, Math.max(0, (usedBytes / totalBytes) * 100)) : 0;
            const catalogPercent = totalBytes ? Math.min(100, (item.storage.catalogedBytes / totalBytes) * 100) : 0;
            const connected = mountedDiskIds.includes(disk.id);
            const confirming = purgeTarget === disk.id;
            return (
              <article className="vc-admin-disk" key={disk.id}>
                <header>
                  <HardDrive size={18} aria-hidden="true" />
                  <div>
                    <strong>{disk.name}</strong>
                    <span>{[disk.driveLetter, disk.fileSystem].filter(Boolean).join(" · ") || "Sin datos del volumen"}</span>
                  </div>
                  <span className={`vc-badge ${connected ? "is-success" : ""}`}>{connected ? "Conectado" : "Desconectado"}</span>
                </header>

                <div className="vc-admin-storage">
                  <div className="vc-admin-storage-head">
                    <span>Uso físico</span>
                    <strong>{totalBytes ? `${Math.round(usedPercent)}%` : "Sin reporte"}</strong>
                  </div>
                  <div className="vc-admin-storage-bar" aria-hidden="true">
                    <span className="is-used" style={{ width: `${usedPercent}%` }} />
                    <span className="is-catalog" style={{ width: `${catalogPercent}%` }} />
                  </div>
                  <div className="vc-admin-legend">
                    <span><i className="is-used" />{`Usado ${usedBytes != null ? formatBytes(usedBytes) : "-"}`}</span>
                    <span><i className="is-catalog" />{`Catalogado ${formatBytes(item.storage.catalogedBytes)}`}</span>
                    <span>{`Libre ${freeBytes != null ? formatBytes(freeBytes) : "-"} de ${totalBytes != null ? formatBytes(totalBytes) : "-"}`}</span>
                  </div>
                </div>

                <dl className="vc-admin-stats">
                  <div><dt>Videos</dt><dd>{formatCount(item.catalog.presentFiles)}</dd></div>
                  <div><dt>No encontrados</dt><dd>{formatCount(item.catalog.missingFiles)}</dd></div>
                  <div><dt>Escaneos</dt><dd>{formatCount(item.catalog.scanCount)}</dd></div>
                  <div><dt>Errores</dt><dd>{formatCount(item.catalog.errorCount)}</dd></div>
                </dl>
                <p className="vc-admin-indexed">{`Último indexado: ${dateLabel(disk.lastScannedAt, locale)}`}</p>

                <details className="vc-admin-activity">
                  <summary><History size={14} aria-hidden="true" /> Actividad reciente</summary>
                  {item.recentActions.length > 0 ? item.recentActions.map((action) => (
                    <div className="vc-admin-activity-row" key={`${action.type}:${action.id}`}>
                      {action.type === "deletion" ? <Trash2 size={13} aria-hidden="true" /> : <Database size={13} aria-hidden="true" />}
                      <span>
                        {action.type === "deletion"
                          ? `${action.status === "deleted" ? "Eliminado" : "Borrado"}: ${action.filename ?? "-"} · ${formatBytes(action.sizeBytes ?? 0)}`
                          : `Escaneo ${action.status} · ${action.fileCount ?? 0} archivos · ${action.errorCount ?? 0} errores`}
                      </span>
                      <time>{dateLabel(action.occurredAt, locale)}</time>
                    </div>
                  )) : <span className="vc-review-muted">Sin actividad registrada.</span>}
                </details>

                {confirming ? (
                  <form
                    className="vc-danger-confirm"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (purgeConfirmation === "BORRAR") void purgeDisk(disk);
                    }}
                  >
                    <label htmlFor={`purge-${disk.id}`}>
                      {`Se eliminarán de VideoCAT los videos, miniaturas, escaneos y errores de "${disk.name}". Escribe BORRAR para confirmar.`}
                    </label>
                    <div>
                      <input
                        id={`purge-${disk.id}`}
                        value={purgeConfirmation}
                        onChange={(event) => setPurgeConfirmation(event.target.value)}
                        autoComplete="off"
                        placeholder="BORRAR"
                      />
                      <button className="vc-button is-danger" disabled={purgeConfirmation !== "BORRAR" || purgingDiskId === disk.id} type="submit">
                        {purgingDiskId === disk.id ? "Limpiando..." : "Vaciar catálogo"}
                      </button>
                      <button className="vc-button" onClick={() => { setPurgeTarget(null); setPurgeConfirmation(""); }} type="button">Cancelar</button>
                    </div>
                  </form>
                ) : (
                  <button className="vc-button is-danger-ghost" onClick={() => { setPurgeTarget(disk.id); setPurgeConfirmation(""); }} type="button">
                    <Trash2 size={15} />
                    Vaciar catálogo
                  </button>
                )}
              </article>
            );
          })}
        </div>
      </section>

      <section className="vc-panel" aria-labelledby="admin-maintenance-title">
        <div className="vc-panel-head">
          <div>
            <h2 id="admin-maintenance-title">Mantenimiento</h2>
            <p>La retención elimina historial antiguo. Nunca borra videos catalogados ni miniaturas.</p>
          </div>
          <button className="vc-button" disabled={pruning || !maintenance} onClick={() => void pruneHistory()} type="button">
            {pruning ? "Aplicando..." : "Aplicar retención ahora"}
          </button>
        </div>
        {maintenance ? (
          <dl className="vc-admin-retention">
            {([
              ["Errores del agente", "agentErrors"],
              ["Registro de acciones", "auditActions"],
              ["Escaneos", "scans"]
            ] as const).map(([label, key]) => (
              <div key={key}>
                <dt>{label}</dt>
                <dd>
                  <strong>{`${maintenance.retentionDays[key]} días`}</strong>
                  <span>{`${formatCount(maintenance.totals[key])} registros · ${formatCount(maintenance.eligible[key])} vencidos`}</span>
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
      </section>
    </section>
  );
}
