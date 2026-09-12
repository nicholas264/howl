const FOLDER = 'application/vnd.google-apps.folder';
const escapeQuery = value => String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

// Only prune ancestors proven to be below Inbox, and only after the asset moved.
async function pruneEmptyParents(drive, parentIds, inboxId, protectedIds, launchedId) {
  for (const parentId of parentIds) {
    const chain = [];
    const seen = new Set();
    let id = parentId;
    while (id !== inboxId) {
      if (!id || protectedIds.has(id) || seen.has(id)) break;
      seen.add(id);
      const folder = await drive(`/files/${encodeURIComponent(id)}?fields=id,mimeType,parents,trashed,capabilities(canTrash)&supportsAllDrives=true`);
      if (folder.trashed || folder.mimeType !== FOLDER || folder.parents?.length !== 1) break;
      chain.push({ id, parentId: folder.parents[0], canTrash: folder.capabilities?.canTrash });
      id = folder.parents[0];
    }
    if (id !== inboxId) continue;
    for (const { id: folderId, parentId: sourceParent, canTrash } of chain) {
      const query = new URLSearchParams({
        q: `'${escapeQuery(folderId)}' in parents and trashed=false`,
        fields: 'files(id),nextPageToken,incompleteSearch', pageSize: '1',
        supportsAllDrives: 'true', includeItemsFromAllDrives: 'true',
      });
      const children = await drive(`/files?${query}`);
      // Unknown/incomplete listings must never be treated as empty.
      if (!Array.isArray(children.files) || children.files.length || children.nextPageToken || children.incompleteSearch) break;
      if (canTrash !== false) {
        try {
          await drive(`/files/${encodeURIComponent(folderId)}?supportsAllDrives=true`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ trashed: true }),
          });
          continue;
        } catch (err) {
          if (err.status !== 403) throw err;
        }
      }
      // A writer can move shared folders even when only the owner can trash them.
      // Keep the empty shell in Launched so it no longer suggests pending work.
      const moveQuery = new URLSearchParams({ addParents: launchedId, removeParents: sourceParent,
        fields: 'id,parents', supportsAllDrives: 'true' });
      await drive(`/files/${encodeURIComponent(folderId)}?${moveQuery}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
    }
  }
}

export async function moveLaunchedDriveFile(drive, { fileId, launchedId, name, rootId }, warn = console.warn) {
  const current = await drive(`/files/${encodeURIComponent(fileId)}?fields=name,parents&supportsAllDrives=true`);
  if (current.name === name && current.parents?.includes(launchedId)) return current;
  const query = new URLSearchParams({ fields: 'id,name,parents', supportsAllDrives: 'true' });
  if (!current.parents?.includes(launchedId)) query.set('addParents', launchedId);
  const removed = (current.parents || []).filter(id => id !== launchedId);
  if (removed.length) query.set('removeParents', removed.join(','));
  const updated = await drive(`/files/${encodeURIComponent(fileId)}?${query}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
  });
  try {
    if (removed.length && rootId) {
      const inboxQuery = new URLSearchParams({
        q: `'${escapeQuery(rootId)}' in parents and mimeType='${FOLDER}' and name='Inbox' and trashed=false`,
        fields: 'files(id),nextPageToken,incompleteSearch',
        supportsAllDrives: 'true', includeItemsFromAllDrives: 'true',
      });
      const inboxes = await drive(`/files?${inboxQuery}`);
      if (inboxes.files?.length === 1 && !inboxes.nextPageToken && !inboxes.incompleteSearch) {
        await pruneEmptyParents(drive, removed, inboxes.files[0].id, new Set([rootId, launchedId]), launchedId);
      }
    }
  } catch (err) {
    // Cleanup must not turn a successfully created ad into a failed launch/retry.
    warn('Launched asset moved, but empty Inbox folder cleanup failed:', err.message);
  }
  return updated;
}
