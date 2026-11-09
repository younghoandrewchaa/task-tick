# TaskTick design

Status: approved by the user on 2026-11-09. No product implementation has started.

## Intent

TaskTick is a personal, offline macOS menu bar app built with Electron and TypeScript. It combines a small task list with timed focus sessions. Success means the user can quickly choose a task, work for a selected duration, see accumulated completed sessions, and mark the task done.

## Agreed scope

- A menu bar icon opens a compact panel containing the task list. While a timer runs, the menu bar shows the remaining time. The current task and timer appear above the list.
- Add, rename, delete, manually reorder, complete, and reopen tasks. Deleting requires confirmation. A task has a title, preferred duration, completed-session count, and completion status.
- Duration presets are 15, 20, 25, and 30 minutes. New tasks default to 15 minutes. Each task remembers its last chosen duration.
- Exactly one timer can exist across the app. It can run or be paused. Switching to another task requires confirmation to discard the unfinished session.
- Duration cannot change during a running or paused session. The user must discard it before selecting another duration.
- A full session adds one to that task's lifetime session count. Different durations count equally. Partial, discarded sessions add nothing.
- At expiry, show one notification with sound, open the task panel in front of other apps, and wait for the user. There is no automatic next session, break timer, or repeated reminder.
- Completing a task moves it to a separate Completed section and retains its count. Reopening returns it to the active list. Completing a task with an active timer stops that timer without credit for unfinished time.
- Completed tasks are collapsed by default. The app follows macOS light/dark appearance.
- Clicking outside the panel or pressing Escape hides it without stopping the timer. An expiry-opened panel stays visible until the user dismisses it, including by either of those actions.
- Persist tasks, counts, preferences, order, and running/paused session state locally between restarts.
- Elapsed clock time includes sleep and time when the app is closed. An overdue session is credited once upon wake or the next launch, and the task panel opens then.
- Offer Launch at login, initially off.
- Working app name: TaskTick.

## Non-goals and unacceptable outcomes

No accounts, cloud sync, collaboration, due dates, subtasks, tags, daily statistics, custom durations, automatic breaks, or cross-platform support in this version. No App Store submission, public distribution, signing service, or automatic updater is required for this personal first version.

The app must not credit the same session twice, silently lose saved tasks, run concurrent task timers, or reset a timer when its panel closes. The app should not expose filesystem or Electron privileges to panel content.

## Approaches considered

1. **Electron with plain TypeScript, HTML, and CSS — selected by the user.** A small renderer with explicit UI state fits the agreed panel and avoids a UI framework dependency.
2. **Electron with React and TypeScript.** Component structure could help a larger interface, at the cost of additional dependencies. The user chose the first approach for the current scope.

Electron and TypeScript are user requirements. Packaging tooling and other minor build choices remain the builder's responsibility and must be checked against current documentation before use.

## Interface and task actions

The panel has a timer area, active-task list, add-task control, collapsed Completed section, and access to settings and Quit. Each active task exposes its title, session count, duration, and Start action. The selected running or paused task has clear Pause/Resume and Discard controls. Completion, rename, delete, and reorder must be discoverable without making every row visually crowded.

Builder proposals for minor details:

- Trim task titles; reject blank titles. Duplicate titles are allowed because tasks have separate stable IDs.
- New and reopened tasks go at the end of the active list. Completed tasks appear most recently completed first. Manual ordering applies to active tasks.
- Persist inline renames when committed; Escape cancels an edit. Do not let the panel's global Escape handler swallow an edit cancellation.
- Starting another task while a timer exists presents a discard confirmation. Cancel preserves the existing session exactly; confirm discards it and starts the chosen task's new session.
- Explicitly discarding an active session requires confirmation. Deleting the task that owns a timer also explains that its unfinished session will be discarded. Completing a task stops its timer as already agreed, without another confirmation.
- Use a menu bar app with no persistent Dock presence. Closing or dismissing the panel hides it. Quit is an explicit action, and quitting does not discard a saved session.
- While paused, show the frozen remaining time with a clear paused indicator in the menu bar.

