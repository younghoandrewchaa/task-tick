import { copyFile, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AppState, StateStore } from '../shared/model';
import { emptyState, validateState } from '../core/state';
type ReadResult = { kind: 'valid'; state: AppState } | { kind: 'missing' | 'invalid' };
export class FileStateStore implements StateStore {
  constructor(readonly directory: string) {}
  private async read(name: string): Promise<ReadResult> {
    let raw: string;
    try {
      raw = await readFile(join(this.directory, name), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' };
      throw error;
    }
    try {
      return { kind: 'valid', state: validateState(JSON.parse(raw)) };
    } catch {
      return { kind: 'invalid' };
    }
  }
  async load(): Promise<{ state: AppState; warning?: string }> {
    const primary = await this.read('state.json');
    if (primary.kind === 'valid') return { state: primary.state };
    const backup = await this.read('state.backup.json');
    if (backup.kind === 'valid')
      return {
        state: backup.state,
        warning:
          'Recovered your tasks from the last saved backup. The original file will be preserved.',
      };
    if (primary.kind === 'missing' && backup.kind === 'missing') return { state: emptyState() };
    throw new Error(
      `Could not read saved tasks or recover a valid backup in ${this.directory}. Your files have been left untouched.`,
    );
  }
  private async atomicWrite(name: string, state: AppState): Promise<void> {
    const temporary = join(this.directory, `.${name}.${randomUUID()}.tmp`);
    try {
      const handle = await open(temporary, 'wx', 0o600);
      try {
        await handle.writeFile(JSON.stringify(state, null, 2) + '\n', 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, join(this.directory, name));
    } finally {
      await rm(temporary, { force: true });
    }
  }
  async save(state: AppState): Promise<void> {
    const valid = validateState(state);
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const primary = await this.read('state.json');
    if (primary.kind === 'invalid')
      await copyFile(
        join(this.directory, 'state.json'),
        join(this.directory, `state.corrupt-${Date.now()}-${randomUUID()}.json`),
        constants.COPYFILE_EXCL,
      );
    if (primary.kind === 'valid') await this.atomicWrite('state.backup.json', primary.state);
    else {
      const backup = await this.read('state.backup.json');
      // Before the first commit, the only committed truth is the empty state.
      if (backup.kind !== 'valid') await this.atomicWrite('state.backup.json', emptyState());
    }
    await this.atomicWrite('state.json', valid);
  }
}
