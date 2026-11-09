# TaskTick Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a locally packaged macOS menu bar task app with persistent, single-task focus sessions.

**Architecture:** Electron's main process owns a serialized task/session service and atomic local persistence. An isolated preload bridge exposes typed actions and snapshots to a plain TypeScript renderer. Timer credit derives from persisted deadlines, never renderer ticks.

**Tech Stack:** Electron, TypeScript, HTML/CSS, Node's test runner, and @electron/packager for a local unsigned macOS app. Resolve current compatible stable dependencies and commit the lockfile during implementation.

**Spec:** `docs/superpowers/specs/2026-11-09-tasktick-design.md`

## Global Constraints

- Create product source in `tasktick/`; the workspace currently has no Git repository or existing product code.
- macOS and local offline use; no accounts, cloud services, React, updater, or public distribution.
- Duration presets are 15, 20, 25, and 30 minutes. New tasks default to 15 minutes.
- Exactly one running or paused session; only full expiry credits one lifetime session.
- Persist before publishing changes or expiry effects. Serialize actions and reconcile expiry before relevant mutations.
- Paused time stays frozen across restarts. Running time includes sleep and app closure; overdue reconciliation occurs upon wake or launch.
- One notification with sound and foreground panel per observed expiry; no automatic restart, break, or repeated reminder.
- Native notification and focus restrictions must be reported accurately.
- Preserve the approved design and this plan in the repository; initialize a repository at workspace root during execution if it remains unversioned.

## Review Focus

- Disk-full/permission failure: reject mutations visibly without showing unsaved state as saved; test in Task 2.
- Corrupt primary and backup files: preserve originals and prevent silent initialization; test in Task 2.
- Stale renderer action after expiry: reconcile first and avoid double credit or modifying a different session; test in Task 1.
- Confirmation dialogs and blur events: cancellation must preserve session state and keep controls usable; verify in Tasks 3–4.
- Packaged asset/preload paths: the app must launch outside the repository and after changing working directory; verify in Task 5.

## File map

All paths below are relative to `tasktick/` unless specified otherwise.

- `src/shared/model.ts`: state, task, session, action, event, bridge and result types.
- `src/core/state.ts`: runtime state/action validation and pure transitions.
- `src/core/service.ts`: serialized reconciliation, persistence ordering, published snapshots and expiry effects.
- `src/main/store.ts`: versioned JSON validation, atomic writes and backup recovery.
- `src/main/index.ts`: composition, lifecycle, single-instance handling, wake scheduling and login setting.
- `src/main/panel.ts`: tray, panel positioning/activation, menu and notification integration.
- `src/main/ipc.ts`, `src/preload.ts`: sender-validated action/snapshot interface and isolated bridge.
- `src/renderer/index.ts`, `src/renderer/styles.css`, `src/renderer/index.html`: task/timer/settings panel.
- `tests/state.test.ts`, `tests/service.test.ts`, `tests/store.test.ts`: deterministic domain and persistence checks.
- `scripts/build.mjs`, `scripts/package.mjs`: build assets and package the Mac app.
- `package.json`, `package-lock.json`, `tsconfig*.json`, `.gitignore`, `README.md`: reproducible tooling and usage.

## Task 1: Task/session engine with deterministic verification

**Interfaces:** `AppState = { version: 1; tasks: Task[]; session: Session | null; settings: { launchAtLogin: boolean } }`. `Task` has `id`, `title`, `durationMinutes`, `sessionCount`, and `completedAt: number | null`; array order defines active-task order. `Session` is a discriminated union with `id`, `taskId`, `durationMinutes`, and either `status: 'running', deadline: number` or `status: 'paused', remainingMs: number`.

`reconcile(state: AppState, now: number): Transition` returns `{ state, expired: { sessionId, taskId, taskTitle } | null }`. `applyAction(state: AppState, action: Action, now: number): AppState` validates input and applies one action after reconciliation. `TaskService.dispatch(action: Action): Promise<Snapshot>` and `TaskService.reconcile(): Promise<Snapshot>` serialize all operations; constructor dependencies supply clock, IDs, store, and an expiry callback. `Snapshot` contains saved state and `now` for display. Session-specific actions carry `sessionId` so stale commands cannot act on a replacement session.