Panel dimensions, icon artwork, typography, exact control layout, and keyboard accessibility details are left to the builder. The panel should fit typical Mac laptop displays, allow scrolling, support keyboard actions, and keep timer controls visible.

## Timer and persistence model

The Electron main process owns task data, the session state machine, persistence, notifications, and panel activation. The renderer displays snapshots and submits narrowly defined actions through a typed bridge. Renderer intervals never determine session credit.

Persist a versioned local state containing tasks, ordering, settings, and at most one session. Tasks have a stable ID, title, duration in preset minutes, session count, and completion metadata. A session has a unique ID and task ID. A running session stores an absolute deadline; a paused session stores remaining milliseconds. The originally selected duration is retained for that session.

State transitions:

- Idle → Start: create a session and save its deadline before showing it as active.
- Running → Pause: first reconcile expiry; otherwise save remaining time and remove the running deadline.
- Paused → Resume: set a new deadline from the saved remaining time.
- Running/Paused → Discard: remove the session, leaving the count unchanged.
- Running → Expired: increment the owning task's count and remove the session in the same persisted state update. Trigger the expiry UI and notification once for that transition.
- Complete/Delete owning task: reconcile expiry first, then stop any remaining unfinished session before completing/deleting the task.

Reconcile expiry at startup, wake, timer callbacks, and before relevant user actions. Serialize mutations so simultaneous callbacks and clicks cannot double-credit a session. A second app launch must not create an independent timer owner.

Use atomic replacement of the local state file. Validate loaded state and keep a recoverable backup. Report unrecoverable load/save problems visibly; never silently overwrite unreadable task data with an empty list. The exact storage schema and backup strategy remain builder choices.

Remaining time is deadline minus current wall-clock time, rounded up for display and clamped to zero. A paused timer does not advance during sleep or closure. With the agreed elapsed-clock behaviour, manually changing the system clock also changes a running timer's apparent remaining time; using an absolute deadline is a builder proposal.

## Notifications, wake, and activation

At expiry, attempt a native notification with sound and activate the task panel. Clicking the notification opens the same panel. If notification permission or macOS notification settings prevent delivery, still credit the session and open the panel; provide a useful permission status in settings. Respect platform constraints rather than claiming the app can bypass Focus mode or a locked screen.

An app that is fully quit cannot deliver its own timer alert while it is not running. It reconciles an overdue session on the next launch, as agreed. After sleep, reconcile on wake and surface the result when the desktop is available. Exact macOS activation behaviour must be verified on the target machine, including other-app focus and full-screen use.

Persist session credit before triggering expiry side effects. This prioritizes correct counts: an unexpected crash between saving and notification delivery may prevent that alert, but must not credit the session twice.

## Local architecture and delivery

- Electron main process: task/session service, persistence, app lifecycle, menu bar, panel, notifications, login setting, and single-instance control.
- Preload: minimal typed commands/events, context isolation, no general filesystem or arbitrary IPC access.
- Renderer: local HTML, CSS, and TypeScript, with a small state-driven rendering layer. No remote page content or renderer Node integration.
- Shared types and validation define supported task actions and presets. Main-process validation is authoritative.

Builder delivery proposal: create the app in `tasktick/` within the current empty workspace, provide development/build commands and a locally usable macOS app package, and document launch, notification permissions, storage location, and known platform limitations. Do not require a signing identity for local development. Git initialization and commits can be handled during implementation; the current workspace is not a Git repository.

## Validation expectations

Use deterministic tests around the timer/state service and temporary-file persistence: expiry once, duration presets, pause/resume, discard, switching cancellation, complete/delete, reload, overdue startup/wake, and concurrent expiry/action handling. Verify malformed persistence does not silently erase tasks.

Build and type-check the app. Perform a macOS smoke check for menu bar behaviour, panel dismissal, timer controls, persistence across restart, notification/foreground behaviour, and appearance where the environment permits. Use shortened internal test durations rather than changing the product presets. Report any native behaviour that could not be exercised instead of declaring it verified.

## Approval

The user has approved this document, including explicitly labelled builder proposals, and the plain-TypeScript approach. The independent builder check found no important unanswered questions.
