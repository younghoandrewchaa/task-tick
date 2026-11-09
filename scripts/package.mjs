import { packager } from '@electron/packager';
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
});
console.log(paths.map((path) => `${path}/TaskTick.app`).join('\n'));
