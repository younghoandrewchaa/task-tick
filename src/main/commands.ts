import type { Action, CommandResult, Snapshot } from '../shared/model';
import { validateAction } from '../core/state';
import type { TaskService } from '../core/service';
export interface CommandOptions {
  service: TaskService;
  confirm: (message: string, detail: string) => Promise<boolean>;
  setLogin: (enabled: boolean) => boolean;
  snapshot: () => Snapshot;
}
export class CommandController {
  private confirming = false;
  constructor(private options: CommandOptions) {}
  async execute(input: unknown): Promise<CommandResult> {
    try {
      if (this.confirming) throw new Error('Finish the open confirmation first');
      let action: Action = validateAction(input);
      await this.options.service.reconcile();
      const before = this.options.service.snapshot().state;
      let message = '',
        detail = '',
        expectedSession: string | null | undefined;
      if ((action.type === 'start' && before.session) || action.type === 'switch') {
        if (before.session?.taskId === action.taskId)
          throw new Error('This task already has an active session');
        if (!before.session) throw new Error('The previous session has finished');
        action = { type: 'switch', taskId: action.taskId, sessionId: before.session.id };
        expectedSession = before.session.id;
        message = 'Switch tasks?';
        detail = 'The unfinished session will be discarded. No session will be counted.';
      } else if (action.type === 'discard') {
        expectedSession = action.sessionId;
        message = 'Discard this session?';
        detail = 'Your task will stay in the list. No session will be counted.';
      } else if (action.type === 'delete') {
        expectedSession = before.session?.taskId === action.taskId ? before.session.id : null;
        message = 'Delete this task?';
        detail =
          'Its session history will be removed.' +
          (expectedSession ? ' Its unfinished timer will also be discarded.' : '');
      }
      if (message) {
        this.confirming = true;
        let confirmed: boolean;
        try {
          confirmed = await this.options.confirm(message, detail);
        } finally {
          this.confirming = false;
        }
        if (!confirmed) return { ok: true, snapshot: this.options.snapshot() };
        await this.options.service.reconcile();
        const current = this.options.service.snapshot().state.session;
        if (expectedSession && current?.id !== expectedSession)
          throw new Error(
            'The session finished or changed while the confirmation was open. Please try again.',
          );
        if (action.type === 'delete' && !expectedSession && current?.taskId === action.taskId)
          throw new Error('This task now has an active session. Please confirm deletion again.');
      }
      if (action.type === 'login') {
        const previous = before.settings.launchAtLogin;
        const actual = this.options.setLogin(action.enabled);
        try {
          await this.options.service.dispatch({ type: 'login', enabled: actual });
        } catch (error) {
          this.options.setLogin(previous);
          throw error;
        }
      } else await this.options.service.dispatch(action);
      return { ok: true, snapshot: this.options.snapshot() };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'Could not save the change',
      };
    }
  }
}
