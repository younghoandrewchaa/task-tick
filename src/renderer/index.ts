import type { Action, Snapshot, Task, TaskTickAPI, UpdateState } from '../shared/model';
declare global {
  interface Window {
    tasktick: TaskTickAPI;
  }
}
const api = window.tasktick;
function el<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}
let snapshot: Snapshot | undefined,
  stateKey = '',
  selectedId: string | null = null,
  editingId: string | null = null,
  busy = false,
  dismissedNotice = '',
  draggedId: string | null = null;
const input = el<HTMLInputElement>('new-task');
function error(message: string): void {
  el('error').textContent = message;
  el('error').hidden = !message;
}
function syncDurationControls(): void {
  document.querySelectorAll<HTMLSelectElement>('.task-row select').forEach((select) => {
    const taskId = (select.closest('.task-row') as HTMLElement).dataset.taskId;
    const task = snapshot?.state.tasks.find((task) => task.id === taskId);
    if (task) select.value = String(task.durationMinutes);
    select.disabled = busy || snapshot?.state.session?.taskId === taskId;
  });
}
function setBusy(value: boolean): void {
  busy = value;
  syncDurationControls();
  el<HTMLButtonElement>('primary').disabled = value || !currentTask();
}
async function dispatch(action: Action): Promise<boolean> {
  if (busy) {
    syncDurationControls();
    return false;
  }
  setBusy(true);
  error('');
  try {
    const result = await api.dispatch(action);
    if (!result.ok) {
      error(result.message);
      return false;
    }
    accept(result.snapshot);
    return true;
  } catch (e) {
    error(e instanceof Error ? e.message : 'Could not save your change');
    return false;
  } finally {
    setBusy(false);
  }
}
function currentTask(): Task | undefined {
  const s = snapshot?.state;
  return s?.tasks.find((t) => t.id === (s.session?.taskId ?? selectedId) && t.completedAt === null);
}
function button(text: string, title: string, cls: string, click: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  b.title = title;
  b.setAttribute('aria-label', title);
  b.className = cls;
  b.addEventListener('click', click);
  return b;
}
function menuItem(parent: HTMLElement, text: string, click: () => void, danger = false): void {
  const b = button(text, text, danger ? 'danger' : '', () => {
    parent.closest('details')?.removeAttribute('open');
    click();
  });
  parent.append(b);
}
function move(task: Task, delta: number): void {
  const ids = snapshot!.state.tasks.filter((t) => t.completedAt === null).map((t) => t.id),
    index = ids.indexOf(task.id),
    target = index + delta;
  if (target < 0 || target >= ids.length) return;
  [ids[index], ids[target]] = [ids[target], ids[index]];
  void dispatch({ type: 'reorder', taskIds: ids });
}
function row(task: Task, completed = false): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'task-row' + (currentTask()?.id === task.id ? ' selected' : '');
  wrapper.dataset.taskId = task.id;
  const done = button(
    '✓',
    completed ? `Reopen ${task.title}` : `Complete ${task.title}`,
    'complete-button',
    () => void dispatch({ type: completed ? 'reopen' : 'complete', taskId: task.id }),
  );
  wrapper.append(done);
  const content = document.createElement('div');
  if (editingId === task.id) {
    const edit = document.createElement('input');
    edit.className = 'rename-input';
    edit.value = task.title;
    edit.dataset.edit = task.id;
    edit.setAttribute('aria-label', 'Rename task');
    const commit = async () => {
      if (!edit.value.trim()) {
        error('Enter a task title');
        edit.focus();
        return;
      }
      if (await dispatch({ type: 'rename', taskId: task.id, title: edit.value })) {
        editingId = null;
        renderTasks();
      }
    };
    edit.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void commit();
      }
      if (e.key === 'Escape') {
        e.stopPropagation();
        editingId = null;
        renderTasks();
      }
    });
    content.append(edit);
  } else {
    const title = button(
      task.title,
      completed ? task.title : `Select ${task.title}`,
      'task-title',
      () => {
        if (!completed) {
          selectedId = task.id;
          renderTasks();
          renderTimer();
        }
      },
    );
    title.addEventListener('dblclick', () => {
      editingId = task.id;
      renderTasks();
      el<HTMLInputElement>('tasks').querySelector<HTMLInputElement>('[data-edit]')?.focus();
    });
    content.append(title);
  }
  const meta = document.createElement('div');
  meta.className = 'task-meta';
  const count = document.createElement('span');
  count.className = 'session-count';
  count.textContent = `${task.sessionCount} ${task.sessionCount === 1 ? 'session' : 'sessions'}`;
  meta.append(count);
  if (!completed) {
    const dot = document.createElement('span');
    dot.className = 'meta-dot';
    const select = document.createElement('select');
    select.className = 'duration-select';
    select.setAttribute('aria-label', `Duration for ${task.title}`);
    for (const minutes of [15, 20, 25, 30] as const) {
      const opt = document.createElement('option');
      opt.value = String(minutes);
      opt.textContent = `${minutes} min`;
      opt.selected = task.durationMinutes === minutes;
      select.append(opt);
    }
    select.disabled = snapshot?.state.session?.taskId === task.id;
    select.addEventListener(
      'change',
      () =>
        void dispatch({
          type: 'duration',
          taskId: task.id,
          minutes: Number(select.value) as 15 | 20 | 25 | 30,
        }),
    );
    meta.append(dot, select);
  }
  content.append(meta);
  wrapper.append(content);
  const actions = document.createElement('div');
  actions.className = 'row-actions';
  if (!completed) {
    const own = snapshot?.state.session?.taskId === task.id;
    const start = button(
      own ? '◷' : '▶',
      own ? 'Current session' : `Start ${task.title}`,
      'start-button',
      () => void dispatch({ type: 'start', taskId: task.id }),
    );
    start.disabled = own;
    actions.append(start);
  }
  const menu = document.createElement('details');
  menu.className = 'row-menu';
  const summary = document.createElement('summary');
  summary.textContent = '⋯';
  summary.setAttribute('aria-label', `Actions for ${task.title}`);
  const items = document.createElement('div');
  items.className = 'menu-items';
  menuItem(items, 'Rename', () => {
    editingId = task.id;
    renderTasks();
    document.querySelector<HTMLInputElement>('[data-edit]')?.focus();
  });
  if (!completed) {
    menuItem(items, 'Move up', () => move(task, -1));
    menuItem(items, 'Move down', () => move(task, 1));
  }
  menuItem(items, 'Delete task', () => void dispatch({ type: 'delete', taskId: task.id }), true);
  menu.append(summary, items);
  const positionMenu = (): void => {
    if (!menu.open) return;
    document.querySelectorAll<HTMLDetailsElement>('.row-menu[open]').forEach((other) => {
      if (other !== menu) other.open = false;
    });
    const bounds = summary.getBoundingClientRect();
    items.style.left = `${Math.max(8, Math.min(bounds.right - 140, window.innerWidth - 148))}px`;
    items.style.top = `${Math.max(8, Math.min(bounds.bottom + 5, window.innerHeight - items.offsetHeight - 10))}px`;
  };
  summary.addEventListener('click', (event) => {
    // The native toggle event is queued after opening. Position in the same
    // activation turn so the menu never appears at its unpositioned location.
    event.preventDefault();
    menu.open = !menu.open;
    positionMenu();
  });
  menu.addEventListener('toggle', positionMenu);
  actions.append(menu);
  wrapper.append(actions);
  if (!completed) {
    wrapper.draggable = true;
    wrapper.addEventListener('dragstart', (e) => {
      if ((e.target as HTMLElement).closest('input,select,details,button:not(.task-title)')) {
        e.preventDefault();
        return;
      }
      draggedId = task.id;
      e.dataTransfer?.setData('text/plain', task.id);
    });
    wrapper.addEventListener('dragend', () => {
      draggedId = null;
      document.querySelectorAll('.drag-over').forEach((n) => n.classList.remove('drag-over'));
    });
    wrapper.addEventListener('dragover', (e) => {
      if (draggedId) {
        e.preventDefault();
        wrapper.classList.add('drag-over');
      }
    });
    wrapper.addEventListener('dragleave', () => wrapper.classList.remove('drag-over'));
    wrapper.addEventListener('drop', (e) => {
      e.preventDefault();
      wrapper.classList.remove('drag-over');
      if (!draggedId || draggedId === task.id) return;
      const ids = snapshot!.state.tasks.filter((t) => t.completedAt === null).map((t) => t.id);
      const from = ids.indexOf(draggedId),
        to = ids.indexOf(task.id);
      if (from >= 0 && to >= 0) {
        ids.splice(from, 1);
        ids.splice(to, 0, draggedId);
        void dispatch({ type: 'reorder', taskIds: ids });
      }
      draggedId = null;
    });
  }
  return wrapper;
}
function renderTasks(): void {
  if (!snapshot) return;
  const editing = document.querySelector<HTMLInputElement>('[data-edit]'),
    draftTaskId = editing?.dataset.edit,
    draft = editing?.value,
    selection = editing?.selectionStart,
    hadFocus = document.activeElement === editing;
  const active = snapshot.state.tasks.filter((t) => t.completedAt === null),
    completed = snapshot.state.tasks
      .filter((t) => t.completedAt !== null)
      .sort((a, b) => b.completedAt! - a.completedAt!);
  if (!active.some((t) => t.id === selectedId)) selectedId = active[0]?.id ?? null;
  const list = el('tasks'),
    completedList = el('completed-tasks'),
    scroll = list.scrollTop;
  list.replaceChildren(...active.map((t) => row(t)));
  completedList.replaceChildren(...completed.map((t) => row(t, true)));
  list.scrollTop = scroll;
  el('active-count').textContent = String(active.length);
  el('completed-count').textContent = String(completed.length);
  el('empty').hidden = active.length > 0;
  const replacement = document.querySelector<HTMLInputElement>('[data-edit]');
  syncDurationControls();
  if (replacement && replacement.dataset.edit === draftTaskId && draft !== undefined) {
    replacement.value = draft;
    if (hadFocus) {
      replacement.focus();
      replacement.setSelectionRange(selection ?? draft.length, selection ?? draft.length);
    }
  }
}
function renderTimer(): void {
  const task = currentTask(),
    session = snapshot?.state.session,
    ms = session
      ? session.status === 'running'
        ? session.deadline - Date.now()
        : session.remainingMs
      : (task?.durationMinutes ?? 15) * 60000;
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  el('timer').replaceChildren(
    document.createTextNode(String(Math.floor(seconds / 60)).padStart(2, '0')),
    Object.assign(document.createElement('span'), { textContent: ':' }),
    document.createTextNode(String(seconds % 60).padStart(2, '0')),
  );
  el('focus-title').textContent = task?.title ?? 'Your next small step.';
  el('focus-title').title = task?.title ?? '';
  el('session-label').textContent = session
    ? session.status === 'paused'
      ? 'A MOMENT TO BREATHE'
      : 'ONE THING AT A TIME'
    : 'A LITTLE SPACE TO FOCUS';
  el('status-dot').classList.toggle('running', session?.status === 'running');
  el('timer-caption').textContent = session
    ? session.status === 'paused'
      ? 'Your time is saved. Come back when you’re ready.'
      : 'You’re making time for what matters.'
    : task
      ? 'A small commitment. A little progress.'
      : 'Pick a task. Give it your attention.';
  el('primary-label').textContent = session
    ? session.status === 'paused'
      ? 'Resume session'
      : 'Pause session'
    : 'Start session';
  el('primary-icon').textContent = session?.status === 'running' ? 'Ⅱ' : '▶';
  el<HTMLButtonElement>('primary').disabled = busy || !task;
  el('discard').hidden = !session;
}
function renderUpdate(update: UpdateState | undefined): void {
  const version = el('version'),
    button = el<HTMLButtonElement>('update');
  version.hidden = !update;
  version.textContent = update ? `v${update.version}` : '';
  const status = update?.status;
  const latest = `v${update?.latestVersion ?? ''}`;
  const label =
    status === 'available'
      ? `Update to ${latest}`
      : status === 'confirming' || status === 'downloading'
        ? `Downloading ${latest}…`
        : status === 'installing'
          ? 'Restarting…'
          : status === 'error'
            ? (update?.message ?? 'Update failed. Click to try again.')
            : '';
  button.hidden = !label;
  button.disabled = status === 'confirming' || status === 'downloading' || status === 'installing';
  button.textContent = status === 'error' ? '!' : '⤓';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.classList.toggle('busy', button.disabled);
  button.classList.toggle('error', status === 'error');
}
function accept(next: Snapshot): void {
  snapshot = next;
  const key = JSON.stringify(next.state);
  if (key !== stateKey) {
    stateKey = key;
    renderTasks();
  }
  renderTimer();
  el<HTMLInputElement>('login').checked = next.state.settings.launchAtLogin;
  el('notification-status').textContent =
    next.notificationStatus ?? 'Check macOS notification settings for TaskTick.';
  const notice = next.notice ?? '';
  el('notice-text').textContent = notice;
  el('notice').hidden = !notice || notice === dismissedNotice;
  renderUpdate(next.update);
}
el('update').addEventListener('click', () => void api.installUpdate());
el('primary').addEventListener('click', () => {
  const s = snapshot?.state.session,
    task = currentTask();
  if (s) void dispatch({ type: s.status === 'running' ? 'pause' : 'resume', sessionId: s.id });
  else if (task) void dispatch({ type: 'start', taskId: task.id });
});
el('discard').addEventListener('click', () => {
  const s = snapshot?.state.session;
  if (s) void dispatch({ type: 'discard', sessionId: s.id });
});
el('add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!input.value.trim()) {
    input.focus();
    return;
  }
  const value = input.value;
  if (await dispatch({ type: 'add', title: value })) {
    if (input.value === value) input.value = '';
    input.focus();
  }
});
el('hide').addEventListener('click', () => void api.hidePanel());
el('dismiss-notice').addEventListener('click', () => {
  dismissedNotice = snapshot?.notice ?? '';
  el('notice').hidden = true;
});
function settings(show: boolean): void {
  el('workspace').hidden = show;
  el('settings').hidden = !show;
  if (show) el('back').focus();
}
el('settings-button').addEventListener('click', () => settings(el('settings').hidden !== false));
el('back').addEventListener('click', () => settings(false));
el<HTMLInputElement>('login').addEventListener('change', async (e) => {
  const enabled = (e.target as HTMLInputElement).checked;
  if (!(await dispatch({ type: 'login', enabled })))
    el<HTMLInputElement>('login').checked = snapshot?.state.settings.launchAtLogin ?? false;
});
el('quit').addEventListener('click', () => void api.quit());
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (editingId) {
      editingId = null;
      renderTasks();
    } else void api.hidePanel();
  }
});
api.onSnapshot(accept);
void api
  .getSnapshot()
  .then(accept)
  .catch((e) => error(`Could not load tasks: ${String(e)}`));
setInterval(renderTimer, 250);

document.addEventListener('pointerdown', (event) => {
  if (!(event.target as HTMLElement).closest('.row-menu'))
    document.querySelectorAll<HTMLDetailsElement>('.row-menu[open]').forEach((menu) => {
      menu.open = false;
    });
});
