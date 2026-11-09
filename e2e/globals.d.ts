import type { TaskTickAPI } from '../src/shared/model';
declare global {
  interface Window {
    tasktick: TaskTickAPI;
    require?: unknown;
  }
  var __tasktickAlerts: { title: string; body: string }[];
}
export {};
