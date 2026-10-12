import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRightLeft, CheckCircle2, EyeOff, FolderInput, X } from "lucide-react";
import { formatBytes } from "@videocat/shared";
import { ReviewSession, type ReviewCopy } from "./ReviewSession";
import { api } from "../lib/api";
import { transferError } from "../lib/transfers";
import { formatCount } from "../lib/app-helpers";
import type { ReviewDecision, ReviewSessionEntry } from "../lib/app-types";
import type { GroupCandidates, VideoFile } from "../types";

type GroupSessionProps = {
  destinationId: string;
  onClose: () => void;
  onOpenTransfers: () => void;
  onChanged: () => void;
};

const batchSize = 20;
const decisionFor: Record<ReviewDecision, "group" | "ignore"> = { keep: "group", delete: "ignore" };

function groupCopy(folder: string): ReviewCopy {
  return {
    title: "Agrupar archivos",
    exit: "Salir de agrupar",
    dialogLabel: "Sesión para agrupar archivos",
    keep: {
      label: `Agrupar en ${folder}`,
      flash: "Agrupado",
      done: "Agrupado",
      short: "Agrupar",
      icon: <FolderInput size={20} />,
      flashIcon: <FolderInput size={32} />
    },
    delete: {
      label: "Ignorar",
      flash: "Ignorado",
      done: "Ignorado",
      short: "Ignorar",
      icon: <EyeOff size={20} />,
      flashIcon: <EyeOff size={30} />
    },
    lastOne: "Este es el último archivo parecido.",
    keys: <><kbd>F</kbd> agrupar · <kbd>J</kbd> ignorar · <kbd>S</kbd> saltar · <kbd>Z</kbd> deshacer · <kbd>←</kbd><kbd>→</kbd> fotogramas · <kbd>Enter</kbd> reproducir · <kbd>Espacio</kbd> privacidad · <kbd>P</kbd> pantalla completa · <kbd>G</kbd> galería · <kbd>Esc</kbd> salir</>
  };
}

