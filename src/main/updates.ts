import type { UpdateState } from '../shared/model';

export const releaseRepository = 'younghoandrewchaa/task-tick';
export const updateManifestName = 'update-darwin-arm64.json';
export const CHECK_COOLDOWN_MS = 24 * 60 * 60_000;
// The website's "latest" download link avoids the rate-limited GitHub API.
const latestManifestUrl = `https://github.com/${releaseRepository}/releases/latest/download/${updateManifestName}`;

export async function fetchLatestRelease(
  fetcher: (url: string, options: RequestInit) => Promise<Response>,
): Promise<unknown> {
  const response = await fetcher(latestManifestUrl, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
  return response.json();
}

interface Release {
  version: string;
  feedUrl: string;
}

function stableVersion(value: unknown): number[] | undefined {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value))
    return;
  const parts = value.split('.').map(Number);
  if (parts.every(Number.isSafeInteger)) return parts;
}

/** Returns the manifest's release when it is newer and its ZIP lives in this repo's release. */
export function selectRelease(value: unknown, currentVersion: string): Release | undefined {
  if (!value || typeof value !== 'object') return;
  const release = value as Record<string, unknown>;
  if (typeof release.currentRelease !== 'string') return;
  const version = release.currentRelease;
  const next = stableVersion(version),
    current = stableVersion(currentVersion);
  if (!next || !current) return;
  const difference = next.map((part, i) => part - current[i]).find((part) => part !== 0);
  if (!difference || difference < 0 || !Array.isArray(release.releases)) return;
  const base = `https://github.com/${releaseRepository}/releases/download/v${version}/`;
  const hasAsset = release.releases.some((entry: unknown) => {
    if (!entry || typeof entry !== 'object') return false;
    const item = entry as Record<string, unknown>;
    if (item.version !== version || !item.updateTo || typeof item.updateTo !== 'object')
      return false;
    return (
      (item.updateTo as Record<string, unknown>).url ===
      `${base}TaskTick-darwin-arm64-${version}.zip`
    );
  });
  if (!hasAsset) return;
  return { version, feedUrl: `${base}${updateManifestName}` };
}

export interface NativeUpdater {
  on(event: string, listener: (...args: any[]) => void): unknown;
  setFeedURL(options: { url: string; serverType: 'json' }): void;
  checkForUpdates(): void;
  quitAndInstall(): void;
}

export interface UpdateOptions {
  version: string;
  enabled: boolean;
  native: NativeUpdater;
  fetchRelease(): Promise<unknown>;
  confirm(latestVersion: string): Promise<boolean>;
  publish(state: UpdateState): void;
  /** Runs just before quitting to install; failures must not block the update. */
  beforeRestart?(): void;
  /** Undoes `beforeRestart` when the restart could not begin. */
  restartFailed?(): void;
  now?: () => number;
}

const installFailed = 'Update failed. Click to try again.';

export class UpdateManager {
  private state: UpdateState;
  private candidate?: Release;
  private lastCheck = -Infinity;
  private downloaded = false;
  private options: UpdateOptions;

  constructor(options: UpdateOptions) {
    this.options = options;
    this.state = { version: options.version, status: options.enabled ? 'idle' : 'disabled' };
    options.native.on('error', () => {
      if (this.state.status === 'downloading' || this.state.status === 'installing')
        this.setState('error', installFailed);
    });
    options.native.on('update-not-available', () => {
      if (this.state.status !== 'downloading') return;
      this.candidate = undefined;
      this.setState('idle');
    });
    options.native.on('update-downloaded', () => {
      if (this.state.status !== 'downloading') return;
      this.downloaded = true;
      this.restart();
    });
  }

  getState(): UpdateState {
    return { ...this.state };
  }
  get isInstalling(): boolean {
    return this.state.status === 'installing';
  }
  private get busy(): boolean {
    return ['checking', 'confirming', 'downloading', 'installing'].includes(this.state.status);
  }
  private setState(status: UpdateState['status'], message?: string): void {
    this.state = {
      version: this.options.version,
      status,
      ...(this.candidate ? { latestVersion: this.candidate.version } : {}),
      ...(message ? { message } : {}),
    };
    this.options.publish(this.getState());
  }

  /** Fetches the manifest at most once per day; failures stay quiet and retry next time. */
  async check(): Promise<void> {
    if (!this.options.enabled || this.busy || this.downloaded) return;
    const now = (this.options.now ?? Date.now)();
    if (now - this.lastCheck < CHECK_COOLDOWN_MS) return;
    this.lastCheck = now;
    this.setState('checking');
    try {
      this.candidate = selectRelease(await this.options.fetchRelease(), this.options.version);
      this.setState(this.candidate ? 'available' : 'idle');
    } catch (error) {
      this.lastCheck = -Infinity;
      console.error('Could not check for TaskTick updates:', error);
      this.setState(this.candidate ? 'available' : 'idle');
    }
  }

  async install(): Promise<void> {
    if (!this.options.enabled || this.busy || !this.candidate) return;
    this.setState('confirming');
    try {
      if (!(await this.options.confirm(this.candidate.version))) {
        this.setState('available');
        return;
      }
      if (this.downloaded) {
        this.restart();
        return;
      }
      this.setState('downloading');
      this.options.native.setFeedURL({ url: this.candidate.feedUrl, serverType: 'json' });
      this.options.native.checkForUpdates();
    } catch {
      this.setState('error', installFailed);
    }
  }

  private restart(): void {
    this.setState('installing');
    try {
      this.options.beforeRestart?.();
    } catch (error) {
      console.error('Could not prepare TaskTick to restart:', error);
    }
    try {
      this.options.native.quitAndInstall();
    } catch {
      try {
        this.options.restartFailed?.();
      } catch {
        /* Best effort. */
      }
      this.setState('error', 'Could not restart. Click to try again.');
    }
  }
}
