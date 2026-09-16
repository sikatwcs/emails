import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { decrypt, encrypt, normalizeEmail, randomToken, safeEquals, tokenHash } from './lib.js';
import { listMessages, listMessagesForApi, readMessage, testImap } from './imap.js';
import { providerRouter } from './provider.js';
import { createStore } from './storage.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const hosted = process.env.VERCEL === '1' || !!process.env.VERCEL_ENV || !!process.env.BLOB_READ_WRITE_TOKEN;
const store = createStore(root);
const adminPassword = process.env.ADMIN_PASSWORD;
const adminConfigured = !!adminPassword && adminPassword !== 'isi_kata_sandi_admin_yang_panjang_dan_unik' && adminPassword.length >= 12;
const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
const publicUrl = process.env.PUBLIC_URL || (vercelHost ? `https://${vercelHost}` : `http://localhost:${process.env.PORT || 3000}`);
const localNoLogin = !hosted && process.env.LOCAL_NO_LOGIN === '1' &&
  (process.env.LISTEN_HOST || '127.0.0.1') === '127.0.0.1' &&
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(publicUrl);
async function save(req) {
  try { await store.write(req.state, req.stateEtag); }
  catch (error) { error.source = 'storage'; throw error; }
}

function imapSettings(req) {
  const state = req.state;
  if (!state.imap?.passwordEnc) throw Object.assign(new Error('Hubungkan kotak surat Hostinger di Pengaturan terlebih dahulu.'), { status: 409 });
  return { ...state.imap, password: decrypt(state.imap.passwordEnc, adminPassword) };
}

const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  if (adminConfigured) return next();
  const message = 'ADMIN_PASSWORD belum siap. Isi kata sandi admin minimal 12 karakter pada Environment Variables Vercel, lalu Redeploy.';
  if (req.path.startsWith('/api/')) return res.status(503).json({ error: message });
  res.status(503).type('html').send(`<html lang="id"><meta charset="utf-8"><title>Surat belum siap</title><body style="font:18px system-ui;max-width:650px;margin:80px auto;padding:20px"><h1>Surat belum siap</h1><p>${message}</p></body></html>`);
});
app.use(express.json({ limit: '30kb' }));
app.use('/api', async (req, _res, next) => {
  try {
    const loaded = await store.read();
    req.state = loaded.state;
    req.stateEtag = loaded.etag;
    next();
  } catch (error) { error.source = 'storage'; next(error); }
});
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('Cache-Control', 'no-store');
  next();
});

function sessionValue() {
  const expires = Date.now() + 12 * 60 * 60 * 1000;
  const payload = String(expires);
  const sig = crypto.createHmac('sha256', adminPassword).update(payload).digest('base64url');
  return payload + '.' + sig;
}

function isAdmin(req) {
  const requestHost = String(req.headers.host || '').split(':')[0].toLowerCase();
  const remote = req.socket.remoteAddress;
  if (localNoLogin && ['localhost','127.0.0.1'].includes(requestHost) &&
      ['127.0.0.1','::ffff:127.0.0.1'].includes(remote)) return true;
  const raw = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('mail_admin='))?.slice(11);
  if (!raw) return false;
  const [expiry, sig] = raw.split('.');
  if (!expiry || !sig || Number(expiry) < Date.now()) return false;
  const expected = crypto.createHmac('sha256', adminPassword).update(expiry).digest('base64url');
  return safeEquals(sig, expected);
}

function adminOnly(req, res, next) {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Masuk sebagai admin terlebih dahulu.' });
  next();
}

const loginAttempts = new Map();
app.post('/api/login', (req, res) => {
  const ip = req.ip;
  const recorded = loginAttempts.get(ip) || { count: 0, until: 0 };
  const previous = recorded.until < Date.now() ? { count: 0, until: 0 } : recorded;
  if (previous.count >= 8 && previous.until > Date.now()) return res.status(429).json({ error: 'Terlalu banyak percobaan. Coba lagi dalam 15 menit.' });
  if (!safeEquals(req.body.password || '', adminPassword)) {
    loginAttempts.set(ip, { count: previous.count + 1, until: Date.now() + 15 * 60 * 1000 });
    return res.status(401).json({ error: 'Kata sandi admin salah.' });
  }
  loginAttempts.delete(ip);
  res.cookie('mail_admin', sessionValue(), { httpOnly: true, sameSite: 'strict', secure: publicUrl.startsWith('https://'), maxAge: 12 * 60 * 60 * 1000, path: '/' });
  res.json({ ok: true });
});
app.post('/api/logout', (_req, res) => { res.clearCookie('mail_admin'); res.json({ ok: true }); });
app.get('/api/session', (req, res) => res.json({ admin: isAdmin(req), local: localNoLogin }));

