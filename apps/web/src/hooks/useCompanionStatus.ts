import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { localCompanionPortCandidates } from "../lib/app-helpers";
import type { CompanionStatusResponse } from "../lib/app-types";

const pollIntervalMs = 5000;

// Tracks the local Companion listener and the server-side Companion heartbeat while signed in.
export function useCompanionStatus(authenticated: boolean) {
  const [companionMountedDiskIds, setCompanionMountedDiskIds] = useState<string[]>([]);
  const [companionMountedDiskCount, setCompanionMountedDiskCount] = useState(0);
  const [companionLocalOnline, setCompanionLocalOnline] = useState(false);
  const [companionOnline, setCompanionOnline] = useState(false);
  const [companionVersion, setCompanionVersion] = useState(0);

  function applyCompanionStatus(status: CompanionStatusResponse) {
    setCompanionOnline(status.online);
    setCompanionVersion(status.online ? (status.version ?? 0) : 0);
    setCompanionMountedDiskCount(status.online ? (status.mountedDiskCount ?? 0) : 0);
    setCompanionMountedDiskIds(status.online ? (status.mountedDiskIds ?? []) : []);
  }

  function resetCompanionStatus() {
    setCompanionOnline(false);
    setCompanionVersion(0);
    setCompanionMountedDiskCount(0);
    setCompanionMountedDiskIds([]);
  }

  useEffect(() => {
    if (!authenticated) {
      setCompanionLocalOnline(false);
      resetCompanionStatus();
      return;
    }

    let cancelled = false;

    async function checkCompanionHealth() {
      const storedPort = localStorage.getItem("videocat-companion-port");
      const ports = localCompanionPortCandidates(storedPort);
      let localOnline = false;

      for (const port of ports) {
        try {
          const response = await fetch(`http://127.0.0.1:${port}/health`, {
            cache: "no-store",
            signal: AbortSignal.timeout(700)
          });
          const result = await response.json().catch(() => ({ ok: false })) as { ok?: boolean; app?: string };
          if (response.ok && result.ok === true && result.app === "videocat-companion") {
            localStorage.setItem("videocat-companion-port", port);
            localOnline = true;
            break;
          }
        } catch {
          // Try the next known port before marking the companion offline.
        }
      }

      if (!cancelled) setCompanionLocalOnline(localOnline);

      try {
        const status = await api<CompanionStatusResponse>("/api/companion/status");
        if (!cancelled) applyCompanionStatus(status);
      } catch {
        if (!cancelled) resetCompanionStatus();
      }
    }

    void checkCompanionHealth();
    const interval = window.setInterval(() => {
      void checkCompanionHealth();
    }, pollIntervalMs);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [authenticated]);

  return {
    companionMountedDiskIds,
    setCompanionMountedDiskIds,
    companionMountedDiskCount,
    setCompanionMountedDiskCount,
    companionLocalOnline,
    companionOnline,
    setCompanionOnline,
    companionVersion,
    setCompanionVersion,
    applyCompanionStatus
  } as const;
}
