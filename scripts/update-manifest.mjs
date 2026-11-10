// Writes the Squirrel.Mac JSON manifest that the app reads from the latest GitHub release.
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

const [zipPath, outputPath, notes = ''] = process.argv.slice(2);
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))
  throw new Error('Updates require a stable semver version.');
const name = `TaskTick-darwin-arm64-${version}.zip`;
if (!zipPath || !outputPath || basename(zipPath) !== name || statSync(zipPath).size === 0)
  throw new Error(`Expected the non-empty release ZIP ${name}.`);
const manifest = {
  currentRelease: version,
  releases: [
    {
      version,
      updateTo: {
        url: `https://github.com/younghoandrewchaa/task-tick/releases/download/v${version}/${name}`,
        name: `TaskTick ${version}`,
        notes,
        pub_date: new Date().toISOString(),
      },
    },
  ],
};
writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
