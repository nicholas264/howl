import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
async function walk(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${item.name}`;
    if (item.isDirectory()) await walk(path);
    else if (path.endsWith('.js')) {
      const checked = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
      if (checked.status !== 0) throw new Error(checked.stderr);
    }
  }
}
await walk('api');
console.log('Backend syntax checks passed.');