- [ ] Initialize Git if still absent; add root `.gitignore` entries for dependencies/build outputs. Add minimal package/build/test configuration, strict TypeScript types, and Node test-runner compilation. Main/preload compile to CommonJS; browser code compiles separately as ES modules. No renderer bundler is needed.
- [ ] Write failing `state.test.ts` cases: new task duration `15`, allowed presets `[15,20,25,30]`, rejection of blank titles and invalid values, duplicate titles with distinct IDs, rename, complete/reopen ordering, delete, and exact active-task reorder validation.
- [ ] Write failing timer tests with an injected clock: start 15 minutes at `1000` gives deadline `901000`; at `900999` count is `0`, at `901000` count is `1`; repeat reconciliation retains `1` and emits no second expiry. Cover pause/resume, frozen paused reload, discard, and duration changes rejected while running or paused.
- [ ] Write failing `service.test.ts` cases for concurrent ticks, startup overdue reconciliation, wake reconciliation, save-before-expiry-effect order, switch cancellation/no dispatch, confirmed atomic switch, owning-task completion/deletion, and stale session IDs after expiry or replacement. A paused timer also blocks another start until explicit discard confirmation.
- [ ] Run `npm test`; confirm the new tests fail for missing behaviour before implementation.
- [ ] Implement validation, transitions, and serialized service. Commit state only after save succeeds; failed saves suppress expiry effects and snapshots of unsaved changes. Never reuse session IDs.
- [ ] Run `npm test` and `npm run typecheck`; require all engine tests and strict compilation to pass. Commit the verified engine and tooling.

## Task 2: Crash-conscious local storage

**Interfaces:** `StateStore.load(): Promise<{ state: AppState; warning?: string }>`; `StateStore.save(state: AppState): Promise<void>`. `FileStateStore(directory: string)` implements the interface used by TaskService. Missing files on first launch yield empty version-1 state; existing invalid data cannot be mistaken for first launch.

- [ ] Write failing temporary-directory tests: save/load all task and paused/running fields; primary writes are complete; missing primary with valid backup recovers with a warning; invalid primary with valid backup recovers without destroying invalid evidence; two invalid files throw an actionable error and remain byte-for-byte intact. Reject unknown versions and invalid field types/presets, duplicate IDs, and orphan sessions.
- [ ] Add injected write-failure tests asserting the prior primary/backup remain recoverable and TaskService state/counts stay unchanged when persistence fails.
- [ ] Run `npm test` to establish failures, then implement same-directory temporary-file replacement and a last-known-good backup. On recovery preserve the corrupt file before replacing the primary. Clean up only temporary files owned by the current write.
- [ ] Run `npm test` and `npm run typecheck`; require all storage and service tests to pass. Commit storage.

## Task 3: Native menu bar shell and secure bridge

**Interfaces:** `TaskTickAPI.getSnapshot(): Promise<Snapshot>`, `dispatch(action: Action): Promise<CommandResult>`, `onSnapshot(listener): () => void`, `hidePanel(): Promise<void>`, `quit(): Promise<void>`. `CommandResult` is `{ ok: true; snapshot: Snapshot } | { ok: false; message: string }`. Preload exposes only these named methods. Native confirmation belongs in main IPC handlers before destructive dispatch; the service verifies the session is still the one being confirmed after the dialog closes.

- [ ] Check current documentation for Electron Notification, powerMonitor resume, login items and @electron/packager before using their APIs. Use Context7 resolution followed by focused docs queries, in batches respecting the three-command-per-question limit.
- [ ] Create main, panel, IPC and preload modules. Enforce single-instance ownership before loading mutable state. Use the app user-data directory, hide the Dock icon, preserve background running when the panel closes, and expose an explicit Quit action.
- [ ] Create a tray-anchored, screen-clamped panel with context isolation, sandbox enabled, Node integration disabled, local-only navigation and restrictive CSP. Validate every sender against the actual window/main frame and local document; reject untrusted actions in main. Expose no raw IPC methods or Electron event objects.
- [ ] Connect service snapshots, running/paused tray countdown, nearest-expiry scheduling, startup/wake/unlock reconciliation, and notification click handling. Trigger one notification with sound and show/focus the panel on expiry. Retain notification references while needed. Failed notification delivery cannot undo credit.
- [ ] Wire native discard/switch/delete dialogs; cancel must not mutate the timer. Treat blur caused by a native dialog separately from ordinary outside-click dismissal. Never hold the service queue while waiting for user input.
- [ ] Add settings for initially-off login launch and permission/delivery status. Use actual OS login-setting results when updating UI. Do not claim permission is granted based only on notification API support.
- [ ] Run `npm test`, `npm run typecheck`, and `npm run build`. Launch with a temporary data directory and verify tray open/hide, no Dock persistence, isolated bridge availability, a second launch activating the existing instance, and Quit without data loss. Commit shell.

