import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  Cast,
  ChevronLeft,
  ChevronRight,
  FileVideo,
  FolderOpen,
  Image,
  Maximize,
  MonitorPlay,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Shuffle,
  SkipForward,
  Trash2,
  X
} from "lucide-react";
import { formatBytes, formatDuration } from "@videocat/shared";
import { DeleteFileConfirmModal } from "./DeleteFileConfirmModal";
import { FullscreenGallery } from "./FullscreenGallery";
import { Info } from "./Info";
import { translateText } from "../i18n";
import { api } from "../lib/api";
import {
  browserPlaybackSupport,
  categoryKeysForFile,
  categoryLabel,
  categoryStyle,
  dateLabel,
  folderPath,
  hasFileCategory,
  isEditableTarget,
  mainThumbnail,
  resolution
} from "../lib/app-helpers";
import type {
  CastAccessResponse,
  CompanionAction,
  CompanionResponse,
  CurationCategory,
  StreamSessionResponse
} from "../lib/app-types";
import { castVideo } from "../lib/chromecast";
import type { VideoFile } from "../types";

export function FileDetail({
  file,
  duplicates,
  locale,
  canOpenPrevious,
  canOpenNext,
  onPrevious,
  onNext,
  onRandom,
  onClose,
  categories,
  companionOnline,
  companionLocalOnline,
  companionMountedDiskIds,
  chromecastEnabled,
  onToggleCategory,
  onDeleted,
  variant = "modal"
}: {
  file: VideoFile;
  duplicates: VideoFile[];
  locale: string;
  canOpenPrevious: boolean;
  canOpenNext: boolean;
  onPrevious: () => Promise<void> | void;
  onNext: () => Promise<void> | void;
  onRandom: (excludeId: string) => Promise<void> | void;
  onClose: () => void;
  categories: CurationCategory[];
  companionOnline: boolean;
  companionLocalOnline: boolean;
  companionMountedDiskIds: string[];
  chromecastEnabled: boolean;
  onToggleCategory: (categoryKey: string, enabled: boolean) => Promise<void> | void;
  onDeleted: (fileId: string) => void;
  variant?: "modal" | "panel";
}) {
  const [galleryIndex, setGalleryIndex] = useState<number | null>(null);
  const [companionBusy, setCompanionBusy] = useState<CompanionAction | null>(null);
  const [companionMessage, setCompanionMessage] = useState("");
  const [deletePromptOpen, setDeletePromptOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [remoteSessionId, setRemoteSessionId] = useState<string | null>(null);
  const [remoteUrl, setRemoteUrl] = useState<string | null>(null);
  const [remoteMode, setRemoteMode] = useState<"original" | "remux">("original");
  const [remoteState, setRemoteState] = useState<"idle" | "preparing" | "playing" | "paused" | "buffering" | "error">("idle");
  const [remoteMessage, setRemoteMessage] = useState("");
  const [remoteSeekFeedback, setRemoteSeekFeedback] = useState<"back" | "forward" | null>(null);
  const [remoteCurrentTime, setRemoteCurrentTime] = useState(0);
  const [remoteDuration, setRemoteDuration] = useState(0);
  const [remoteControlsVisible, setRemoteControlsVisible] = useState(false);
  const [remoteShuffleEnabled, setRemoteShuffleEnabled] = useState(
    () => localStorage.getItem("videocat-remote-shuffle") !== "false"
  );
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remotePlayerRef = useRef<HTMLElement | null>(null);
  const remoteSessionIdRef = useRef<string | null>(null);
  const remoteTapRef = useRef<{ side: "back" | "forward"; at: number } | null>(null);
  const remoteSeekFeedbackTimerRef = useRef<number | null>(null);
  const remoteControlsTimerRef = useRef<number | null>(null);
  const remoteSingleTapTimerRef = useRef<number | null>(null);
  const remoteRecoveryTimerRef = useRef<number | null>(null);
  const remoteRecoveryAttemptsRef = useRef(0);
  const remoteResumeTimeRef = useRef(0);
  const remotePlayNextRef = useRef<"original" | "remux" | null>(null);
  const remoteTransitionSessionRef = useRef<string | null>(null);
  const remoteTransitioningRef = useRef(false);
  const remoteFullscreenAttemptedRef = useRef(false);
  const json = JSON.stringify(file.ffprobeJson ?? {}, null, 2);
  const localFolder = folderPath(file.absolutePath);
  const galleryThumb = galleryIndex == null ? null : file.thumbnails[galleryIndex];
  const canOpenPreviousImage = galleryIndex != null && galleryIndex > 0;
  const canOpenNextImage = galleryIndex != null && galleryIndex < file.thumbnails.length - 1;
  const canStreamRemotely = companionOnline && companionMountedDiskIds.includes(file.diskId);
  const playbackSupport = browserPlaybackSupport(file);
  const remoteAvailabilityMessage = !companionOnline
    ? "La reproducción remota requiere un Companion sincronizado con el servidor. Ábrelo en la PC donde está conectado el disco."
    : !companionMountedDiskIds.includes(file.diskId)
      ? "El Companion está activo, pero este disco no fue reportado como conectado. Conéctalo y actualiza los discos desde el Companion."
      : playbackSupport.result === ""
        ? playbackSupport.remuxUseful
          ? "El formato original no es compatible con este navegador. Usa el botón MP4 para preparar una copia temporal compatible."
          : "Este navegador no puede reproducir el formato original de este video."
        : "";
  const remoteStatusLabel = remoteState === "playing"
    ? "Reproduciendo remotamente"
    : remoteState === "paused"
      ? "Reproducción pausada"
      : remoteState === "buffering"
        ? "Cargando video"
        : remoteMode === "remux"
          ? "Preparando MP4 temporal"
          : "Preparando reproducción segura";
  const remoteTransitioning = remoteTransitioningRef.current;
  const remoteLoadingLabel = remoteTransitioning ? "" : (remoteMessage || "Cargando video...");

  useEffect(() => {
    remoteSessionIdRef.current = remoteSessionId;
  }, [remoteSessionId]);

  useEffect(() => () => {
    const sessionIds = new Set([remoteSessionIdRef.current, remoteTransitionSessionRef.current]);
    for (const sessionId of sessionIds) {
      if (sessionId) void api(`/api/stream-sessions/${sessionId}`, { method: "DELETE" }).catch(() => undefined);
    }
  }, []);

  useEffect(() => () => {
    if (remoteSeekFeedbackTimerRef.current != null) {
      window.clearTimeout(remoteSeekFeedbackTimerRef.current);
    }
    if (remoteRecoveryTimerRef.current != null) {
      window.clearTimeout(remoteRecoveryTimerRef.current);
    }
    if (remoteControlsTimerRef.current != null) {
      window.clearTimeout(remoteControlsTimerRef.current);
    }
    if (remoteSingleTapTimerRef.current != null) {
      window.clearTimeout(remoteSingleTapTimerRef.current);
    }
  }, []);

  useEffect(() => {
    const nextMode = remotePlayNextRef.current;
    if (!nextMode) return;
    remotePlayNextRef.current = null;
    const timer = window.setTimeout(() => void startRemotePlayback(nextMode, true), 0);
    return () => window.clearTimeout(timer);
  }, [file.id]);

  function moveGallery(offset: -1 | 1) {
    setGalleryIndex((current) => {
      if (current == null) return current;
      const next = current + offset;
      if (next < 0 || next >= file.thumbnails.length) return current;
      return next;
    });
  }

  async function callCompanion(action: CompanionAction) {
    const port = localStorage.getItem("videocat-companion-port") ?? "29429";
    const token = localStorage.getItem("videocat-companion-token") ?? "";
    setCompanionBusy(action);
    setCompanionMessage("");

    try {
      if (!companionLocalOnline) {
        if (action !== "delete-file") {
          setCompanionMessage(
            companionOnline
              ? "El Companion está activo en la PC. Reproducir y abrir carpetas solo funciona desde ese equipo."
              : "Companion no iniciado o no sincronizado con el servidor."
          );
          return;
        }

        await onToggleCategory("delete", true);
        if (companionOnline) {
          try {
            await api("/api/review/deletions/process", { method: "POST" });
            setCompanionMessage("Marcado para borrar. La orden fue enviada al Companion de la PC.");
          } catch {
            setCompanionMessage("Marcado para borrar. El Companion lo procesará en su revisión periódica.");
          }
        } else {
          setCompanionMessage("Marcado para borrar. Se procesará cuando el Companion vuelva a conectarse.");
        }
        return;
      }

      const headers = new Headers({ "Content-Type": "application/json" });
      if (token) headers.set("X-VideoCat-Companion-Token", token);
      const response = await fetch(`http://127.0.0.1:${port}/${action}`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          diskId: file.disk?.volumeId ?? file.diskId,
          absolutePath: file.absolutePath,
          relativePath: file.relativePath
        })
      });
      const result = await response.json().catch(() => ({ ok: false, reason: "open_failed" })) as CompanionResponse;

      if (response.status === 401 || response.status === 403 || result.reason === "forbidden") {
        setCompanionMessage("Falta el token del Companion o no es válido. Pegalo en Perfil › Companion local.");
      } else if (result.ok) {
        if (action === "delete-file") {
          try {
            await api(`/api/files/${file.id}/catalog`, { method: "DELETE" });
            setCompanionMessage("Archivo borrado y quitado del catalogo");
            onDeleted(file.id);
          } catch (error) {
            setCompanionMessage(
              `Archivo borrado localmente, pero no se pudo quitar del catalogo: ${
                error instanceof Error ? error.message : "error desconocido"
              }`
            );
          }
        } else {
          setCompanionMessage(action === "open-file" ? "Abriendo video local" : "Abriendo carpeta local");
        }
      } else if (result.reason === "not_available") {
        setCompanionMessage("Disco no conectado");
      } else {
        setCompanionMessage(result.detail ? `No se pudo abrir localmente: ${result.detail}` : "No se pudo abrir localmente");
      }
    } catch (error) {
      setCompanionMessage(error instanceof Error ? error.message : "No se pudo completar la acción");
    } finally {
      setCompanionBusy(null);
    }
  }

  async function stopRemotePlayback(message = "", exitFullscreen = true) {
    const sessionIds = new Set([remoteSessionId, remoteTransitionSessionRef.current]);
    remoteTransitionSessionRef.current = null;
    remoteTransitioningRef.current = false;
    setRemoteUrl(null);
    setRemoteSessionId(null);
    setRemoteState("idle");
    setRemoteMessage(message);
    setRemoteCurrentTime(0);
    setRemoteDuration(0);
    setRemoteControlsVisible(false);
    if (remoteRecoveryTimerRef.current != null) {
      window.clearTimeout(remoteRecoveryTimerRef.current);
      remoteRecoveryTimerRef.current = null;
    }
    remoteFullscreenAttemptedRef.current = false;
    remoteRecoveryAttemptsRef.current = 0;
    remoteResumeTimeRef.current = 0;
    if (exitFullscreen && document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    }
    if (exitFullscreen) window.screen.orientation?.unlock?.();
    for (const sessionId of sessionIds) {
      if (sessionId) {
        try {
          await api(`/api/stream-sessions/${sessionId}`, { method: "DELETE" });
        } catch {
          // The short-lived session will expire even when the Companion went offline.
        }
      }
    }
  }

  async function startRemotePlayback(mode: "original" | "remux" = "original", alreadyPreparing = false) {
    if (remoteState === "preparing" && !alreadyPreparing) return;
    if (remoteSessionId) await stopRemotePlayback();
    if (!alreadyPreparing) remoteFullscreenAttemptedRef.current = false;
    setRemoteControlsVisible(false);
    if (!alreadyPreparing) {
      setRemoteState("preparing");
      setRemoteMode(mode);
      setRemoteMessage(mode === "remux" ? "Preparando una copia MP4 temporal compatible..." : "Preparando reproducción remota segura...");
    }
    try {
      const replaceSessionId = remoteTransitionSessionRef.current;
      const response = await api<StreamSessionResponse>("/api/stream-sessions", {
        method: "POST",
        body: JSON.stringify({ fileId: file.id, mode, ...(replaceSessionId ? { replaceSessionId } : {}) })
      });
      setRemoteSessionId(response.session.id);
      setRemoteUrl(`/api/streams/${response.session.id}/content`);
      setRemoteState("buffering");
      setRemoteMessage("Conectado al Companion. Cargando video...");
    } catch (error) {
      const previousSessionId = remoteTransitionSessionRef.current;
      remoteTransitionSessionRef.current = null;
      remoteTransitioningRef.current = false;
      setRemoteUrl(null);
      if (previousSessionId) {
        void api(`/api/stream-sessions/${previousSessionId}`, { method: "DELETE" }).catch(() => undefined);
      }
      setRemoteState("error");
      setRemoteMessage(error instanceof Error ? error.message : "No se pudo iniciar la reproducción remota.");
    }
  }

  function finishRemoteTransition() {
    const previousSessionId = remoteTransitionSessionRef.current;
    remoteTransitionSessionRef.current = null;
    if (previousSessionId) {
      void api(`/api/stream-sessions/${previousSessionId}`, { method: "DELETE" }).catch(() => undefined);
    }
  }

  function requestRemotePlayback(mode: "original" | "remux" = "original") {
    if (remoteState === "preparing") return;
    if (!companionOnline || !companionMountedDiskIds.includes(file.diskId)) {
      setRemoteState("idle");
      setRemoteMessage(remoteAvailabilityMessage);
      return;
    }
    if (mode === "original" && playbackSupport.result === "") {
      setRemoteState("idle");
      setRemoteMessage(remoteAvailabilityMessage);
      return;
    }
    flushSync(() => {
      setRemoteState("preparing");
      setRemoteMode(mode);
      setRemoteMessage(mode === "remux" ? "Preparando una copia MP4 temporal compatible..." : "Preparando reproducción remota segura...");
      setRemoteControlsVisible(false);
    });
    void requestRemoteFullscreen(true);
    void startRemotePlayback(mode, true);
  }

  async function requestChromecastPlayback() {
    if (remoteState === "preparing") return;
    if (!chromecastEnabled) {
      setRemoteState("idle");
      setRemoteMessage("Activa Chromecast en Perfil antes de compartir un flujo de video.");
      return;
    }
    if (!companionOnline || !companionMountedDiskIds.includes(file.diskId)) {
      setRemoteState("idle");
      setRemoteMessage(remoteAvailabilityMessage);
      return;
    }

    const mode = playbackSupport.result === "" && playbackSupport.remuxUseful ? "remux" : "original";
    if (remoteSessionId) await stopRemotePlayback("", false);
    setRemoteState("preparing");
    setRemoteMode(mode);
    setRemoteMessage("Preparando un enlace temporal para Chromecast...");
    let sessionId: string | null = null;
    try {
      const response = await api<StreamSessionResponse>("/api/stream-sessions", {
        method: "POST",
        body: JSON.stringify({ fileId: file.id, mode })
      });
      sessionId = response.session.id;
      setRemoteSessionId(sessionId);
      const access = await api<CastAccessResponse>(`/api/stream-sessions/${sessionId}/cast-access`, {
        method: "POST",
        body: JSON.stringify({})
      });
      const cast = await castVideo({
        url: new URL(access.path, window.location.origin).toString(),
        contentType: access.mimeType,
        title: file.filename,
        subtitle: file.disk?.name
      });
      setRemoteState("playing");
      setRemoteMessage(`Reproduciendo en ${cast.deviceName}.`);
    } catch (error) {
      if (sessionId) {
        await api(`/api/stream-sessions/${sessionId}`, { method: "DELETE" }).catch(() => undefined);
      }
      setRemoteSessionId(null);
      setRemoteState("error");
      setRemoteMessage(error instanceof Error ? error.message : "No se pudo iniciar Chromecast.");
    }
  }

  async function requestRemoteFullscreen(automatic = false) {
    if (automatic && remoteFullscreenAttemptedRef.current) return;
    const video = remoteVideoRef.current;
    const player = remotePlayerRef.current;
    if (!player) return;

    remoteFullscreenAttemptedRef.current = true;
    try {
      if (player.requestFullscreen) {
        await player.requestFullscreen();
      } else if (video) {
        (video as HTMLVideoElement & { webkitEnterFullscreen?: () => void }).webkitEnterFullscreen?.();
      }
    } catch {
      remoteFullscreenAttemptedRef.current = false;
      // Browsers may require a direct gesture. The manual fullscreen control remains available.
    }

    try {
      const orientation = window.screen.orientation as ScreenOrientation & { lock?: (orientation: "landscape") => Promise<void> };
      await orientation?.lock?.("landscape");
    } catch {
      // Orientation lock is optional and unavailable on several mobile browsers.
    }
  }

  function showRemoteSeekFeedback(side: "back" | "forward") {
    setRemoteSeekFeedback(side);
    if (remoteSeekFeedbackTimerRef.current != null) {
      window.clearTimeout(remoteSeekFeedbackTimerRef.current);
    }
    remoteSeekFeedbackTimerRef.current = window.setTimeout(() => setRemoteSeekFeedback(null), 650);
  }

  function scheduleRemoteControlsHide() {
    if (remoteControlsTimerRef.current != null) window.clearTimeout(remoteControlsTimerRef.current);
    remoteControlsTimerRef.current = window.setTimeout(() => {
      const video = remoteVideoRef.current;
      if (video && !video.paused) setRemoteControlsVisible(false);
    }, 3200);
  }

  function toggleRemoteControls() {
    setRemoteControlsVisible((current) => {
      const next = !current;
      if (next) scheduleRemoteControlsHide();
      return next;
    });
  }

  function revealRemoteControls() {
    setRemoteControlsVisible(true);
    scheduleRemoteControlsHide();
  }

  function seekRemoteBy(seconds: number) {
    const video = remoteVideoRef.current;
    if (!video) return;
    const maxTime = Number.isFinite(video.duration) ? video.duration : Number.MAX_SAFE_INTEGER;
    video.currentTime = Math.max(0, Math.min(maxTime, video.currentTime + seconds));
    showRemoteSeekFeedback(seconds < 0 ? "back" : "forward");
  }

  async function toggleRemotePlayback() {
    const video = remoteVideoRef.current;
    if (!video) return;
    if (video.paused) {
      try {
        await video.play();
      } catch {
        setRemoteState("error");
        setRemoteMessage("El navegador bloqueó la reanudación. Toca nuevamente el botón de reproducir.");
      }
    } else {
      video.pause();
    }
  }

  function prepareRemoteTransition() {
    remoteTransitioningRef.current = true;
    remoteVideoRef.current?.pause();
    remoteTransitionSessionRef.current = remoteSessionId;
    remoteSessionIdRef.current = null;
    setRemoteSessionId(null);
    setRemoteState("preparing");
    setRemoteMessage("");
    setRemoteCurrentTime(0);
    setRemoteDuration(0);
    setRemoteControlsVisible(false);
    remotePlayNextRef.current = remoteMode;
  }

  async function moveDetail(direction: -1 | 1, continueRemotePlayback = false) {
    const move = direction === -1 ? onPrevious : onNext;
    if ((direction === -1 && !canOpenPrevious) || (direction === 1 && !canOpenNext)) return;
    const wasRemote = Boolean(remoteSessionId || remoteUrl);
    if (continueRemotePlayback && wasRemote) {
      prepareRemoteTransition();
    } else if (wasRemote) {
      await stopRemotePlayback();
    }
    try {
      await move();
    } catch (error) {
      remotePlayNextRef.current = null;
      setRemoteState("error");
      setRemoteMessage(error instanceof Error ? error.message : "No se pudo abrir el siguiente video.");
    }
  }

  async function moveToRandomDetail(continueRemotePlayback = false) {
    if (!companionOnline || companionMountedDiskIds.length === 0) {
      setRemoteState("error");
      setRemoteMessage("No hay discos conectados disponibles para elegir otro video al azar.");
      revealRemoteControls();
      return;
    }

    const wasRemote = Boolean(remoteSessionId || remoteUrl);
    if (continueRemotePlayback && wasRemote) {
      prepareRemoteTransition();
    } else if (wasRemote) {
      await stopRemotePlayback();
    }

    try {
      await onRandom(file.id);
    } catch (error) {
      remotePlayNextRef.current = null;
      setRemoteState("error");
      setRemoteMessage(error instanceof Error ? error.message : "No se pudo elegir otro video al azar.");
      revealRemoteControls();
    }
  }

  function toggleRemoteShuffle() {
    setRemoteShuffleEnabled((current) => {
      const next = !current;
      localStorage.setItem("videocat-remote-shuffle", String(next));
      return next;
    });
    revealRemoteControls();
  }

  function advanceRemotePlayback() {
    if (remoteShuffleEnabled) {
      void moveToRandomDetail(true);
      return;
    }
    void moveDetail(1, true);
  }

  function handleRemoteVideoPointerUp(event: ReactPointerEvent<HTMLVideoElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const side = event.clientX - bounds.left < bounds.width / 2 ? "back" : "forward";
    const now = Date.now();
    const previousTap = remoteTapRef.current;
    if (!previousTap || previousTap.side !== side || now - previousTap.at > 320) {
      remoteTapRef.current = { side, at: now };
      if (remoteSingleTapTimerRef.current != null) window.clearTimeout(remoteSingleTapTimerRef.current);
      remoteSingleTapTimerRef.current = window.setTimeout(() => {
        remoteTapRef.current = null;
        toggleRemoteControls();
      }, 320);
      return;
    }

    event.preventDefault();
    remoteTapRef.current = null;
    if (remoteSingleTapTimerRef.current != null) {
      window.clearTimeout(remoteSingleTapTimerRef.current);
      remoteSingleTapTimerRef.current = null;
    }
    seekRemoteBy(side === "back" ? -10 : 10);
  }

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (deletePromptOpen) {
        if (event.key === "Escape") {
          event.preventDefault();
          setDeletePromptOpen(false);
          setDeleteConfirmText("");
        }
        return;
      }

      if (galleryIndex != null) return;
      if (isEditableTarget(event.target)) return;

      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft" && canOpenPrevious) {
        event.preventDefault();
        void moveDetail(-1);
      }
      if (event.key === "ArrowRight" && canOpenNext) {
        event.preventDefault();
        void moveDetail(1);
      }
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [canOpenNext, canOpenNextImage, canOpenPrevious, canOpenPreviousImage, deletePromptOpen, galleryIndex, onClose, onNext, onPrevious]);

  function requestDeleteFile() {
    setDeleteConfirmText("");
    setDeletePromptOpen(true);
  }

  function confirmDeleteFile() {
    if (deleteConfirmText !== "BORRAR" || companionBusy === "delete-file") return;
    setDeletePromptOpen(false);
    setDeleteConfirmText("");
    void callCompanion("delete-file");
  }

  const primaryActions = (
    <div className="detail-primary-actions">
      <button
        className="detail-primary-action"
        disabled={companionBusy === "open-file"}
        onClick={() => void callCompanion("open-file")}
        title="Reproducir video"
        aria-label="Reproducir video"
        type="button"
      >
        <Play size={20} />
      </button>
      <button
        className={`detail-primary-action is-remote ${canStreamRemotely && playbackSupport.result !== "" ? "" : "is-unavailable"}`}
        disabled={remoteState === "preparing"}
        onClick={() => requestRemotePlayback()}
        title={remoteAvailabilityMessage || "Reproducir remotamente"}
        aria-label="Reproducir remotamente"
        type="button"
      >
        <MonitorPlay size={20} />
      </button>
      {chromecastEnabled ? (
        <button
          className={`detail-primary-action is-cast ${canStreamRemotely ? "" : "is-unavailable"}`}
          disabled={remoteState === "preparing"}
          onClick={() => void requestChromecastPlayback()}
          title="Reproducir en Chromecast"
          aria-label="Reproducir en Chromecast"
          type="button"
        >
          <Cast size={20} />
        </button>
      ) : null}
      {playbackSupport.result === "" && playbackSupport.remuxUseful ? (
        <button
          className="detail-primary-action is-remux"
          disabled={remoteState === "preparing"}
          onClick={() => requestRemotePlayback("remux")}
          title="Preparar un MP4 temporal compatible"
          aria-label="Preparar un MP4 temporal compatible"
          type="button"
        >
          <FileVideo size={20} />
        </button>
      ) : null}
      <button
        className="detail-primary-action is-folder"
        disabled={companionBusy === "open-folder"}
        onClick={() => void callCompanion("open-folder")}
        title="Abrir carpeta local"
        aria-label="Abrir carpeta local"
        type="button"
      >
        <FolderOpen size={20} />
      </button>
      <button
        className="detail-primary-action is-danger"
        disabled={companionBusy === "delete-file"}
        onClick={requestDeleteFile}
        title="Borrar archivo fisicamente"
        aria-label="Borrar archivo fisicamente"
        type="button"
      >
        <Trash2 size={20} />
      </button>
    </div>
  );
  const categoryActions = (
    <div className="curation-actions" aria-label="Categoria del video">
      {categories.map((category) => {
        const active = hasFileCategory(file, category.key);
        return (
        <button
          key={category.key}
          className={`curation-action is-${category.key} ${active ? "is-active" : ""}`}
          style={categoryStyle(category.key, categories)}
          onClick={() => onToggleCategory(category.key, !active)}
          type="button"
        >
          {category.label}
        </button>
        );
      })}
    </div>
  );
  const playbackNotices = (
    <>
      {!remoteUrl && remoteState !== "preparing" && remoteAvailabilityMessage ? (
        <div className="remote-playback-hint" role="status">{remoteAvailabilityMessage}</div>
      ) : null}
      {!remoteUrl && remoteState !== "preparing" && remoteMessage ? (
        <div className={`remote-playback-feedback ${remoteState === "error" ? "is-error" : ""}`} role="status" aria-live="polite">
          {remoteMessage}
        </div>
      ) : null}

    </>
  );
  const remotePlayer = (
    <>
      {remoteUrl || remoteState === "preparing" ? (
        <section className={`remote-player ${remoteControlsVisible ? "is-controls-visible" : ""}`} aria-label="Reproducción remota" ref={remotePlayerRef}>
          <header className="remote-player-header">
            <div>
              <span className={`remote-player-status is-${remoteState}`} />
              {!remoteTransitioning ? <strong>{remoteStatusLabel}</strong> : null}
            </div>
            <button className="remote-stop-button" onClick={() => void stopRemotePlayback("Reproducción remota detenida.")} type="button">
              Detener
            </button>
          </header>
          {remoteUrl ? (
            <>
              <video
                autoPlay
                playsInline
                preload="metadata"
                ref={remoteVideoRef}
                src={remoteUrl}
                onLoadedMetadata={(event) => {
                  const video = event.currentTarget;
                  finishRemoteTransition();
                  setRemoteDuration(Number.isFinite(video.duration) ? video.duration : 0);
                  if (remoteResumeTimeRef.current > 0) {
                    video.currentTime = Math.min(remoteResumeTimeRef.current, video.duration || remoteResumeTimeRef.current);
                    remoteResumeTimeRef.current = 0;
                  }
                  void requestRemoteFullscreen(true);
                }}
                onDurationChange={(event) => setRemoteDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
                onTimeUpdate={(event) => setRemoteCurrentTime(event.currentTarget.currentTime)}
                onPlaying={() => {
                  remoteTransitioningRef.current = false;
                  setRemoteState("playing");
                  setRemoteMessage("");
                  scheduleRemoteControlsHide();
                }}
                onPause={(event) => {
                  if (!remoteTransitioningRef.current && !event.currentTarget.ended && event.currentTarget.readyState > 0) {
                    setRemoteState("paused");
                  }
                }}
                onWaiting={() => {
                  setRemoteState("buffering");
                }}
                onSeeking={() => {
                  setRemoteState("buffering");
                  setRemoteMessage("Buscando la nueva posición...");
                }}
                onSeeked={(event) => {
                  setRemoteState(event.currentTarget.paused ? "paused" : "playing");
                  setRemoteMessage("");
                }}
                onCanPlay={() => {
                  setRemoteState((current) => current === "preparing" ? "buffering" : current);
                  void requestRemoteFullscreen(true);
                }}
                onPointerUp={handleRemoteVideoPointerUp}
                onEnded={() => {
                  if (remoteShuffleEnabled) {
                    void moveToRandomDetail(true);
                  } else {
                    void stopRemotePlayback("Reproducción remota finalizada.");
                  }
                }}
                onError={(event) => {
                  const video = event.currentTarget;
                  if (remoteSessionId && companionOnline && remoteRecoveryAttemptsRef.current < 1) {
                    remoteRecoveryAttemptsRef.current += 1;
                    remoteResumeTimeRef.current = video.currentTime;
                    setRemoteState("buffering");
                    setRemoteMessage("Reconectando el segmento de video...");
                    remoteRecoveryTimerRef.current = window.setTimeout(() => {
                      setRemoteUrl(`/api/streams/${remoteSessionId}/content?retry=${Date.now()}`);
                    }, 450);
                    return;
                  }
                  const sessionId = remoteSessionId;
                  const mediaCode = video.error?.code;
                  finishRemoteTransition();
                  remoteTransitioningRef.current = false;
                  setRemoteUrl(null);
                  setRemoteSessionId(null);
                  setRemoteState("error");
                  setRemoteMessage(mediaCode === MediaError.MEDIA_ERR_DECODE
                    ? "El navegador no pudo decodificar este formato de video. Prueba la opción MP4 cuando esté disponible."
                    : "La reproducción remota se interrumpió después del reintento. Verifica el Companion y vuelve a iniciar el video.");
                  if (sessionId) {
                    void api(`/api/stream-sessions/${sessionId}`, { method: "DELETE" }).catch(() => undefined);
                  }
                }}
              />
              {remoteState === "buffering" || remoteState === "preparing" ? (
                <div className="remote-loading-overlay" aria-live="polite">
                  <span className="remote-loading-spinner" />
                  {remoteLoadingLabel ? <strong>{remoteLoadingLabel}</strong> : null}
                </div>
              ) : null}
              <div className="remote-quick-controls" aria-label="Controles rápidos del reproductor" onPointerDown={revealRemoteControls}>
                <button type="button" onClick={() => seekRemoteBy(-10)} title="Retroceder 10 segundos" aria-label="Retroceder 10 segundos">
                  <RotateCcw size={20} /><span>10</span>
                </button>
                <button className="is-primary" type="button" onClick={() => void toggleRemotePlayback()} title={remoteState === "paused" ? "Reanudar" : "Pausar"} aria-label={remoteState === "paused" ? "Reanudar" : "Pausar"}>
                  {remoteState === "paused" ? <Play size={22} /> : <Pause size={22} />}
                </button>
                <button type="button" onClick={() => seekRemoteBy(10)} title="Adelantar 10 segundos" aria-label="Adelantar 10 segundos">
                  <RotateCw size={20} /><span>10</span>
                </button>
                <label className="remote-timeline">
                  <span>{formatDuration(remoteCurrentTime)} / {formatDuration(remoteDuration)}</span>
                  <input
                    type="range"
                    min="0"
                    max={Math.max(remoteDuration, 0)}
                    step="0.1"
                    value={Math.min(remoteCurrentTime, remoteDuration || 0)}
                    onChange={(event) => {
                      const video = remoteVideoRef.current;
                      if (video) video.currentTime = Number(event.target.value);
                    }}
                    aria-label="Posición del video"
                  />
                </label>
                <button type="button" onClick={() => void requestRemoteFullscreen()} title="Pantalla completa" aria-label="Pantalla completa">
                  <Maximize size={21} />
                </button>
                <button
                  className={remoteShuffleEnabled ? "is-toggle-active" : ""}
                  type="button"
                  onClick={toggleRemoteShuffle}
                  title={remoteShuffleEnabled ? "Desactivar reproducción aleatoria" : "Activar reproducción aleatoria"}
                  aria-label={remoteShuffleEnabled ? "Desactivar reproducción aleatoria" : "Activar reproducción aleatoria"}
                  aria-pressed={remoteShuffleEnabled}
                >
                  <Shuffle size={21} />
                </button>
                <button
                  type="button"
                  disabled={remoteShuffleEnabled ? !companionOnline || companionMountedDiskIds.length === 0 : !canOpenNext}
                  onClick={advanceRemotePlayback}
                  title={remoteShuffleEnabled ? "Reproducir otro video al azar" : "Reproducir el siguiente video"}
                  aria-label={remoteShuffleEnabled ? "Reproducir otro video al azar" : "Reproducir el siguiente video"}
                >
                  <SkipForward size={22} />
                </button>
              </div>
            </>
          ) : (
            <div className="remote-preparing" aria-live="polite">
              <span className="remote-loading-spinner" />
              {!remoteTransitioning ? (
                <div>
                  <strong>{remoteMode === "remux" ? "Preparando video compatible" : "Conectando con tu Companion"}</strong>
                  <span>{file.filename}</span>
                  <small>{remoteMessage || "Esto puede tardar unos segundos."}</small>
                </div>
              ) : null}
            </div>
          )}
          {remoteSeekFeedback ? (
            <span className={`remote-seek-feedback is-${remoteSeekFeedback}`} aria-live="polite">
              {remoteSeekFeedback === "back" ? "-10 s" : "+10 s"}
            </span>
          ) : null}
        </section>
      ) : null}

    </>
  );
  const hasRemotePlayer = Boolean(remoteUrl) || remoteState === "preparing";
  const compatibilityNotice = (
    <>
      {playbackSupport.result === "" ? (
        <div className="stream-compatibility-notice">
          <strong>Este navegador no declara compatibilidad con {file.videoCodec ?? file.extension}.</strong>
          <span>{playbackSupport.remuxUseful ? "Puedes preparar un MP4 temporal con el botón adicional, si el remux opcional está habilitado en el Companion." : "Ábrelo localmente o usa un navegador con soporte para este codec."}</span>
        </div>
      ) : null}

    </>
  );
  const thumbStrip = (
    <div className="thumb-strip">
      {file.thumbnails.length > 0 ? (
        file.thumbnails.map((thumb, index) => (
          <button
            key={thumb.id}
            className="thumb-button"
            onClick={() => setGalleryIndex(index)}
            type="button"
            title="Ver captura"
          >
            <img src={thumb.url} alt="" />
          </button>
        ))
      ) : (
        <div className="no-thumbs">Sin miniaturas</div>
      )}
    </div>

  );
  const detailGrid = (
    <div className="detail-grid">
      <Info label="Ruta relativa" value={file.relativePath} copy />
      <Info
        label="Ruta absoluta escaneada"
        value={file.absolutePath}
        copy
        openKind="file"
        openBusy={companionBusy === "open-file"}
        onOpen={() => void callCompanion("open-file")}
      />
      <Info
        label="Carpeta local"
        value={localFolder}
        copy
        openKind="folder"
        openBusy={companionBusy === "open-folder"}
        onOpen={() => void callCompanion("open-folder")}
      />
      <Info label="Tamano exacto" value={`${file.sizeBytes} bytes (${formatBytes(file.sizeBytes)})`} />
      <Info label="Tamano del folder" value={file.folderSizeBytes != null ? formatBytes(file.folderSizeBytes) : "-"} />
      <Info label="Duracion" value={formatDuration(file.durationSeconds)} />
      <Info label="Resolucion" value={resolution(file)} />
      <Info label="FPS" value={file.fps?.toFixed(3) ?? "-"} />
      <Info label="Video" value={file.videoCodec ?? "-"} />
      <Info label="Audio" value={file.audioCodec ?? "-"} />
      <Info label="Bitrate" value={file.bitrate ? `${file.bitrate} bps` : "-"} />
      <Info label="Ultima vez indexado" value={dateLabel(file.lastIndexedAt, locale)} />
      <Info
        label="Etiquetas"
        value={categoryKeysForFile(file).map((key) => categoryLabel(key, categories)).join(", ") || "Sin marcar"}
      />
      <Info label="Estado" value={file.scanStatus} />
    </div>

  );
  const companionStatus = (
    <>
      {companionMessage ? <div className="companion-status">{companionMessage}</div> : null}

    </>
  );
  const duplicatesSection = (
    <>
      {duplicates.length > 0 ? (
        <section className="duplicates">
          <h3>Posibles duplicados</h3>
          {duplicates.map((duplicate) => (
            <button key={duplicate.id} className="duplicate-row">
              <span>{duplicate.filename}</span>
              <small>
                {duplicate.disk?.name} · {duplicate.relativePath}
                {duplicate.duplicateConfidence != null
                  ? ` · ${duplicate.duplicateConfidence}% ${translateText("de confianza", locale.toLowerCase().startsWith("en") ? "en" : "es")}`
                  : ""}
              </small>
            </button>
          ))}
        </section>
      ) : null}

    </>
  );
  const jsonBlock = (
    <details className="json-block">
      <summary>JSON tecnico</summary>
      <pre>{json}</pre>
    </details>
  );
  const overlays = (
    <>
      {galleryThumb ? (
        <FullscreenGallery
          thumbnail={galleryThumb}
          index={galleryIndex ?? 0}
          total={file.thumbnails.length}
          canOpenPrevious={canOpenPreviousImage}
          canOpenNext={canOpenNextImage}
          onMove={moveGallery}
          onClose={() => setGalleryIndex(null)}
        />
      ) : null}
      {deletePromptOpen ? (
        <DeleteFileConfirmModal
          filename={file.filename}
          relativePath={file.relativePath}
          value={deleteConfirmText}
          submitting={companionBusy === "delete-file"}
          onChange={setDeleteConfirmText}
          onCancel={() => {
            setDeletePromptOpen(false);
            setDeleteConfirmText("");
          }}
          onConfirm={confirmDeleteFile}
        />
      ) : null}
    </>
  );

  if (variant === "panel") {
    const heroThumbnail = mainThumbnail(file);
    return (
      <aside className="vc-detail" aria-label="Detalle del video">
        <div className="vc-detail-toolbar">
          <button className="vc-icon-button is-small" onClick={() => void moveDetail(-1)} disabled={!canOpenPrevious} type="button" title="Video anterior" aria-label="Video anterior">
            <ChevronLeft size={16} />
          </button>
          <button className="vc-icon-button is-small" onClick={() => void moveDetail(1)} disabled={!canOpenNext} type="button" title="Video siguiente" aria-label="Video siguiente">
            <ChevronRight size={16} />
          </button>
          <span className="vc-detail-disk">{file.disk?.name}</span>
          <button className="vc-icon-button is-small is-ghost" onClick={onClose} type="button" title="Cerrar" aria-label="Cerrar detalle">
            <X size={17} />
          </button>
        </div>
        {hasRemotePlayer ? remotePlayer : (
          <div className="vc-detail-hero">
            {heroThumbnail ? <img src={heroThumbnail} alt="" /> : <Image size={34} aria-hidden="true" />}
            <button
              className={`vc-detail-play ${canStreamRemotely && playbackSupport.result !== "" ? "" : "is-unavailable"}`}
              onClick={() => requestRemotePlayback()}
              title={remoteAvailabilityMessage || "Reproducir remotamente"}
              aria-label="Reproducir remotamente"
              type="button"
            >
              <Play size={26} />
            </button>
            {file.durationSeconds ? <span className="vc-detail-duration">{formatDuration(file.durationSeconds)}</span> : null}
          </div>
        )}
        {playbackNotices}
        {compatibilityNotice}
        {thumbStrip}
        <div className="vc-detail-title">
          <h2>{file.filename}</h2>
          <span>{file.relativePath}</span>
        </div>
        {primaryActions}
        <div className="vc-detail-section">
          <span className="vc-overline">Categorías</span>
          {categoryActions}
        </div>
        <dl className="vc-detail-facts">
          <div><dt>Resolución</dt><dd>{resolution(file)}</dd></div>
          <div><dt>Duración</dt><dd>{formatDuration(file.durationSeconds)}</dd></div>
          <div><dt>Tamaño</dt><dd>{formatBytes(file.sizeBytes)}</dd></div>
          <div><dt>Formato</dt><dd>{[file.extension.toUpperCase(), file.videoCodec, file.audioCodec].filter(Boolean).join(" · ")}</dd></div>
          <div><dt>Carpeta</dt><dd>{file.folderSizeBytes != null ? formatBytes(file.folderSizeBytes) : "-"}</dd></div>
          <div><dt>Indexado</dt><dd>{dateLabel(file.lastIndexedAt, locale)}</dd></div>
        </dl>
        {companionStatus}
        {duplicatesSection}
        <details className="vc-detail-more">
          <summary>Más información</summary>
          {detailGrid}
          {jsonBlock}
        </details>
        <p className="vc-detail-keys"><kbd>←</kbd> <kbd>→</kbd> navegar · <kbd>Esc</kbd> cerrar</p>
        {overlays}
      </aside>
    );
  }

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <button
        className="modal-nav modal-nav-prev"
        onClick={() => void moveDetail(-1)}
        disabled={!canOpenPrevious}
        type="button"
        title="Video anterior"
      >
        <ChevronLeft size={26} />
      </button>
      <section className="detail-panel">
        <header className="detail-header">
          <div className="detail-title-block">
            <span>{file.disk?.name}</span>
            <h2>{file.filename}</h2>
            {primaryActions}
          </div>
          <div className="detail-header-actions">
            {categoryActions}
            <button className="icon-button" onClick={onClose} title="Cerrar">
              <X size={20} />
            </button>
          </div>
        </header>

        {playbackNotices}
        {hasRemotePlayer ? remotePlayer : null}
        {compatibilityNotice}
        {thumbStrip}
        {detailGrid}
        {companionStatus}
        {duplicatesSection}
        {jsonBlock}
      </section>
      <button
        className="modal-nav modal-nav-next"
        onClick={() => void moveDetail(1)}
        disabled={!canOpenNext}
        type="button"
        title="Video siguiente"
      >
        <ChevronRight size={26} />
      </button>
      {overlays}
    </div>
  );
}
