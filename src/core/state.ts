import {
  DURATIONS,
  type Action,
  type AppState,
  type Duration,
  type Transition,
} from '../shared/model';
export function emptyState(): AppState {
  return { version: 1, tasks: [], session: null, settings: { launchAtLogin: false } };
}
function check(condition: unknown, message = 'Invalid data'): asserts condition {
  if (!condition) throw new Error(message);
}
function record(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}
function text(x: unknown): x is string {
  return typeof x === 'string' && x.trim().length > 0;
}
function duration(x: unknown): x is Duration {
  return typeof x === 'number' && (DURATIONS as readonly number[]).includes(x);
}
function finite(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x) && x >= 0;
}
export function validateState(value: unknown): AppState {
  check(record(value) && value.version === 1, 'Unsupported or invalid saved data version');
  check(
    Array.isArray(value.tasks) &&
      record(value.settings) &&
      typeof value.settings.launchAtLogin === 'boolean',
  );
  const ids = new Set<string>();
  for (const task of value.tasks) {
    check(record(task) && text(task.id) && text(task.title) && duration(task.durationMinutes));
    check(Number.isSafeInteger(task.sessionCount) && (task.sessionCount as number) >= 0);
    check(task.completedAt === null || finite(task.completedAt));
    check(!ids.has(task.id), 'Duplicate task ID');
    ids.add(task.id);
  }
  if (value.session !== null) {
    const s = value.session;
    check(record(s) && text(s.id) && text(s.taskId) && duration(s.durationMinutes));
    check(
      value.tasks.some((t) => t.id === s.taskId && t.completedAt === null),
      'Session references a missing or completed task',
    );
    check(
      (s.status === 'running' && finite(s.deadline)) ||
        (s.status === 'paused' &&
          finite(s.remainingMs) &&
          s.remainingMs <= s.durationMinutes * 60000),
      'Invalid session',
    );
  }
  return structuredClone(value) as unknown as AppState;
}
export function validateAction(value: unknown): Action {
  check(record(value) && text(value.type), 'Invalid command');
  switch (value.type) {
    case 'add':
      check(text(value.title), 'Enter a task title');
      break;
    case 'rename':
      check(text(value.taskId) && text(value.title), 'Enter a task title');
      break;
    case 'duration':
      check(text(value.taskId) && duration(value.minutes), 'Choose 15, 20, 25 or 30 minutes');
      break;
    case 'complete':
    case 'reopen':
    case 'delete':
    case 'start':
      check(text(value.taskId));
      break;
    case 'switch':
      check(text(value.taskId) && text(value.sessionId));
      break;
    case 'pause':
    case 'resume':
    case 'discard':
      check(text(value.sessionId));
      break;
    case 'reorder':
      check(Array.isArray(value.taskIds) && value.taskIds.every(text));
      break;
    case 'login':
      check(typeof value.enabled === 'boolean');
      break;
    default:
      throw new Error('Unknown command');
  }
  return structuredClone(value) as unknown as Action;
}
export function reconcile(state: AppState, now: number): Transition {
  const session = state.session;
  if (!session || session.status !== 'running' || session.deadline > now)
    return { state, expired: null };
  const next = structuredClone(state),
    task = next.tasks.find((t) => t.id === session.taskId)!;
  check(Number.isSafeInteger(task.sessionCount + 1), 'Session count limit reached');
  task.sessionCount++;
  next.session = null;
  return {
    state: next,
    expired: { sessionId: session.id, taskId: task.id, taskTitle: task.title },
  };
}
export function applyAction(
  state: AppState,
  input: Action,
  now: number,
  id: () => string,
): AppState {
  const a = validateAction(input),
    s = structuredClone(state);
  const task = 'taskId' in a ? s.tasks.find((t) => t.id === a.taskId) : undefined;
  if ('taskId' in a) check(task, 'This task no longer exists');
  if ('sessionId' in a)
    check(s.session?.id === a.sessionId, 'This session has finished or changed');
  switch (a.type) {
    case 'add':
      s.tasks.push({
        id: id(),
        title: a.title.trim(),
        durationMinutes: 15,
        sessionCount: 0,
        completedAt: null,
      });
      break;
    case 'rename':
      task!.title = a.title.trim();
      break;
    case 'duration':
      check(s.session?.taskId !== a.taskId, 'Discard the session before changing its duration');
      task!.durationMinutes = a.minutes;
      break;
    case 'complete':
      task!.completedAt = now;
      if (s.session?.taskId === a.taskId) s.session = null;
      break;
    case 'reopen':
      task!.completedAt = null;
      s.tasks = [...s.tasks.filter((t) => t.id !== a.taskId), task!];
      break;
    case 'delete':
      s.tasks = s.tasks.filter((t) => t.id !== a.taskId);
      if (s.session?.taskId === a.taskId) s.session = null;
      break;
    case 'reorder': {
      const active = s.tasks.filter((t) => t.completedAt === null),
        completed = s.tasks.filter((t) => t.completedAt !== null);
      check(
        a.taskIds.length === active.length &&
          new Set(a.taskIds).size === active.length &&
          a.taskIds.every((id) => active.some((t) => t.id === id)),
        'Task order has changed; please try again',
      );
      s.tasks = [...a.taskIds.map((id) => active.find((t) => t.id === id)!), ...completed];
      break;
    }
    case 'start':
    case 'switch':
      check(
        a.type === 'switch' || !s.session,
        'Discard the current session before starting another',
      );
      check(task!.completedAt === null, 'Reopen this task before starting a session');
      s.session = {
        id: id(),
        taskId: task!.id,
        durationMinutes: task!.durationMinutes,
        status: 'running',
        deadline: now + task!.durationMinutes * 60000,
      };
      break;
    case 'pause':
      check(s.session?.status === 'running', 'The timer is already paused');
      s.session = {
        id: s.session.id,
        taskId: s.session.taskId,
        durationMinutes: s.session.durationMinutes,
        status: 'paused',
        remainingMs: Math.max(0, s.session.deadline - now),
      };
      break;
    case 'resume':
      check(s.session?.status === 'paused', 'The timer is already running');
      s.session = {
        id: s.session.id,
        taskId: s.session.taskId,
        durationMinutes: s.session.durationMinutes,
        status: 'running',
        deadline: now + s.session.remainingMs,
      };
      break;
    case 'discard':
      s.session = null;
      break;
    case 'login':
      s.settings.launchAtLogin = a.enabled;
      break;
  }
  return s;
}