## Task 4: Usable task/timer panel

**Interfaces:** Renderer consumes only TaskTickAPI and shared types. It owns transient view/edit/settings state, not task truth. Main returns all operation errors as CommandResult or actionable bootstrap failure.

- [ ] Create the panel with persistent timer controls above a scrollable task list, add-title input, per-task duration/count/actions, collapsed Completed section and settings. Use system typography, clear focus indicators and OS light/dark colours.
- [ ] Implement Enter-to-add, inline rename commit/cancel, complete/reopen/delete, Start/Pause/Resume/Discard, and duration selection. Lock duration controls during an owned session; keep the confirmed-switch action accessible on other tasks. Render titles with textContent, not interpolated HTML.
- [ ] Implement drag ordering plus keyboard-accessible Move up/Move down controls for active tasks. Preserve input focus, selection, pending edits, completed-section expansion and scroll position when timer snapshots arrive.
- [ ] Implement Escape handling in priority order: cancel current edit first, otherwise hide the panel. Outside click hides without stopping time. Show save/recovery/command errors visibly and do not erase input on failure.
- [ ] Run build/typecheck/tests and native UI checks: add a literal `<img onerror=...>` title and observe plain text; keep typing through countdown updates; cancel each confirmation; reorder by keyboard and drag; complete/reopen; change appearance; use a long title and enough tasks to scroll; verify controls remain reachable. Commit renderer.

## Task 5: Local Mac package, verification and instructions

**Interfaces:** `npm run dev` builds and launches; `npm test` runs compiled Node tests; `npm run typecheck` checks all targets without emitting; `npm run build` produces `dist/`; `npm run package` produces `out/TaskTick-darwin-arm64/TaskTick.app` on this arm64 Mac. Keep packaging output ignored.

- [ ] Implement build/asset copying and unsigned local packaging using the verified packager API. Include product name, stable bundle identifier, main/preload/renderer assets and appropriate menu bar bundle metadata. Exclude tests, source-only files and unrelated workspace documents from the app package.
- [ ] Write README with exact commands, package output, task/timer behaviour, data/backup locations, login option, notification settings, and the quit/sleep/system-clock limitations from the design. Explain local unsigned-app use without promising public distribution.
- [ ] Run `npm test`, `npm run typecheck`, `npm run build`, `npm run package` and `git diff --check`; record actual outcomes. Keep lockfile committed.
- [ ] Launch the packaged app from outside the repo with disposable test data. Seed an overdue session in that data to test one expiry/count/notification/panel event, then relaunch to verify no repeat credit. Seed a near-future deadline to check the live expiry path without altering product presets. Verify paused restart separately.
- [ ] Check native notification sound, other-app focus, full-screen panel, outside-click/Escape dismissal, tray updates, light/dark mode and login-setting restoration. Leave login disabled after testing. Record restrictions or untestable cases explicitly; do not alter the user's personal tasks or notification settings to force a pass.
- [ ] Request the required final code review, fix material issues and rerun affected checks. Commit verified changes. Present launch instructions, package path and concise test/platform limitations to the user; no remote push or publication is needed.

## Documentation checked during planning

Context7 resolved `/electron/electron` and retrieved the official API/security sources for panel/full-screen behaviour and secure preload IPC on 2026-11-09:

- https://github.com/electron/electron/blob/main/docs/api/browser-window.md
- https://github.com/electron/electron/blob/main/docs/api/structures/base-window-options.md
- https://github.com/electron/electron/blob/main/docs/tutorial/security.md
- https://github.com/electron/electron/blob/main/docs/tutorial/context-isolation.md

Self-review: every agreed feature maps to Tasks 1–5; shared interface names are consistent; each Review Focus item has an explicit automated or native verification step. Further native/packaging API checks are assigned to Task 3 before implementation.
