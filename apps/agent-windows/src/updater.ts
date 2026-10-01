import { GithubSource, UpdateManager, VelopackApp, type VelopackAsset } from "velopack";

export const companionReleasesUrl = "https://github.com/reiterstahl/videocat";

export type UpdateClient = Pick<
  UpdateManager,
  "getUpdatePendingRestart" | "checkForUpdatesAsync" | "downloadUpdateAsync" | "waitExitThenApplyUpdate"
>;

/**
 * Handles Velopack install, update and uninstall hooks. It must run before the tray starts,
 * because Velopack may launch the app only to run a hook and exit.
 */
export function runVelopackHooks(): void {
  VelopackApp.build().run();
}

/** Returns null for development runs and the old portable .exe, which cannot update themselves. */
export function createUpdateClient(): UpdateClient | null {
  try {
    return new UpdateManager(new GithubSource(companionReleasesUrl, undefined, false));
  } catch {
    return null;
  }
}

/** Checks GitHub Releases, downloads new versions in the background and applies them on restart. */
export class CompanionUpdater {
  private ready: VelopackAsset | null = null;
  private running: Promise<string | null> | null = null;

  constructor(private readonly client: UpdateClient | null) {}

  get installed(): boolean {
    return this.client !== null;
  }

  get readyVersion(): string | null {
    return this.ready?.Version ?? null;
  }

  /** Returns the version downloaded and waiting for a restart, if any. Concurrent calls share one check. */
  checkAndDownload(): Promise<string | null> {
    this.running ??= this.check().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  /** Starts the Velopack updater, which waits for this process to exit, installs and relaunches. */
  applyAfterExit(): boolean {
    if (!this.client || !this.ready) return false;
    this.client.waitExitThenApplyUpdate(this.ready, true, true);
    return true;
  }

  private async check(): Promise<string | null> {
    if (!this.client) return null;
    if (this.ready) return this.ready.Version;

    const pending = this.client.getUpdatePendingRestart();
    if (pending) {
      this.ready = pending;
      return pending.Version;
    }

    const update = await this.client.checkForUpdatesAsync();
    if (!update) return null;
    await this.client.downloadUpdateAsync(update);
    this.ready = update.TargetFullRelease;
    return this.ready.Version;
  }
}
