export const DURATIONS = [15, 20, 25, 30] as const;
export type Duration = (typeof DURATIONS)[number];
export interface Task {
  id: string;
  title: string;
  durationMinutes: Duration;
  sessionCount: number;
  completedAt: number | null;
}
interface SessionBase {
  id: string;
  taskId: string;
  durationMinutes: Duration;
}
export type Session = SessionBase &
  ({ status: 'running'; deadline: number } | { status: 'paused'; remainingMs: number });
export interface AppState {
  version: 1;
  tasks: Task[];
  session: Session | null;
  settings: { launchAtLogin: boolean };
}
export interface Expiry {
  sessionId: string;
  taskId: string;
  taskTitle: string;
}
export interface Transition {
  state: AppState;
  expired: Expiry | null;
}
export type Action =
  | { type: 'add'; title: string }
  | { type: 'rename'; taskId: string; title: string }
  | { type: 'duration'; taskId: string; minutes: Duration }
  | { type: 'complete' | 'reopen' | 'delete'; taskId: string }
  | { type: 'reorder'; taskIds: string[] }
  | { type: 'start'; taskId: string }
  | { type: 'switch'; taskId: string; sessionId: string }
  | { type: 'pause' | 'resume' | 'discard'; sessionId: string }
  | { type: 'login'; enabled: boolean };
export interface Snapshot {
  state: AppState;
  now: number;
  notice?: string;
  notificationStatus?: string;
  update?: UpdateState;
}
export interface UpdateState {
  version: string;
  status:
    | 'disabled'
    | 'idle'
    | 'checking'
    | 'available'
    | 'confirming'
    | 'downloading'
    | 'installing'
    | 'error';
  latestVersion?: string;
  message?: string;
}
export type CommandResult = { ok: true; snapshot: Snapshot } | { ok: false; message: string };
export interface TaskTickAPI {
  getSnapshot(): Promise<Snapshot>;
  dispatch(action: Action): Promise<CommandResult>;
  onSnapshot(listener: (snapshot: Snapshot) => void): () => void;
  hidePanel(): Promise<void>;
  fitPanel(height: number): Promise<void>;
  quit(): Promise<void>;
  installUpdate(): Promise<void>;
}
export interface StateStore {
  load(): Promise<{ state: AppState; warning?: string }>;
  save(state: AppState): Promise<void>;
}
