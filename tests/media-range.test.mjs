import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMediaRange } from '../api/_lib/media-range.js';

test('media ranges handle seeking, suffixes, and reject unsatisfiable requests', () => {
  assert.equal(parseMediaRange(undefined, 100), null);
  assert.deepEqual(parseMediaRange('bytes=10-19', 100), { start: 10, end: 19 });
  assert.deepEqual(parseMediaRange('bytes=90-', 100), { start: 90, end: 99 });
  assert.deepEqual(parseMediaRange('bytes=-20', 100), { start: 80, end: 99 });
  assert.deepEqual(parseMediaRange('bytes=-200', 100), { start: 0, end: 99 });
  assert.deepEqual(parseMediaRange('bytes=0-999', 100), { start: 0, end: 99 });
  for (const header of ['bytes=-', 'bytes=-0', 'bytes=100-', 'bytes=20-10', 'bytes=0-1,3-4', 'bytes=9007199254740993-', 'invalid']) {
    assert.equal(parseMediaRange(header, 100), false, header);
  }
  assert.equal(parseMediaRange('bytes=0-', 0), false);
});
