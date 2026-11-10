import { packager } from '@electron/packager';

// Release builds are signed and notarised so Squirrel.Mac can install updates.
const release = process.env.TASKTICK_RELEASE === '1';
const env = process.env;
const password = env.APPLE_APP_SPECIFIC_PASSWORD || env.APPLE_ID_PASSWORD;
if (release && process.arch !== 'arm64')
  throw new Error('Releases must be built on Apple Silicon.');
if (release && env.APPLE_ID && (!password || !env.APPLE_TEAM_ID))
  throw new Error('APPLE_ID requires APPLE_APP_SPECIFIC_PASSWORD and APPLE_TEAM_ID.');
const signing = release
  ? {
      osxSign: {
        ...(env.APPLE_SIGN_IDENTITY ? { identity: env.APPLE_SIGN_IDENTITY } : {}),
        // Locale data is sealed by the framework signature; skip individual signatures.
        ignore: /\/Resources\/[^/]+\.lproj\/locale\.pak$/,
      },
      osxNotarize: env.APPLE_ID
        ? { appleId: env.APPLE_ID, appleIdPassword: password, teamId: env.APPLE_TEAM_ID }
        : { keychainProfile: env.APPLE_KEYCHAIN_PROFILE || 'm-note' },
    }
  : {};

const paths = await packager({
  dir: process.cwd(),
  electronZipDir: process.env.TASKTICK_ELECTRON_ZIP_DIR,
  name: 'TaskTick',
  platform: 'darwin',
  arch: process.arch,
  appBundleId: 'dev.youngho.tasktick',
  appCategoryType: 'public.app-category.productivity',
  out: 'out',
  overwrite: true,
  asar: false,
  icon: 'dist/assets/app.icns',
  extendInfo: { LSUIElement: true, NSHighResolutionCapable: true },
  ignore: /^\/(?!dist(?:\/|$)|package\.json$).+/,
  ...signing,
});
console.log(paths.map((path) => `${path}/TaskTick.app`).join('\n'));
