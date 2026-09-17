import express from 'express';
import crypto from 'node:crypto';
import { normalizeEmail, randomToken, safeEquals, tokenHash } from './lib.js';

const bad = (message, status = 400) => Object.assign(new Error(message), { status });

export function providerRouter({ save, mutateState, imapSettings, isAdmin, listMessages, listMessagesForApi, readMessage, publicUrl }) {
  const router = express.Router();
  const base = String(publicUrl).replace(/\/$/, '');
  const admin = (req, res, next) => isAdmin(req) ? next() : res.status(401).json({ error: 'Masuk sebagai admin terlebih dahulu.' });
  const bearer = req => {
    const authorization = String(req.headers.authorization || '').trim();
    const raw = authorization.replace(/^Bearer\s+/i, '') || String(req.headers['x-auth-token'] || '').trim();
    return /^[A-Za-z0-9_-]{20,}$/.test(raw) ? raw : '';
  };
  const creator = (req, res, next) => {
    const state = req.state;
    if (!state.provider.tokenHash || !state.provider.passwordHash) return res.status(409).json({ error: 'Buat kunci API di panel Surat terlebih dahulu.' });
    if (!safeEquals(tokenHash(bearer(req)), state.provider.tokenHash) || !safeEquals(tokenHash(req.headers['x-custom-auth'] || ''), state.provider.passwordHash)) return res.status(401).json({ error: 'TOKEN_API_PUBLIK atau PASSWORDS salah.' });
    next();
  };
  const addressReader = (req, res, next) => {
    const state = req.state;
    const hash = tokenHash(bearer(req));
    const inbox = state.inboxes.find(x => safeEquals(x.tokenHash, hash) && Date.parse(x.expiresAt) > Date.now());
    if (!inbox) return res.status(401).json({ error: 'Kunci alamat tidak valid atau sudah kedaluwarsa.' });
    req.addressInbox = inbox;
    next();
  };
  const alias = (inbox, settings) => inbox.address === settings.email ? null : inbox.address;
  const handle = fn => async (req, res, next) => { try { await fn(req, res); } catch (error) { next(error); } };
  const addressForSettings = (raw, settings) => {
    const address = normalizeEmail(raw);
    if (address.split('@')[1] !== settings.email.split('@')[1]) throw bad('Alamat harus memakai domain email Hostinger yang terhubung.');
    return address;
  };

  router.get('/provider/settings', admin, (req, res) => {
    const state = req.state;
    res.json({ apiUrl: base, publicUrl: `${base}/api/new_address`, domains: state.imap ? [state.imap.email.split('@')[1]] : [], localLength: state.provider.localLength || 12, catchAllConfirmed: !!state.provider.catchAllConfirmed, autoMailboxUser: !!state.provider.autoMailboxUser, keepFailedMailbox: !!state.provider.keepFailedMailbox, useForSignup: !!state.provider.useForSignup, useForRebind: !!state.provider.useForRebind, hasToken: !!state.provider.tokenHash, hasPassword: !!state.provider.passwordHash, ready: !!state.imap?.passwordEnc && !!state.provider.tokenHash });
  });
  router.post('/provider/settings', admin, handle(async (req, res) => {
    const state = req.state;
    imapSettings(req);
    const length = Number(req.body.localLength || 12);
    if (!Number.isInteger(length) || length < 3 || length > 50) throw bad('Panjang bagian lokal harus 3-50.');
    state.provider.localLength = length;
    state.provider.catchAllConfirmed = !!req.body.catchAllConfirmed;
    for (const key of ['autoMailboxUser', 'keepFailedMailbox', 'useForSignup', 'useForRebind']) state.provider[key] = !!req.body[key];
    await save(req);
    res.json({ ok: true, note: 'Pengaturan API tersimpan. Alamat acak hanya dibuat bila Catch-All sudah diarahkan ke inbox utama.' });
  }));
  router.post('/provider/keys', admin, handle(async (req, res) => {
    const state = req.state;
    const token = randomToken();
    const password = randomToken();
    state.provider.tokenHash = tokenHash(token);
    state.provider.passwordHash = tokenHash(password);
    await save(req);
    res.json({ token, password, note: 'Salin dua kunci ini sekarang. Kunci lama tidak berlaku dan tidak dapat ditampilkan ulang.' });
  }));
  router.get('/status', (req, res) => {
    const state = req.state;
    res.json({ service: 'Surat Hostinger API', ready: !!state.imap?.passwordEnc && !!state.provider.tokenHash, domains: state.imap ? [state.imap.email.split('@')[1]] : [], catchAllConfirmed: !!state.provider.catchAllConfirmed, release: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || null });
  });

  router.post('/new_address', creator, handle(async (req, res) => {
    const settings = imapSettings(req);
    const domain = settings.email.split('@')[1];
    let address;
    if (req.body.address) {
      address = normalizeEmail(req.body.address);
    } else {
      const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
      const bytes = crypto.randomBytes(req.state.provider.localLength || 12);
      address = `${Array.from(bytes, x => chars[x % chars.length]).join('')}@${domain}`;
    }
    if (address.split('@')[1] !== domain) throw bad('Alamat harus memakai domain email Hostinger yang terhubung.');
    const days = Number(req.body.days || 7);
    if (![1, 7, 30].includes(days)) throw bad('Masa berlaku alamat harus 1, 7, atau 30 hari.');
    const addressToken = randomToken();
    const inbox = { id: crypto.randomUUID(), tokenHash: tokenHash(addressToken), address, label: address.split('@')[0], createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + days * 86400000).toISOString() };
    await mutateState(state => {
      if (address !== settings.email && !state.provider.catchAllConfirmed && !state.inboxes.some(x => x.address === address)) {
        throw bad(req.body.address ? 'Alamat ini belum terdaftar. Tambahkan alias yang sudah aktif di panel Surat atau aktifkan Catch-All.' : 'Aktifkan dan verifikasi Catch-All Hostinger ke inbox utama sebelum membuat alamat acak.', 409);
      }
      state.inboxes.unshift(inbox);
    });
    res.status(201).json({ address, address_id: inbox.id, jwt: addressToken, inbox_url: `${base}/i/${addressToken}`, expires_at: inbox.expiresAt });
  }));
  router.post('/public/addUser', creator, handle(async (req, res) => {
    const settings = imapSettings(req);
    const list = Array.isArray(req.body.list) ? req.body.list : [];
    if (!list.length) throw bad('Daftar alamat email kosong.');
    const added = list.slice(0, 50).map(entry => addressForSettings(typeof entry === 'string' ? entry : entry?.email, settings));
    if (added.some(address => address !== settings.email) && !req.state.provider.catchAllConfirmed) {
      throw bad('Catch-All Hostinger belum dikonfirmasi. Aktifkan Catch-All ke inbox utama lalu centang konfirmasinya di Surat.', 409);
    }
    // With Hostinger Catch-All there is no upstream mailbox account to create.
    // SunnyRegister owns the generated-address records; Surat only validates the domain
    // and reads messages for those recipients from the primary IMAP inbox.
    res.json({ code: 0, success: true, data: added, message: 'Mailbox users created' });
  }));
  router.post('/public/emailList', creator, handle(async (req, res) => {
    const settings = imapSettings(req);
    const address = addressForSettings(req.body.toEmail, settings);
    const size = Math.min(50, Math.max(1, Number(req.body.size) || 20));
    const messages = await listMessagesForApi(settings, address === settings.email ? null : address, size);
    res.json({ code: 0, success: true, data: messages, items: messages, count: messages.length });
  }));
  router.all('/public/deleteUser', creator, handle(async (req, res) => {
    const settings = imapSettings(req);
    const candidate = req.query.email || req.body?.email || req.body?.emails?.[0] || (typeof req.body?.list?.[0] === 'string' ? req.body.list[0] : req.body?.list?.[0]?.email);
    addressForSettings(candidate, settings);
    res.json({ code: 0, success: true, message: 'Mailbox user deleted' });
  }));
  router.get(['/mails', '/parsed_mails'], addressReader, handle(async (req, res) => {
    const settings = imapSettings(req);
    const mails = await listMessages(settings, alias(req.addressInbox, settings));
    res.json({ address: req.addressInbox.address, mails, messages: mails, data: mails, count: mails.length });
  }));
  router.get(['/mails/:uid', '/parsed_mail/:uid'], addressReader, handle(async (req, res) => {
    const uid = Number(req.params.uid);
    if (!Number.isInteger(uid) || uid < 1) throw bad('Nomor pesan tidak valid.');
    const settings = imapSettings(req);
    const mail = await readMessage(settings, alias(req.addressInbox, settings), uid);
    if (!mail) throw bad('Pesan tidak ditemukan pada alamat ini.', 404);
    res.json(mail);
  }));
  return router;
}
