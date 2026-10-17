// Downloads ("A descargar") come before transfers ("Traslados"): when downloads are waiting, the
// transfer in progress finishes its current file, then transfers wait while the whole download
// queue is processed. They resume as soon as the queue is empty or the person pauses it.
export class DownloadPriority {
  private depth = 0;
  private wanted = false;
  private yielded = false;
  private transferItem: Promise<void> | null = null;
  // Told when transfers start and stop waiting for downloads, so the web can say so.
  onWaitingChange: ((waiting: boolean) => void) | null = null;

  // A pass over several drives' queues counts as one: transfers do not slip in between drives.
  // Holding alone never stops transfers; only a claim (a download about to start) does.
  hold(): void {
    this.depth += 1;
  }

  // Downloads take the drives; resolves once the transfer file in progress (if any) is finished.
  async claim(onWait?: () => void): Promise<void> {
    this.depth += 1;
    this.wanted = true;
    if (this.transferItem) {
      onWait?.();
      await this.transferItem;
    }
  }

  // Ends a hold or a claim. True when the last one ends, downloads had the drives and transfers
  // stepped aside: they should resume right away.
  release(): boolean {
    this.depth = Math.max(0, this.depth - 1);
    if (this.depth > 0) return false;
    const resume = this.wanted && this.yielded;
    this.wanted = false;
    this.yielded = false;
    if (resume) this.onWaitingChange?.(false);
    return resume;
  }

  // Asked by transfers before every file: false while downloads hold the drives.
  transfersMayRun(): boolean {
    if (!this.wanted) return true;
    if (!this.yielded) this.onWaitingChange?.(true);
    this.yielded = true;
    return false;
  }

  // Runs one transfer file, so a download claim knows when it may start.
  async runTransferItem<T>(work: () => Promise<T>): Promise<T> {
    const running = work();
    this.transferItem = running.then(() => undefined, () => undefined);
    try {
      return await running;
    } finally {
      this.transferItem = null;
    }
  }
}
