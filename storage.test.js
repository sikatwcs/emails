import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStateMutator, createStore } from './storage.js';

test('penyimpanan lokal tetap membaca konfigurasi lama dan menulis perubahan', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surat-store-'));
  try {
    fs.mkdirSync(path.join(root, 'data'));
    fs.writeFileSync(path.join(root, 'data', 'state.json'), JSON.stringify({ imap: { email: 'utama@contoh.com', passwordEnc: 'terenkripsi' }, inboxes: [] }));
    const store = createStore(root, { remote: false });
    const loaded = await store.read();
    assert.equal(loaded.state.imap.email, 'utama@contoh.com');
    loaded.state.provider.localLength = 12;
    await store.write(loaded.state);
    assert.equal((await store.read()).state.provider.localLength, 12);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('penyimpanan Vercel menolak penulisan dari salinan usang', async () => {
  let content = null;
  let version = 0;
  const blobClient = {
    async get() {
      if (!content) return null;
      const bytes = new TextEncoder().encode(content);
      return { blob: { etag: `v${version}` }, stream: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }) };
    },
    async put(_name, value, options) {
      if ((content && !options.allowOverwrite) || (content && options.ifMatch !== `v${version}`)) throw Object.assign(new Error('precondition failed'), { name: 'BlobPreconditionFailedError' });
      content = value;
      version++;
    }
  };
  const store = createStore('/unused', { remote: true, blobClient });
  const first = await store.read();
  first.state.provider.localLength = 12;
  await store.write(first.state, first.etag);
  const stale = await store.read();
  const current = await store.read();
  current.state.inboxes.push({ id: 'new' });
  await store.write(current.state, current.etag);
  stale.state.provider.localLength = 20;
  await assert.rejects(store.write(stale.state, stale.etag), { status: 409 });
  assert.equal((await store.read()).state.inboxes[0].id, 'new');
});

test('mutasi paralel Vercel Blob diulang tanpa kehilangan mailbox', async () => {
  let content = null;
  let version = 0;
  const blobClient = {
    async get() {
      if (!content) return null;
      const snapshot = content;
      const snapshotVersion = version;
      const bytes = new TextEncoder().encode(snapshot);
      return { blob: { etag: `v${snapshotVersion}` }, stream: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }) };
    },
    async put(_name, value, options) {
      await new Promise(resolve => setImmediate(resolve));
      if ((content && !options.allowOverwrite) || (content && options.ifMatch !== `v${version}`)) throw Object.assign(new Error('precondition failed'), { name: 'BlobPreconditionFailedError' });
      content = value;
      version++;
    }
  };
  const store = createStore('/unused', { remote: true, blobClient });
  const mutate = createStateMutator(store, { wait: () => Promise.resolve() });
  await Promise.all(Array.from({ length: 10 }, (_, index) => mutate(state => {
    state.inboxes.push({ id: `mailbox-${index}` });
  })));
  const final = await store.read();
  assert.equal(final.state.inboxes.length, 10);
  assert.deepEqual(final.state.inboxes.map(x => x.id).sort(), Array.from({ length: 10 }, (_, index) => `mailbox-${index}`).sort());
});