export function GroupSession({ destinationId, onClose, onOpenTransfers, onChanged }: GroupSessionProps) {
  const [info, setInfo] = useState<GroupCandidates | null>(null);
  // Files still to decide, in order; a skip sends one to the end and an undo brings it back first.
  const [queue, setQueue] = useState<string[]>([]);
  const [files, setFiles] = useState<Map<string, VideoFile>>(new Map());
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [grouped, setGrouped] = useState({ files: 0, bytes: 0 });
  const [ignored, setIgnored] = useState(0);
  const requested = useRef(new Set<string>());

  useEffect(() => {
    let active = true;
    api<GroupCandidates>("/api/transfers/group/candidates", { method: "POST", body: JSON.stringify({ destinationId }) })
      .then((response) => {
        if (!active) return;
        setInfo(response);
        setQueue(response.items.map((item) => item.id));
      })
      .catch((reason) => {
        if (active) setError(transferError(reason, "No se pudieron buscar los archivos parecidos."));
      });
    return () => {
      active = false;
    };
  }, [destinationId]);

  // Loads the cards of the next files ahead of time, in small batches.
  useEffect(() => {
    const missing = queue.slice(0, batchSize).filter((id) => !files.has(id) && !requested.current.has(id));
    if (missing.length === 0) return;
    const ids = queue.slice(0, batchSize * 2).filter((id) => !files.has(id) && !requested.current.has(id)).slice(0, batchSize * 2);
    ids.forEach((id) => requested.current.add(id));
    api<{ files: VideoFile[] }>("/api/files/by-ids", { method: "POST", body: JSON.stringify({ ids }) })
      .then((response) => {
        const found = new Set(response.files.map((file) => file.id));
        setFiles((current) => {
          const next = new Map(current);
          response.files.forEach((file) => next.set(file.id, file));
          return next;
        });
        // Files that disappeared or became hidden since the search leave the queue.
        if (found.size < ids.length) setQueue((current) => current.filter((id) => found.has(id) || !ids.includes(id)));
      })
      .catch(() => ids.forEach((id) => requested.current.delete(id)));
  }, [files, queue]);

  const matchById = useMemo(() => new Map(info?.items.map((item) => [item.id, item.match]) ?? []), [info]);
  const current = queue[0] ? files.get(queue[0]) : undefined;
  const upcoming = queue.length > 1 ? files.get(queue[1]) : null;

  const decide = useCallback(async (file: VideoFile, status: ReviewDecision) => {
    setLoading(true);
    setMessage("");
    try {
      await api("/api/transfers/group/decide", { method: "POST", body: JSON.stringify({ destinationId, fileId: file.id, decision: decisionFor[status] }) });
      if (status === "keep") setGrouped((value) => ({ files: value.files + 1, bytes: value.bytes + file.sizeBytes }));
      else setIgnored((value) => value + 1);
      setQueue((value) => value.filter((id) => id !== file.id));
      onChanged();
    } catch (reason) {
      setMessage(transferError(reason, "No se pudo guardar la decisión."));
      throw reason;
    } finally {
      setLoading(false);
    }
  }, [destinationId, onChanged]);

  async function undo(entry: ReviewSessionEntry): Promise<boolean> {
    setLoading(true);
    setMessage("");
    try {
      await api("/api/transfers/group/undo", { method: "POST", body: JSON.stringify({ destinationId, fileId: entry.previous.id, decision: decisionFor[entry.status] }) });
      if (entry.status === "keep") setGrouped((value) => ({ files: value.files - 1, bytes: value.bytes - entry.previous.sizeBytes }));
      else setIgnored((value) => value - 1);
      setFiles((value) => new Map(value).set(entry.previous.id, entry.previous));
      setQueue((value) => [entry.previous.id, ...value.filter((id) => id !== entry.previous.id)]);
      onChanged();
      return true;
    } catch (reason) {
      setMessage(transferError(reason, "No se pudo deshacer."));
      return false;
    } finally {
      setLoading(false);
    }
  }

  const folder = info?.destination.name ?? "";
  const copy = useMemo(() => groupCopy(folder), [folder]);
  const finished = info !== null && queue.length === 0;

  if (current && info) {
    const match = matchById.get(current.id);
    return (
      <ReviewSession
        file={current}
        upcoming={upcoming}
        categories={[]}
        loading={loading}
        remaining={queue.length}
        pendingTotal={queue.length}
        markedToday={0}
        markedLast7Days={0}
        message={message}
        onClose={onClose}
        onDecision={(status) => decide(current, status)}
        onSkip={async () => {
          setMessage("");
          setQueue((value) => (value.length > 1 ? [...value.slice(1), value[0]] : value));
        }}
        onUndo={undo}
        onToggleCategory={() => undefined}
        copy={copy}
        variant="group"
        stats={[
          { label: "Por decidir", value: formatCount(queue.length) },
          { label: "Agrupados", value: formatCount(grouped.files) },
          { label: "Ignorados", value: formatCount(ignored) },
          { label: "A mover", value: formatBytes(grouped.bytes), accent: true }
        ]}
        note={(
          <div className="vc-group-note">
            <span className={`vc-badge ${match === "similar" ? "is-warning" : "is-success"}`}>
              {match === "similar" ? "Nombre parecido" : "Contiene el nombre"}
            </span>
            <span>{`Destino: ${info.destination.diskName} › ${info.destination.path}`}</span>
          </div>
        )}
      />
    );
  }

  return (
    <div className="vc-review is-group vc-group-status" role="dialog" aria-modal="true" aria-label="Sesión para agrupar archivos">
      <section className="vc-panel vc-group-status-panel">
        <button className="icon-button vc-group-status-close" onClick={onClose} type="button" title="Cerrar"><X size={18} /></button>
        {error ? (
          <>
            <h2>Agrupar archivos</h2>
            <div className="form-error" role="alert">{error}</div>
          </>
        ) : !info || !finished ? (
          <div className="loading">Buscando archivos parecidos…</div>
        ) : (
          <>
            <CheckCircle2 size={36} aria-hidden="true" className="vc-group-status-icon" />
            <h2>{info.total === 0 ? `No hay archivos para agrupar en ${folder}` : `Terminaste con ${folder}`}</h2>
            <p>
              {info.total === 0
                ? "Ningún archivo de los discos tiene un nombre parecido que no esté ya en la carpeta, en otro traslado o ignorado."
                : `En esta sesión · agrupados: ${formatCount(grouped.files)} (${formatBytes(grouped.bytes)}) · ignorados: ${formatCount(ignored)}`}
            </p>
            {info.skipped.duplicates > 0 ? <p className="vc-transfers-detail">{`${formatCount(info.skipped.duplicates)} ya tienen una copia idéntica en la carpeta y se quedan para revisar en Duplicados.`}</p> : null}
            <div className="vc-folders-actions">
              <button className="vc-button is-primary" onClick={onOpenTransfers} type="button"><ArrowRightLeft size={16} /> Ver en Traslados</button>
              <button className="vc-button" onClick={onClose} type="button">Cerrar</button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
