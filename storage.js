import fs from 'node:fs';
import path from 'node:path';
import { get, put } from '@vercel/blob';

const emptyState = () => ({ imap: null, cloudmail: {}, provider: {}, inboxes: [] });
const fill = value => ({ ...emptyState(), ...(value || {}), cloudmail: value?.cloudmail || {}, provider: value?.provider || {}, inboxes: value?.inboxes || [] });

export function createStore(root, { remote = process.env.VERCEL === '1', blobClient = { get, put } } = {}) {
  if (remote) {
    const pathname = 'surat/private-state.json';
    const requireToken = () => {
      if (!process.env.BLOB_READ_WRITE_TOKEN && blobClient.get === get) throw new Error('Hubungkan Private Vercel Blob ke proyek sebelum menggunakan API.');
    };
    return {
      async read() {
        requireToken();
        const result = await blobClient.get(pathname, { access: 'private' });
        if (!result) return { state: emptyState(), etag: null };
        const chunks = [];
        for await (const chunk of result.stream) chunks.push(Buffer.from(chunk));
        return { state: fill(JSON.parse(Buffer.concat(chunks).toString('utf8'))), etag: result.blob.etag };
      },
      async write(state, etag) {
        requireToken();
        try {
          await blobClient.put(pathname, JSON.stringify(fill(state)), {
            access: 'private',
            contentType: 'application/json',
            allowOverwrite: !!etag,
            ...(etag ? { ifMatch: etag } : {})
          });
        } catch (error) {
          if (/precondition|already exists|conflict/i.test(String(error.name || '') + ' ' + String(error.message || ''))) {
            throw Object.assign(new Error('Pengaturan berubah bersamaan dengan permintaan lain. Muat ulang dan coba lagi.'), { status: 409 });
          }
          throw error;
        }
      }
    };
  }
  const dataDir = path.join(root, 'data');
  const statePath = path.join(dataDir, 'state.json');
  fs.mkdirSync(dataDir, { recursive: true });
  return {
    async read() {
      return { state: fill(fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : null), etag: null };
    },
    async write(state) {
      const temp = statePath + '.tmp';
      fs.writeFileSync(temp, JSON.stringify(fill(state), null, 2), { mode: 0o600 });
      fs.renameSync(temp, statePath);
    }
  };
}
