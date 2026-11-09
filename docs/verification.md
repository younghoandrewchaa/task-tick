# Verification record — 2026-11-09

## Automated checks

- `npm test`: 28 passing tests, 0 failures. Includes actual compiled renderer DOM tests and temporary-file persistence tests.
- `npm run typecheck`: main, isolated renderer and Playwright tests/config pass strict TypeScript checking.
- `npm run test:e2e -- --list`: six Playwright Electron tests discovered.
- `git diff --check`: clean.
- Local Apple Silicon app packaged from the checked source using the cached official Electron 45.2.3 ZIP.

The full Playwright run was attempted. Five source-app tests failed at Electron process launch with SIGABRT/EPERM before any UI assertions; the optional packaged test was skipped in that run. A separate headless Chromium launch also aborted under the managed shell sandbox. These are **not passing E2E results**. Run `npm run test:e2e` in a normal macOS terminal; run `TASKTICK_TEST_PACKAGED=1 npm run test:e2e` after packaging to include the packaged-app test.

The Playwright suite uses real Electron, renderer, IPC, state service and persistence, with native modal responses and notification submission stubbed in its test-only bootstrap. Actual notification sound, system Focus behaviour, full-screen activation and login registration are not proven by those stubs.

## Native smoke observations before the request to switch testing to Playwright

The packaged app opened with correct assets/preload. A disposable copy using isolated test data verified add, 15-minute defaults, start, pause, duration locking, switching cancellation, rename, completion without partial-session credit, reopen, paused restart and overdue startup credit. The row menu was visibly clipped, then fixed and visibly rechecked. Light/dark screenshots were inspected. No new Computer Use testing was performed after the user's Playwright request.

Native notification sound, activation over full-screen apps, login registration and a hidden-panel live deadline remain unverified. The earlier disposable native app was closed during cleanup, confirmed by removal of its single-instance lock. No personal task data was used in it.

## Independent review and fixes

A fresh reviewer inspected the whole project. Findings addressed:

1. A failed initial primary commit could recover proposed tasks from its backup. A primary-rename ENOSPC test failed before the fix and passes now. The first backup now represents prior committed empty state; later backups hold prior committed state.
2. macOS edit shortcuts lacked application-menu roles. The minimal app/edit menus are restored, and the Playwright rename flow now uses actual Select All and typing instead of `fill`. Native keyboard verification is blocked with the other E2E launches.
3. A failed/ignored duration selection remained visible despite different saved state. Actual renderer DOM tests failed before the fix and pass now; duration controls reset to saved truth and disable during pending commands.
4. Rename drafts could transfer from one task to another. Regraded Important because this can overwrite an unintended title. The actual renderer regression failed before the fix and passes now.

Deferred minor: if the primary is valid but the backup is malformed, a later valid save can replace malformed backup bytes without preserving that evidence. The valid primary is retained; corrupt primary evidence is preserved. This does not itself lose tasks.

## Implementation decisions

- Fresh project works in its approved directory on `feat/tasktick`; there was no existing project to isolate. No remote or base branch exists, so no merge/push is needed.
- Root Git initialization was blocked by the filesystem policy; the app has its own Git repository and copies of the approved design and plan.
- Installed TypeScript 7 requires current Node16/Bundler resolution rather than the removed node10 option; no product behaviour changes.
- A temporary npm cache was needed under filesystem restrictions; dependencies are locked.
- Packaging can use `TASKTICK_ELECTRON_ZIP_DIR` because sandbox DNS blocked a redundant Electron download; ordinary network-enabled packaging remains the default.
- The shell sandbox blocked native development launch, so initial native smoke checks used a packaged disposable copy. Playwright was added when requested; process-launch restrictions prevented running its UI assertions here.
- The initial backup is prior committed empty state. This prevents a rejected first edit from appearing after restart; recovering only the backup immediately after the first successful edit may return an empty list, consistent with backups being one saved change behind.

## Follow-up: queued menu positioning

The user ran native Playwright successfully outside the managed shell: four tests passed, and the long-list test caught a menu below the viewport before its queued `toggle` handler ran. A renderer regression reproduced the unpositioned state immediately after activation (RED). The summary activation now opens and positions the menu synchronously, while retaining the toggle handler for programmatic changes (GREEN, 28/28 tests). The original Playwright geometry assertion remains unchanged. A targeted rerun here still aborts at Electron launch (SIGABRT/EPERM), before reaching that assertion.
