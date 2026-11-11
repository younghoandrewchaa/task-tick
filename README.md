# TaskTick

A personal macOS menu bar app for tasks and focused time. Built with Electron and plain TypeScript. Your data stays on your Mac.

## Run

Use a current Node.js release (22.12 or newer), then:

```sh
npm ci
node node_modules/electron/install.js
npm run dev
```

Electron's explicit installation command downloads its native runtime if it is not installed yet. No account or API key is needed.

## Build a Mac app

```sh
npm run package
open out/TaskTick-darwin-arm64/TaskTick.app
```

The output uses the current machine's architecture (`arm64` on Apple Silicon; `x64` on Intel). Copy the app to Applications if desired. This is a local, unsigned build; use the release steps below for a signed build that can update itself. Enable **Launch at login** from the packaged app after moving it to its permanent location; development runs do not register Electron itself as a login item.

## Releases and updates

The panel footer shows the installed version. Once a day the packaged app reads `update-darwin-arm64.json` from `https://github.com/younghoandrewchaa/task-tick/releases/latest/download/` (the website link, not the rate-limited GitHub API). Click the check icon next to the version at any time to check immediately, bypassing the daily cooldown. The panel reports when TaskTick is up to date or a manual check fails. When a newer version exists, the icon changes to a download icon. Clicking it asks for confirmation, downloads the update, installs it and restarts TaskTick. A running session keeps its deadline across the restart. Failed background checks stay quiet and retry within an hour. Updates are Apple Silicon only and are off in development runs and when `TASKTICK_DATA_DIR` is set.

To publish a release, bump `version` in `package.json`, commit, then on an Apple Silicon Mac run:

```sh
npm run release -- "What changed"
```

The script runs the checks, signs and notarises the app with your Developer ID (`APPLE_SIGN_IDENTITY` optional; `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`, or the keychain profile in `APPLE_KEYCHAIN_PROFILE`, default `m-note`), zips it as `TaskTick-darwin-arm64-<version>.zip`, writes the update manifest, tags `v<version>` and publishes both files as the latest GitHub release.

First install: download the ZIP from the latest release, double-click it, and move `TaskTick.app` to Applications. Later versions install themselves. Builds older than 0.2.0 are unsigned and cannot update themselves.

## Use

Click the checked-circle icon in your menu bar to open your tasks. Add a title and press Return. New tasks start at **15 minutes**; choose 15, 20, 25 or 30 minutes for each task. Click the task title to select it, then **Start session**, or use its play button.

Only one session runs at a time. Pause/resume from the timer card. Switching tasks or discarding a session asks for confirmation and adds no count. Duration is locked while that task has a running or paused session. A fully finished timer adds **one session**, regardless of duration, sends a notification with sound, and opens your task list. The next session starts manually.

Check a task's circle to complete it. Expand Completed to see past tasks or reopen them. Use a row's **⋯** menu to rename, move, or delete it; active tasks also support drag ordering. When renaming, press Return to save or Escape to cancel. Deletion asks for confirmation. Completing a task stops its unfinished timer without credit.

Escape or clicking elsewhere hides the panel while the app stays in the menu bar. Settings contains Launch at login and Quit. The interface follows macOS light/dark appearance.

## Timers, notifications and saved data

- A running timer follows its saved wall-clock deadline, including sleep and time while the app is closed. A paused timer stays paused. Changing the system clock changes a running timer's remaining time.
- A fully quit app cannot alert you. An overdue session is counted once on your next launch, with the task list opened then. Sleeping/locked computers surface the result on wake/unlock.
- macOS controls notification banners, sound and Focus mode. Check **System Settings → Notifications → TaskTick**. TaskTick does not bypass Focus or lock-screen rules. The panel opens even if a notification cannot be delivered.
- Normal app data lives in `~/Library/Application Support/TaskTick/`. `state.json` holds tasks/settings and at most one session. `state.backup.json` holds the last known good state (usually one saved change behind). Recovered corrupt primary originals are preserved as `state.corrupt-*.json`. A malformed backup may be replaced on a later valid save when the primary is readable. The initial backup is the previously committed empty state; subsequent backups are one saved change behind.
- If both state and backup are unreadable, TaskTick reports the location and leaves them untouched. Save errors are visible and do not silently count an unsaved session.
- Session credit is persisted before a notification is attempted. A crash between these steps can lose an alert, but does not duplicate credit.

For offline packaging, `TASKTICK_ELECTRON_ZIP_DIR` can point to a directory containing the matching official Electron ZIP (`electron-v<version>-darwin-<arch>.zip`). Otherwise the packager downloads it normally.

For an isolated development run, set `TASKTICK_DATA_DIR` to an absolute disposable directory. Never run two app builds against the same data directory.

## Checks

```sh
npm test
npm run typecheck
npm run build
npm run test:e2e
# Include the packaged-app launch check after packaging:
TASKTICK_TEST_PACKAGED=1 npm run test:e2e
```

The Playwright suite drives the actual Electron renderer and IPC with disposable data directories. It covers task editing, duration selection, ordering, complete/reopen/delete, pause/switch/discard, restart persistence, hidden-panel expiry, light/dark screenshots and optional packaged startup. Native notification delivery and modal responses are stubbed at the OS boundary; sound, Focus mode and full-screen activation still need native checks. Electron launch requires a normal macOS session; restricted shells that block WindowServer access can abort before tests reach any UI assertions.

The deterministic tests include real renderer DOM regressions for failed duration saves, pending edits and cross-task rename drafts, and cover deadline boundaries, session counts, pause/resume, startup/wake reconciliation, stale actions, confirmation races, failed saves and corrupt-file recovery. Native behaviour must also be checked with the packaged app, especially notification sound, foreground activation over full-screen apps and Launch at login.

See [design](docs/design.md) and [implementation plan](docs/implementation-plan.md).