app.get('/api/settings', adminOnly, (req, res) => {
  const state = req.state;
  const { tokenEnc, passwordEnc, ...cloudmail } = state.cloudmail;
  res.json({
    imap: state.imap ? { host: state.imap.host, port: state.imap.port, email: state.imap.email, hasPassword: true } : null,
    cloudmail: { ...cloudmail, hasToken: !!tokenEnc, hasPassword: !!passwordEnc },
    inboxes: state.inboxes.map(({ id, address, label, expiresAt, createdAt }) => ({ id, address, label, expiresAt, createdAt }))
  });
});

app.post('/api/settings/imap', adminOnly, async (req, res, next) => {
  try {
    const state = req.state;
    const host = String(req.body.host || 'imap.hostinger.com').trim();
    const port = Number(req.body.port || 993);
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || (state.imap?.email === email ? decrypt(state.imap.passwordEnc, adminPassword) : ''));
    if (!/^[a-z0-9.-]+$/i.test(host) || !Number.isInteger(port) || port < 1 || port > 65535 || !password) throw Object.assign(new Error('Isi server IMAP, port, email, dan kata sandi yang benar.'), { status: 400 });
    const tested = await testImap({ host, port, email, password });
    if (state.imap?.email && state.imap.email !== email) state.inboxes = [];
    state.imap = { host, port, email, passwordEnc: encrypt(password, adminPassword) };
    await save(req);
    res.json({ ok: true, tested, note: 'Koneksi berhasil. Kata sandi disimpan terenkripsi di server.' });
  } catch (error) { next(error); }
});
app.post('/api/settings/imap/test', adminOnly, async (req, res, next) => {
  try { res.json(await testImap(imapSettings(req))); } catch (error) { next(error); }
});

app.post('/api/settings/cloudmail', adminOnly, async (req, res, next) => {
  try {
    const state = req.state;
    const apiUrl = String(req.body.apiUrl || '').trim().replace(/\/$/, '');
    const publicUrl = String(req.body.publicUrl || '').trim().replace(/\/$/, '');
    for (const url of [apiUrl, publicUrl].filter(Boolean)) {
      const parsed = new URL(url);
      if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('URL API harus diawali https:// atau http://.');
    }
    const domains = String(req.body.domains || '').split(/\r?\n/).map(x => x.trim().toLowerCase()).filter(Boolean);
    if (domains.some(x => !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(x))) throw new Error('Ada domain kotak surat yang tidak valid.');
    const localLength = Number(req.body.localLength || 12);
    if (!Number.isInteger(localLength) || localLength < 3 || localLength > 50) throw new Error('Panjang bagian lokal harus 3–50.');
    const tokenEnc = req.body.token ? encrypt(String(req.body.token), adminPassword) : state.cloudmail.tokenEnc;
    const passwordEnc = req.body.password ? encrypt(String(req.body.password), adminPassword) : state.cloudmail.passwordEnc;
    state.cloudmail = {
      apiUrl, publicUrl, domains, localLength, tokenEnc, passwordEnc,
      autoMailboxUser: !!req.body.autoMailboxUser,
      keepFailedMailbox: !!req.body.keepFailedMailbox,
      useForSignup: !!req.body.useForSignup,
      useForRebind: !!req.body.useForRebind
    };
    await save(req);
    res.json({ ok: true, note: 'Kolom API tersimpan sebagai konfigurasi opsional. Belum dipakai untuk membaca email Hostinger.' });
  } catch (error) { error.status = 400; next(error); }
});

