import { packager } from '@electron/packager';
import { closeSync, openSync, readSync, statSync } from 'node:fs';

// Thin and universal Mach-O headers, in either byte order.
const machOMagic = new Set([
  0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca,
]);
function isMachO(file) {
  const fd = openSync(file, 'r');
  try {
    const header = Buffer.alloc(4);
    return readSync(fd, header, 0, 4, 0) === 4 && machOMagic.has(header.readUInt32BE(0));
  } finally {
    closeSync(fd);
  }
}

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
        // Sign only executable code. Resources (.pak, .dat, .png, ...) are sealed by their
        // bundle's signature and should not carry signatures of their own.
        ignore: (file) => statSync(file).isFile() && !isMachO(file),
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
