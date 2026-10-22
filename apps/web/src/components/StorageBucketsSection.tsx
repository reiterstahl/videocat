import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Check, Cloud, KeyRound, Pencil, Play, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { api } from "../lib/api";
import { dateLabel, formatCount } from "../lib/app-helpers";
import type { S3CheckResult, S3CheckStep, S3Failure, StorageBucketItem, StorageBucketsResponse } from "../lib/app-types";

// Administración › Almacenamiento S3: buckets (MinIO, AWS, R2, Backblaze…) that the server
// catalogues like drives. The secret key goes to the server once and never comes back.

type BucketForm = {
  name: string;
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
};

const emptyForm: BucketForm = {
  name: "",
  endpoint: "",
  region: "us-east-1",
  bucket: "",
  prefix: "",
  forcePathStyle: true,
  accessKeyId: "",
  secretAccessKey: ""
};

type SaveResponse = { saved: boolean; check: S3CheckResult; bucket?: StorageBucketItem };

// Each failure as a sentence plus the value it is about, in separate nodes so the page
// translator can translate the sentence.
function FailureText({ failure, step, forcePathStyle }: { failure: S3Failure; step: "list" | "read"; forcePathStyle: boolean }) {
  const detail = (value: ReactNode) => <code className="vc-s3-detail">{value}</code>;
  switch (failure.code) {
    case "endpoint_not_found":
      return (
        <>
          <span>No se encontró ese servidor. Revisa la dirección del endpoint.</span> {detail(failure.host)}
          {!forcePathStyle ? <small>Si es MinIO u otro servicio propio, activa el estilo de ruta.</small> : null}
        </>
      );
    case "endpoint_refused":
      return <><span>El servidor no acepta conexiones en ese puerto: revisa que esté en marcha y que el puerto sea el correcto.</span> {detail(failure.host)}</>;
    case "endpoint_timeout":
      return <><span>El servidor no respondió en 10 segundos.</span> {detail(failure.host)}</>;
    case "tls_invalid":
      return <><span>El certificado HTTPS del servidor no es válido.</span> {detail(failure.host)}</>;
    case "path_style_required":
      return <><span>Con una dirección IP o localhost hay que activar el estilo de ruta.</span> {detail(failure.host)}</>;
    case "network":
      return <><span>No se pudo conectar con el servidor.</span> {detail(failure.host)} {detail(failure.detail)}</>;
    case "not_s3":
      return <><span>Esa dirección respondió, pero no como un servicio S3.</span> {detail(`HTTP ${failure.status}`)}</>;
    case "invalid_access_key":
      return <span>La access key no existe en ese servidor.</span>;
    case "signature_mismatch":
      return <span>La secret key no corresponde a la access key.</span>;
    case "access_denied":
      return step === "list"
        ? <span>La credencial no tiene permiso para listar el bucket.</span>
        : <span>La credencial puede listar, pero no leer los objetos.</span>;
    case "no_such_bucket":
      return <><span>Ese bucket no existe en el servidor.</span> {detail(failure.bucket)}</>;
    case "wrong_region":
      return failure.region
        ? <><span>La región no coincide con la del bucket. Región del bucket:</span> {detail(failure.region)}</>
        : <span>La región no coincide con la del bucket.</span>;
    case "http_error":
      return <><span>El servidor respondió con un error.</span> {detail(`HTTP ${failure.status}${failure.s3Code ? ` ${failure.s3Code}` : ""}`)}</>;
  }
}