app.post('/api/inboxes', adminOnly, async (req, res, next) => {
  try {
    const state = req.state;
    const settings = imapSettings(req);
    const address = normalizeEmail(req.body.address || settings.email);
    if (address.split('@')[1] !== settings.email.split('@')[1]) throw Object.assign(new Error('Alias harus berada di domain kotak surat yang terhubung.'), { status: 400 });
    const label = String(req.body.label || address.split('@')[0]).trim().slice(0, 80);
    const days = Number(req.body.days || 7);
    if (![1, 7, 30].includes(days)) throw Object.assign(new Error('Masa berlaku tautan tidak valid.'), { status: 400 });
    const token = randomToken();
    const inbox = { id: crypto.randomUUID(), tokenHash: tokenHash(token), address, label, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + days * 86400000).toISOString() };
    state.inboxes.unshift(inbox);
    await save(req);
    const base = publicUrl.replace(/\/$/, '');
    res.json({ ...inbox, tokenHash: undefined, url: `${base}/i/${token}` });
  } catch (error) { next(error); }
});
app.delete('/api/inboxes/:id', adminOnly, async (req, res, next) => {
  try {
    const state = req.state;
    const count = state.inboxes.length;
    state.inboxes = state.inboxes.filter(x => x.id !== req.params.id);
    if (state.inboxes.length === count) return res.status(404).json({ error: 'Tautan tidak ditemukan.' });
    await save(req);
    res.json({ ok: true });
  } catch (error) { next(error); }
});

function inboxFor(req, token) {
  const state = req.state;
  const hash = tokenHash(token);
  const found = state.inboxes.find(x => safeEquals(x.tokenHash, hash));
  if (!found || Date.parse(found.expiresAt) < Date.now()) throw Object.assign(new Error('Tautan inbox tidak ditemukan atau sudah kedaluwarsa.'), { status: 404 });
  return found;
}

const inboxRequests = new Map();
function publicLimit(req, res, next) {
  const key = req.ip + ':' + req.params.token.slice(0, 8);
  const now = Date.now();
  const hits = (inboxRequests.get(key) || []).filter(t => now - t < 60000);
  if (hits.length >= 30) return res.status(429).json({ error: 'Terlalu sering memuat inbox. Coba lagi sebentar.' });
  hits.push(now);
  inboxRequests.set(key, hits);
  next();
}

app.get('/api/inbox/:token', publicLimit, async (req, res, next) => {
  try {
    const inbox = inboxFor(req, req.params.token);
    const settings = imapSettings(req);
    const alias = inbox.address === settings.email ? null : inbox.address;
    res.json({ inbox: { address: inbox.address, label: inbox.label, expiresAt: inbox.expiresAt }, messages: await listMessages(settings, alias) });
  } catch (error) { next(error); }
});
app.get('/api/inbox/:token/mail/:uid', publicLimit, async (req, res, next) => {
  try {
    const inbox = inboxFor(req, req.params.token);
    const settings = imapSettings(req);
    const uid = Number(req.params.uid);
    if (!Number.isInteger(uid) || uid < 1) return res.status(400).json({ error: 'Nomor pesan tidak valid.' });
    const message = await readMessage(settings, inbox.address === settings.email ? null : inbox.address, uid);
    if (!message) return res.status(404).json({ error: 'Pesan tidak ditemukan pada inbox ini.' });
    res.json(message);
  } catch (error) { next(error); }
});

app.use('/api', providerRouter({ save, imapSettings, isAdmin, listMessages, listMessagesForApi, readMessage, publicUrl }));
app.use(express.static(path.join(root, 'public'), { maxAge: 0, index: false }));
app.get(['/','/i/:token'], (_req, res) => res.sendFile(path.join(root, 'public', 'index.html')));
app.use((error, _req, res, _next) => {
  const status = error.status || 502;
  const message = status === 502 ? (error.source === 'storage' ? 'Penyimpanan data belum tersedia. Periksa koneksi Private Vercel Blob.' : 'Tidak bisa menghubungi server email. Periksa server IMAP, koneksi, dan kata sandi.') : error.message;
  res.status(status).json({ error: message });
});

if (!hosted) {
  app.listen(Number(process.env.PORT || 3000), process.env.LISTEN_HOST || '127.0.0.1', () => {
    console.log(`Inbox web siap di http://localhost:${process.env.PORT || 3000}`);
  });
}
export default app;
