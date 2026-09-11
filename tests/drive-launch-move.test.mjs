import test from 'node:test';
import assert from 'node:assert/strict';
import { moveLaunchedDriveFile } from '../api/_lib/drive-launch-move.js';

function fixture(extra = {}) {
  const folder = parents => ({ mimeType: 'application/vnd.google-apps.folder', parents });
  const files = { root: folder([]), inbox: folder(['root']), launched: folder(['root']),
    creative: folder(['inbox']), feed: folder(['creative']), story: folder(['creative']),
    a: { name: 'a.png', parents: ['feed'] }, b: { name: 'b.png', parents: ['story'] }, ...extra };
  const trashed = [], warnings = [];
  let failMove = false, failCleanup = false, incomplete = false;
  async function drive(path, init = {}) {
    const url = new URL(path, 'https://drive.test');
    const id = decodeURIComponent(url.pathname.split('/')[2] || '');
    if (!id) {
      const q = url.searchParams.get('q');
      if (q.includes("name='Inbox'")) return { files: [{ id: 'inbox' }] };
      const parent = q.match(/^'([^']+)' in parents/)[1];
      return { files: Object.entries(files).filter(([, f]) => !f.trashed && f.parents.includes(parent)).map(([id]) => ({ id })).slice(0, 1), incompleteSearch: incomplete };
    }
    assert.ok(files[id], `Unknown file ${id}`);
    if (init.method === 'PATCH') {
      const body = JSON.parse(init.body);
      if (body.trashed) {
        if (failCleanup) throw new Error('No trash permission');
        trashed.push(id);
      } else {
        if (failMove) throw new Error('Move failed');
        const remove = (url.searchParams.get('removeParents') || '').split(',');
        files[id].parents = files[id].parents.filter(p => !remove.includes(p));
        if (url.searchParams.has('addParents')) files[id].parents.push(url.searchParams.get('addParents'));
      }
      Object.assign(files[id], body);
    }
    return { id, ...structuredClone(files[id]) };
  }
  return { files, trashed, warnings, drive, setFailMove: () => { failMove = true; },
    setFailCleanup: () => { failCleanup = true; }, setIncomplete: () => { incomplete = true; },
    move: fileId => moveLaunchedDriveFile(drive, { fileId, launchedId: 'launched', rootId: 'root', name: `${fileId}__LAUNCHED__.png` }, (...args) => warnings.push(args)),
  };
}

test('paired launches prune empty aspect folders and then their creative folder, preserving Inbox', async () => {
  const f = fixture();
  await f.move('a');
  assert.deepEqual(f.trashed, ['feed']);
  assert.equal(f.files.creative.trashed, undefined);
  await f.move('b');
  assert.deepEqual(f.trashed, ['feed', 'story', 'creative']);
  assert.deepEqual(f.files.a.parents, ['launched']);
  assert.deepEqual(f.files.b.parents, ['launched']);
  assert.equal(f.files.inbox.trashed, undefined);
  await f.move('b');
  assert.deepEqual(f.trashed, ['feed', 'story', 'creative'], 'retry is idempotent');
});

test('unlaunched assets and non-media files prevent folder removal', async () => {
  for (const sibling of [{ name: 'draft.mp4', parents: ['feed'] }, { name: 'notes.txt', parents: ['feed'] }]) {
    const f = fixture({ remaining: sibling });
    await f.move('a');
    assert.deepEqual(f.trashed, []);
  }
});

test('direct Inbox files and files outside Inbox never remove their parent folders', async () => {
  for (const parent of ['inbox', 'root', 'launched', 'outside']) {
    const f = fixture({ a: { name: 'a.png', parents: [parent] }, outside: { mimeType: 'application/vnd.google-apps.folder', parents: ['root'] } });
    await f.move('a');
    assert.deepEqual(f.trashed, []);
  }
});

test('failed asset move does not clean up any folders', async () => {
  const f = fixture(); f.setFailMove();
  await assert.rejects(f.move('a'), /Move failed/);
  assert.deepEqual(f.trashed, []);
  assert.deepEqual(f.files.a.parents, ['feed']);
});

test('cleanup permission failure preserves the successful launch result', async () => {
  const f = fixture(); f.setFailCleanup();
  const result = await f.move('a');
  assert.deepEqual(result.parents, ['launched']);
  assert.equal(f.warnings.length, 1);
  assert.deepEqual(f.trashed, []);
});

test('incomplete child listings cannot justify trashing a folder', async () => {
  const f = fixture(); f.setIncomplete();
  await f.move('a');
  assert.deepEqual(f.trashed, []);
});

test('cyclic or ambiguous ancestry is left untouched', async () => {
  for (const parents of [['creative', 'outside'], ['feed']]) {
    const f = fixture(); f.files.feed.parents = parents;
    await f.move('a');
    assert.deepEqual(f.trashed, []);
  }
});