function StepLine({ step, forcePathStyle }: { step: S3CheckStep; forcePathStyle: boolean }) {
  const state = step.ok === true ? "is-ok" : step.ok === false ? "is-failed" : "is-skipped";
  return (
    <li className={`vc-s3-step ${state}`}>
      <span className="vc-s3-step-icon" aria-hidden="true">{step.ok === true ? <Check size={15} /> : step.ok === false ? <X size={15} /> : "–"}</span>
      <div>
        <strong>{step.step === "list" ? "Listar" : "Leer"}</strong>
        <p>
          {step.ok === false ? (
            <FailureText failure={step.failure} step={step.step} forcePathStyle={forcePathStyle} />
          ) : step.step === "list" && step.ok ? (
            step.objects === 0 ? (
              <span>Puede listar; el bucket o el prefijo están vacíos.</span>
            ) : (
              <><span>Puede listar el bucket. Objetos en la muestra:</span> <code className="vc-s3-detail">{`${step.objects}${step.truncated ? "+" : ""}`}</code></>
            )
          ) : step.ok ? (
            <><span>Puede leer los objetos. Probado con:</span> <code className="vc-s3-detail">{step.key}</code></>
          ) : (
            <span>No hay objetos para probar la lectura.</span>
          )}
        </p>
      </div>
    </li>
  );
}

function CheckResultView({ check, forcePathStyle }: { check: S3CheckResult; forcePathStyle: boolean }) {
  return (
    <div className={`vc-s3-check ${check.ok ? "is-ok" : "is-failed"}`} role="status">
      <strong>{check.ok ? "La conexión funciona." : "La conexión no funcionó."}</strong>
      <ul>
        {check.steps.map((step) => <StepLine key={step.step} step={step} forcePathStyle={forcePathStyle} />)}
      </ul>
      {check.ok ? <small>El permiso de borrar se comprueba al procesar el primer borrado.</small> : null}
    </div>
  );
}

// How the last or current scan of a bucket went, in words.
function ScanState({ bucket, locale }: { bucket: StorageBucketItem; locale: string }) {
  const progress = bucket.scanProgress;
  if (bucket.scanStatus === "running") {
    const total = progress?.toProcess ?? 0;
    const done = progress?.processed ?? 0;
    return (
      <div className="vc-s3-scan is-running">
        {progress?.phase === "listing" || !progress?.phase ? (
          <p><span>Listando el bucket. Objetos vistos:</span> <code className="vc-s3-detail">{formatCount(progress?.listed ?? 0)}</code></p>
        ) : progress.phase === "finishing" ? (
          <p><span>Terminando: marcando lo que ya no está en el bucket.</span></p>
        ) : total === 0 ? (
          <p><span>No hay videos nuevos ni cambiados.</span></p>
        ) : (
          <>
            <p><span>Leyendo videos nuevos o cambiados:</span> <code className="vc-s3-detail">{`${formatCount(done)} / ${formatCount(total)}`}</code></p>
            <div className="vc-s3-progress" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
              <span style={{ width: `${Math.round((done / Math.max(1, total)) * 100)}%` }} />
            </div>
            {progress.current ? <small className="vc-s3-current">{progress.current}</small> : null}
          </>
        )}
      </div>
    );
  }
  if (bucket.scanStatus === "failed" && bucket.scanFailure) {
    const failure = bucket.scanFailure;
    return (
      <div className="vc-s3-scan is-failed">
        <p className="vc-s3-row-failure">
          <span>El último escaneo falló.</span>{" "}
          {failure.code === "scan_error" ? <code className="vc-s3-detail">{failure.detail}</code>
            : failure.code === "interrupted" ? <span>Se interrumpió y sigue en el próximo.</span>
            : <FailureText failure={failure} step="list" forcePathStyle={bucket.forcePathStyle} />}
        </p>
      </div>
    );
  }
  if (bucket.scanFinishedAt && progress?.phase === "done") {
    return (
      <div className="vc-s3-scan">
        <p>
          <span>Último escaneo:</span> <code className="vc-s3-detail">{dateLabel(bucket.scanFinishedAt, locale)}</code>{" "}
          <span>Videos:</span> <code className="vc-s3-detail">{formatCount(progress.listed ?? 0)}</code>{" "}
          <span>Leídos:</span> <code className="vc-s3-detail">{formatCount(progress.processed ?? 0)}</code>
          {(progress.failed ?? 0) > 0 ? <>{" "}<span>Con error:</span> <code className="vc-s3-detail">{formatCount(progress.failed ?? 0)}</code></> : null}
          {(progress.relocated ?? 0) > 0 ? <>{" "}<span>Movidos:</span> <code className="vc-s3-detail">{formatCount(progress.relocated ?? 0)}</code></> : null}
          {(progress.markedAbsent ?? 0) > 0 ? <>{" "}<span>Ya no están:</span> <code className="vc-s3-detail">{formatCount(progress.markedAbsent ?? 0)}</code></> : null}
        </p>
      </div>
    );
  }
  return null;
}

