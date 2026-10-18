// What the Companion is doing right now (copying, verifying, downloading, scanning, deleting),
// sent to the server at most once per interval so the web can show it live.

export type ActivityKind = "transfer" | "download" | "scan" | "delete";

export type ActivityPhase =
  | "staging"
  | "verifying_staging"
  | "delivering"
  | "verifying_target"
  | "downloading"
  | "scanning"
  | "deleting";

export type Activity = {
  kind: ActivityKind;
  phase: ActivityPhase;
  filename?: string | null;
  from?: string | null;
  to?: string | null;
  bytesDone?: number | null;
  bytesTotal?: number | null;
  filesDone?: number | null;
  filesTotal?: number | null;
  startedAt: number;
};

export type ReportedActivity = Activity & { bytesPerSecond: number | null };

export type TransfersMode = "running" | "stopping" | "stopped";

// transfersWaiting: transfers stepped aside while the download queue runs (see work-priority.ts).
// transfersMode: "Detener traslados" from the web: stopping while the file in progress finishes.
type Sender = (activities: ReportedActivity[], status: { transfersWaiting: boolean; transfersMode: TransfersMode }) => Promise<void>;

const speedWindowMs = 5000;

export class ActivityReporter {
  private readonly current = new Map<string, Activity>();
  private readonly samples = new Map<string, Array<{ at: number; bytes: number }>>();
  private timer: NodeJS.Timeout | null = null;
  private sending = false;
  private dirty = false;
  private waiting = false;
  private mode: TransfersMode = "running";
  // Told when the Companion starts or stops doing anything (the tray icon animates meanwhile).
  onBusyChange: ((busy: boolean) => void) | null = null;

  constructor(private readonly send: Sender, private readonly intervalMs = 1000, private readonly now = () => Date.now()) {}

  // Starts or updates one activity; the key keeps parallel work (a download and a transfer) apart.
  set(key: string, activity: Omit<Activity, "startedAt"> & { startedAt?: number }): void {
    const previous = this.current.get(key);
    const wasIdle = this.current.size === 0;
    const startedAt = previous && previous.phase === activity.phase ? previous.startedAt : activity.startedAt ?? this.now();
    if (!previous || previous.phase !== activity.phase) this.samples.delete(key);
    this.current.set(key, { ...activity, startedAt });
    if (wasIdle) this.onBusyChange?.(true);
    if (activity.bytesDone != null) {
      const list = this.samples.get(key) ?? [];
      list.push({ at: this.now(), bytes: activity.bytesDone });
      while (list.length > 1 && this.now() - list[0].at > speedWindowMs) list.shift();
      this.samples.set(key, list);
    }
    this.schedule();
  }

  clear(key: string): void {
    if (!this.current.delete(key)) return;
    this.samples.delete(key);
    if (this.current.size === 0) this.onBusyChange?.(false);
    this.schedule();
  }

  setTransfersWaiting(waiting: boolean): void {
    if (this.waiting === waiting) return;
    this.waiting = waiting;
    this.schedule();
  }

  transfersWaiting(): boolean {
    return this.waiting;
  }

  setTransfersMode(mode: TransfersMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.schedule();
  }

  transfersMode(): TransfersMode {
    return this.mode;
  }

  snapshot(): ReportedActivity[] {
    return [...this.current.entries()].map(([key, activity]) => ({ ...activity, bytesPerSecond: this.speed(key) }));
  }

  private speed(key: string): number | null {
    const list = this.samples.get(key);
    if (!list || list.length < 2) return null;
    const first = list[0];
    const last = list[list.length - 1];
    const seconds = (last.at - first.at) / 1000;
    return seconds > 0 ? Math.max(0, (last.bytes - first.bytes) / seconds) : null;
  }

  private schedule(): void {
    this.dirty = true;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.intervalMs);
    this.timer.unref?.();
  }

  async flush(): Promise<void> {
    if (this.sending || !this.dirty) return;
    this.sending = true;
    this.dirty = false;
    try {
      await this.send(this.snapshot(), { transfersWaiting: this.waiting, transfersMode: this.mode });
    } catch {
      // The next update retries; activity is informative only.
    } finally {
      this.sending = false;
      if (this.dirty) this.schedule();
    }
  }
}
