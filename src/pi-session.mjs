import { open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';

export function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function parseSession(text) {
  // Only newline-terminated records are committed to this snapshot.
  const end = text.lastIndexOf('\n');
  const lines = text.slice(0, end + 1).split('\n').filter((line) => line.trim());
  if (!lines.length) throw new Error('session_not_ready');
  let records;
  try { records = lines.map((line) => JSON.parse(line)); }
  catch { throw new Error('session_invalid_json'); }
  const [header, ...entries] = records;
  if (header.type !== 'session' || header.version !== 3 || typeof header.id !== 'string') {
    throw new Error('session_unsupported_format');
  }
  const index = new Map();
  for (const entry of entries) {
    if (typeof entry.id !== 'string' || index.has(entry.id) ||
        !(entry.parentId === null || index.has(entry.parentId))) {
      throw new Error('session_invalid_tree');
    }
    index.set(entry.id, entry);
  }
  const branch = [];
  let entry = entries.at(-1);
  while (entry) {
    branch.push(entry);
    entry = index.get(entry.parentId);
  }
  const messages = branch.reverse()
    .filter((item) => item.type === 'message' && item.message?.role === 'user')
    .map((item) => ({
      id: item.id,
      text: typeof item.message.content === 'string' ? item.message.content :
        (Array.isArray(item.message.content) ? item.message.content : [])
          .filter((block) => block.type === 'text' && typeof block.text === 'string')
          .map((block) => block.text).join('\n'),
    }));
  return {
    sessionId: header.id,
    messages,
    version: hash(JSON.stringify([header.id, messages])),
    lastPersistedEntryId: entries.at(-1)?.id ?? null,
    activeLeaf: 'unknown',
    partial: end < text.length - 1,
  };
}

export async function readSession(path) {
  if (!isAbsolute(path)) throw new Error('session_nonlocal_path');
  const file = await open(path, 'r');
  try {
    const before = await file.stat();
    if (!before.isFile() || before.size > 32 * 1024 * 1024) throw new Error('session_size_limit');
    const buffer = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, offset);
      if (!bytesRead) throw new Error('session_changed_during_read');
      offset += bytesRead;
    }
    const after = await file.stat();
    if (after.size < before.size) throw new Error('session_changed_during_read');
    return { ...parseSession(buffer.toString('utf8')), fileIdentity: `${before.dev}:${before.ino}` };
  } finally { await file.close(); }
}