function bucketPlace(bucket: Pick<StorageBucketItem, "endpoint" | "region" | "bucket" | "prefix">): string {
  const host = bucket.endpoint ? new URL(bucket.endpoint).host : `AWS ${bucket.region}`;
  return `${host} · ${bucket.bucket}/${bucket.prefix}`;
}

export function StorageBucketsSection({ locale, refreshKey }: { locale: string; refreshKey: number }) {
  const [data, setData] = useState<StorageBucketsResponse | null>(null);
  const [form, setForm] = useState<BucketForm | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingHint, setEditingHint] = useState("");
  const [check, setCheck] = useState<S3CheckResult | null>(null);
  const [busy, setBusy] = useState<"check" | "save" | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await api<StorageBucketsResponse>("/api/storage/buckets"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo cargar el almacenamiento S3.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const keyReady = data?.encryptionKey === "ready";
  const scanner = data?.scanner;
  const scanning = data?.buckets.some((bucket) => bucket.scanStatus === "running" || bucket.scanRequestedAt) ?? false;

  // While a scan runs or waits, the rows follow it.
  useEffect(() => {
    if (!scanning) return;
    const timer = window.setInterval(() => void load(), 3000);
    return () => window.clearInterval(timer);
  }, [scanning, load]);

  async function requestScan(bucket: StorageBucketItem) {
    setRowBusy(bucket.id);
    setError("");
    try {
      const response = await api<{ bucket: StorageBucketItem }>(`/api/storage/buckets/${bucket.id}/scan`, { method: "POST", body: JSON.stringify({}) });
      setData((current) => current ? { ...current, buckets: current.buckets.map((item) => (item.id === bucket.id ? response.bucket : item)) } : current);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo pedir el escaneo.");
    } finally {
      setRowBusy(null);
    }
  }

  function scanBlockedReason(bucket: StorageBucketItem): string | null {
    if (!scanner?.online) return "El escáner de buckets no está en marcha";
    if (!scanner.ffmpeg) return "El escáner no encuentra ffmpeg";
    if (bucket.scanStatus === "running") return "Ya se está escaneando";
    if (bucket.scanRequestedAt) return "En cola: el escáner lo toma en unos segundos";
    return null;
  }

  function openForm(bucket?: StorageBucketItem) {
    setMessage("");
    setError("");
    setCheck(null);
    setEditingId(bucket?.id ?? null);
    setEditingHint(bucket?.secretHint ?? "");
    setForm(bucket
      ? { name: bucket.name, endpoint: bucket.endpoint, region: bucket.region, bucket: bucket.bucket, prefix: bucket.prefix, forcePathStyle: bucket.forcePathStyle, accessKeyId: bucket.accessKeyId, secretAccessKey: "" }
      : emptyForm);
  }

  function closeForm() {
    setForm(null);
    setEditingId(null);
    setCheck(null);
  }

  function update<K extends keyof BucketForm>(key: K, value: BucketForm[K]) {
    setForm((current) => (current ? { ...current, [key]: value } : current));
    // A result for other values would mislead.
    setCheck(null);
  }

  async function runCheck() {
    if (!form) return;
    setBusy("check");
    setError("");
    try {
      const response = await api<{ check: S3CheckResult }>("/api/storage/buckets/check", {
        method: "POST",
        body: JSON.stringify({ ...form, ...(editingId ? { bucketId: editingId } : {}) })
      });
      setCheck(response.check);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo probar la conexión.");
    } finally {
      setBusy(null);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form) return;
    setBusy("save");
    setError("");
    try {
      const response = await api<SaveResponse>(editingId ? `/api/storage/buckets/${editingId}` : "/api/storage/buckets", {
        method: editingId ? "PATCH" : "POST",
        body: JSON.stringify(form)
      });
      if (!response.saved) {
        setCheck(response.check);
        return;
      }
      closeForm();
      setMessage(editingId ? `Bucket "${form.name}" actualizado.` : `Bucket "${form.name}" agregado.`);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo guardar el bucket.");
    } finally {
      setBusy(null);
    }
  }

  async function recheck(bucket: StorageBucketItem) {
    setRowBusy(bucket.id);
    setError("");
    try {
      const response = await api<{ check: S3CheckResult; bucket: StorageBucketItem }>(`/api/storage/buckets/${bucket.id}/check`, { method: "POST", body: JSON.stringify({}) });
      setData((current) => current ? { ...current, buckets: current.buckets.map((item) => (item.id === bucket.id ? response.bucket : item)) } : current);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo comprobar el bucket.");
    } finally {
      setRowBusy(null);
    }
  }

  async function remove(bucket: StorageBucketItem) {
    setRowBusy(bucket.id);
    setError("");
    try {
      await api(`/api/storage/buckets/${bucket.id}`, { method: "DELETE" });
      setPendingRemoval(null);
      setMessage(`Bucket "${bucket.name}" quitado de VideoCAT. No se borró nada del bucket.`);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo quitar el bucket.");
    } finally {
      setRowBusy(null);
    }
  }

  const required = form ? Boolean(form.name.trim() && form.bucket.trim() && form.accessKeyId.trim() && (editingId || form.secretAccessKey)) : false;

  return (
    <section className="vc-panel" aria-labelledby="admin-storage-title">
      <div className="vc-panel-head">
        <div>
          <h2 id="admin-storage-title">Almacenamiento S3</h2>
          <p>Buckets compatibles con S3 (MinIO, AWS, Cloudflare R2, Backblaze…) que el servidor cataloga como un disco más. Las credenciales se guardan cifradas en el servidor.</p>
        </div>
        <button
          className="vc-button is-primary"
          disabled={!keyReady || Boolean(form)}
          onClick={() => openForm()}
          title={!keyReady ? "Falta configurar STORAGE_SECRET_KEY en el servidor" : form ? "Guarda o cancela el formulario abierto" : undefined}
          type="button"
        >
          <Plus size={16} />
          Añadir bucket
        </button>
      </div>
      <div className="vc-panel-body">
        {message ? <div className="vc-notice" role="status">{message}</div> : null}
        {error ? <div className="form-error">{error}</div> : null}

        {data && !keyReady ? (
          <div className="vc-s3-key">
            <KeyRound size={18} aria-hidden="true" />
            <div>
              <strong>{data.encryptionKey === "invalid" ? "La clave de cifrado del servidor no es válida." : "El servidor necesita una clave para cifrar las credenciales."}</strong>
              <p>Agrega esta línea al .env del servidor, con un valor generado por openssl rand -hex 32 (64 caracteres hexadecimales), y reinicia el stack:</p>
              <code>STORAGE_SECRET_KEY=</code>
              <small>Guárdala con tus respaldos: si cambia, habrá que volver a escribir la secret key de cada bucket.</small>
            </div>
          </div>
        ) : null}

        {data && keyReady && data.buckets.length > 0 && !scanner?.online ? (
          <div className="vc-s3-key">
            <Cloud size={18} aria-hidden="true" />
            <div>
              <strong>{scanner?.installed ? "El escáner de buckets no responde." : "El escáner de buckets no está instalado."}</strong>
              <p>Los buckets los lee un contenedor aparte, videocat-scanner, que trae ffmpeg. Actívalo en la carpeta del stack con:</p>
              <code>docker compose --profile s3 up -d</code>
              <small>En Portainer: agrega la variable COMPOSE_PROFILES=s3 al stack y vuelve a desplegarlo.</small>
            </div>
          </div>
        ) : null}
        {scanner?.online && !scanner.ffmpeg ? <div className="form-error">El escáner está en marcha, pero no encuentra ffmpeg.</div> : null}

        {form ? (
          <form className="vc-s3-form" onSubmit={save}>
            <label className="vc-field">
              <span>Nombre del disco</span>
              <input value={form.name} onChange={(event) => update("name", event.target.value)} maxLength={80} placeholder="MinIO · Videos" required />
            </label>
            <div className="vc-s3-row">
              <label className="vc-field">
                <span>Endpoint</span>
                <input value={form.endpoint} onChange={(event) => update("endpoint", event.target.value)} placeholder="http://192.168.1.30:9000" inputMode="url" spellCheck={false} />
                <small>Vacío para AWS S3.</small>
              </label>
              <label className="vc-field">
                <span>Región</span>
                <input value={form.region} onChange={(event) => update("region", event.target.value)} placeholder="us-east-1" spellCheck={false} />
                <small>MinIO acepta us-east-1; Cloudflare R2 usa auto.</small>
              </label>
            </div>
            <div className="vc-s3-row">
              <label className="vc-field">
                <span>Bucket</span>
                <input value={form.bucket} onChange={(event) => update("bucket", event.target.value)} placeholder="videos" spellCheck={false} required />
              </label>
              <label className="vc-field">
                <span>Prefijo (opcional)</span>
                <input value={form.prefix} onChange={(event) => update("prefix", event.target.value)} placeholder="Peliculas/" spellCheck={false} />
                <small>Solo se cataloga lo que está dentro de esta carpeta del bucket.</small>
              </label>
            </div>
            <div className="vc-s3-row">
              <label className="vc-field">
                <span>Access key</span>
                <input value={form.accessKeyId} onChange={(event) => update("accessKeyId", event.target.value)} autoComplete="off" spellCheck={false} required />
              </label>
              <label className="vc-field">
                <span>Secret key</span>
                <input
                  value={form.secretAccessKey}
                  onChange={(event) => update("secretAccessKey", event.target.value)}
                  type="password"
                  autoComplete="new-password"
                  placeholder={editingId ? (editingHint ? `•••• ${editingHint} · vacío para mantenerla` : "Vacío para mantenerla") : ""}
                  required={!editingId}
                />
              </label>
            </div>
            <label className="vc-toggle-row">
              <input checked={form.forcePathStyle} onChange={(event) => update("forcePathStyle", event.target.checked)} type="checkbox" />
              <span>
                <strong>Estilo de ruta (path-style)</strong>
                <small>Pone el bucket en la ruta (servidor/bucket) en vez del nombre de host. Actívalo para MinIO y la mayoría de servicios propios; AWS usa el estilo virtual.</small>
              </span>
            </label>

            {check ? <CheckResultView check={check} forcePathStyle={form.forcePathStyle} /> : null}

            <div className="vc-s3-actions">
              <button className="vc-button" disabled={busy !== null} onClick={closeForm} type="button">Cancelar</button>
              <button
                className="vc-button"
                disabled={busy !== null || !required}
                onClick={() => void runCheck()}
                title={!required ? "Completa nombre, bucket, access key y secret key" : undefined}
                type="button"
              >
                <RefreshCw size={16} />
                {busy === "check" ? "Probando..." : "Probar conexión"}
              </button>
              <button
                className="vc-button is-primary"
                disabled={busy !== null || !required}
                title={!required ? "Completa nombre, bucket, access key y secret key" : undefined}
                type="submit"
              >
                <Check size={16} />
                {busy === "save" ? "Probando y guardando..." : "Guardar"}
              </button>
            </div>
            <small className="vc-help">Se guarda solo si la conexión funciona.</small>
          </form>
        ) : null}

        <div className="vc-companion-list">
          {data?.buckets.map((bucket) => (
            <article className="vc-companion-row vc-s3-bucket" key={bucket.id}>
              <Cloud size={18} aria-hidden="true" className="vc-s3-bucket-icon" />
              <div className="vc-companion-identity">
                <strong>{bucket.name}</strong>
                <span>{bucketPlace(bucket)}</span>
                {bucket.lastCheckOk === false && bucket.lastCheckFailure ? (
                  <p className="vc-s3-row-failure"><FailureText failure={bucket.lastCheckFailure} step="list" forcePathStyle={bucket.forcePathStyle} /></p>
                ) : null}
              </div>
              <div className="vc-companion-badges">
                <span className={`vc-badge ${bucket.lastCheckOk === true ? "is-success" : bucket.lastCheckOk === false ? "is-danger" : ""}`}>
                  {bucket.lastCheckOk === true ? "Conexión correcta" : bucket.lastCheckOk === false ? "Sin conexión" : "Sin comprobar"}
                </span>
                {bucket.lastCheckedAt ? <span className="vc-badge">{`Comprobado ${dateLabel(bucket.lastCheckedAt, locale)}`}</span> : null}
                {bucket.scanStatus === "running" ? <span className="vc-badge is-success">Escaneando</span>
                  : bucket.scanRequestedAt ? <span className="vc-badge">En cola</span>
                  : bucket.scanStatus === "failed" ? <span className="vc-badge is-danger">Escaneo fallido</span>
                  : !bucket.scanFinishedAt ? <span className="vc-badge is-warning">Sin escanear todavía</span> : null}
              </div>
              {pendingRemoval === bucket.id ? (
                <div className="vc-inline-confirm">
                  <span>{bucket.diskId ? "¿Quitarlo de VideoCAT? No se borra nada del bucket; su disco y su catálogo quedan en Discos." : "¿Quitarlo de VideoCAT? No se borra nada del bucket."}</span>
                  <button className="vc-button is-small is-danger" disabled={rowBusy === bucket.id} onClick={() => void remove(bucket)} type="button">Quitar</button>
                  <button className="vc-button is-small" onClick={() => setPendingRemoval(null)} type="button">Cancelar</button>
                </div>
              ) : (
                <div className="vc-s3-row-actions">
                  <button
                    className="vc-icon-button is-ghost"
                    disabled={rowBusy === bucket.id || scanBlockedReason(bucket) !== null}
                    onClick={() => void requestScan(bucket)}
                    aria-label="Escanear ahora"
                    title={scanBlockedReason(bucket) ?? "Escanear ahora"}
                    type="button"
                  >
                    <Play size={16} />
                  </button>
                  <button className="vc-icon-button is-ghost" disabled={rowBusy === bucket.id || !keyReady} onClick={() => void recheck(bucket)} aria-label="Probar conexión" title={keyReady ? "Probar conexión" : "Falta configurar STORAGE_SECRET_KEY en el servidor"} type="button">
                    <RefreshCw size={16} />
                  </button>
                  <button className="vc-icon-button is-ghost" disabled={Boolean(form) || !keyReady} onClick={() => openForm(bucket)} aria-label="Editar" title={!keyReady ? "Falta configurar STORAGE_SECRET_KEY en el servidor" : form ? "Guarda o cancela el formulario abierto" : "Editar"} type="button">
                    <Pencil size={16} />
                  </button>
                  <button className="vc-icon-button is-ghost" disabled={rowBusy === bucket.id} onClick={() => setPendingRemoval(bucket.id)} aria-label="Quitar" title="Quitar" type="button">
                    <Trash2 size={16} />
                  </button>
                </div>
              )}
              {/* Last in the row: it takes a line of its own below the name, badges and actions. */}
              <ScanState bucket={bucket} locale={locale} />
            </article>
          ))}
          {data && data.buckets.length === 0 && !form ? <div className="empty">Todavía no hay buckets S3.</div> : null}
        </div>
      </div>
    </section>
  );
}
