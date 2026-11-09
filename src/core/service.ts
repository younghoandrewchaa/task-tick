import type { Action, AppState, Expiry, Snapshot, StateStore } from '../shared/model';
import { applyAction, reconcile } from './state';
export interface ServiceOptions {
  state: AppState;
  store: StateStore;
  clock: () => number;
  id: () => string;
  onExpiry: (expiry: Expiry) => void;
  onChange?: (snapshot: Snapshot) => void;
}
export class TaskService {
  private state: AppState;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private options: ServiceOptions) {
    this.state = structuredClone(options.state);
  }
  snapshot(): Snapshot {
    return { state: structuredClone(this.state), now: this.options.clock() };
  }
  private serialized(work: () => Promise<Snapshot>): Promise<Snapshot> {
    const next = this.queue.then(work);
    this.queue = next.catch(() => undefined);
    return next;
  }
  private async commit(next: AppState): Promise<void> {
    await this.options.store.save(next);
    this.state = next;
    try {
      this.options.onChange?.(this.snapshot());
    } catch (error) {
      console.error('Snapshot listener failed', error);
    }
  }
  private async settle(): Promise<void> {
    const result = reconcile(this.state, this.options.clock());
    if (result.state !== this.state) {
      await this.commit(result.state);
      if (result.expired) {
        try {
          this.options.onExpiry(result.expired);
        } catch (error) {
          console.error('Expiry alert failed', error);
        }
      }
    }
  }
  dispatch(action: Action): Promise<Snapshot> {
    return this.serialized(async () => {
      await this.settle();
      const next = applyAction(this.state, action, this.options.clock(), this.options.id);
      await this.commit(next);
      return this.snapshot();
    });
  }
  reconcile(): Promise<Snapshot> {
    return this.serialized(async () => {
      await this.settle();
      return this.snapshot();
    });
  }
}
