import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { providerRouter } from './provider.js';
import { tokenHash } from './lib.js';

const apiToken = 't'.repeat(32);
const sitePassword = 'p'.repeat(32);

async function fixture() {
  const state = {
    imap: { email: 'utama@example.com' },
    inboxes: [],
    provider: {
      tokenHash: tokenHash(apiToken),
      passwordHash: tokenHash(sitePassword),
      catchAllConfirmed: false,
      localLength: 12
    }
  };
  let lastRead = null;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.state = state; next(); });
  app.use('/api', providerRouter({
    save: async () => {},
    mutateState: async mutate => mutate(state),
    imapSettings: () => ({ email: state.imap.email }),
    isAdmin: () => false,
    listMessages: async () => [],
    listMessagesForApi: async (_settings, address, limit) => {
      lastRead = { address, limit };
      return [{ id: 7, toEmail: address, body: 'Kode 123456', verificationCode: '123456' }];
    },
    readMessage: async () => null,
    publicUrl: 'https://surat.example'
  }));
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message }));
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, body, method = 'POST') => fetch(base + path, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: apiToken,
      'x-auth-token': apiToken,
      'x-custom-auth': sitePassword
    },
    body: JSON.stringify(body)
  });
  return { state, request, getLastRead: () => lastRead, close: () => new Promise(resolve => server.close(resolve)) };
}

test('endpoint CloudMail menerima header mentah SunnyRegister dan mengembalikan daftar pesan', async () => {
  const f = await fixture();
  try {
    const response = await f.request('/api/public/emailList', { toEmail: 'healthcheck@example.com', size: 20 });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.code, 0);
    assert.equal(payload.items[0].verificationCode, '123456');
    assert.deepEqual(f.getLastRead(), { address: 'healthcheck@example.com', limit: 20 });
  } finally { await f.close(); }
});

test('pembuatan alamat SunnyRegister ditolak sebelum Catch-All dikonfirmasi', async () => {
  const f = await fixture();
  try {
    const response = await f.request('/api/public/addUser', { list: [{ email: 'acak@example.com', password: 'unused' }] });
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /Catch-All/);
    assert.equal(f.state.inboxes.length, 0);
  } finally { await f.close(); }
});

test('pembuatan dan penghapusan alamat SunnyRegister tidak menulis state bersama setelah Catch-All aktif', async () => {
  const f = await fixture();
  try {
    f.state.provider.catchAllConfirmed = true;
    let response = await f.request('/api/public/addUser', { list: [{ email: 'acak@example.com', password: 'unused' }] });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).data, ['acak@example.com']);
    assert.equal(f.state.inboxes.length, 0);

    response = await f.request('/api/public/deleteUser', { email: 'acak@example.com' });
    assert.equal(response.status, 200);
    assert.equal(f.state.inboxes.length, 0);
  } finally { await f.close(); }
});
