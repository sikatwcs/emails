import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { matchingMessage } from './lib.js';

export function imapPublicMessage(error) {
  const details = [error?.serverResponseCode, error?.responseText, error?.message, error?.code].filter(Boolean).join(' ');
  if (/AUTHENTICATIONFAILED|authentication failed|invalid credentials|login failed/i.test(details)) {
    return 'Login IMAP ditolak oleh Hostinger. Periksa alamat mailbox dan gunakan kata sandi mailbox tersebut, bukan password hPanel atau password admin Surat.';
  }
  if (/ETIMEDOUT|ESOCKETTIMEDOUT|ECONNREFUSED|ENOTFOUND|timeout|timed out/i.test(details)) {
    return 'Server IMAP Hostinger tidak dapat dijangkau. Periksa host, port, dan koneksi jaringan.';
  }
  return 'Tidak bisa menghubungi server email. Periksa server IMAP, koneksi, dan kata sandi mailbox.';
}

async function withImap(settings, callback) {
  const client = new ImapFlow({
    host: settings.host,
    port: Number(settings.port),
    secure: true,
    auth: { user: settings.email, pass: settings.password },
    logger: false,
    socketTimeout: 20000,
    connectionTimeout: 15000
  });
  try {
    await client.connect();
    await client.mailboxOpen('INBOX', { readOnly: true });
    return await callback(client);
  } catch (error) {
    error.source = 'imap';
    error.publicMessage = imapPublicMessage(error);
    throw error;
  } finally {
    if (client.usable) await client.logout().catch(() => {});
    else client.close();
  }
}

function item(mail, uid) {
  return {
    uid,
    from: mail.from?.text || '(pengirim tidak dikenal)',
    to: mail.to?.text || '',
    subject: mail.subject || '(tanpa subjek)',
    date: mail.date?.toISOString?.() || null,
    preview: String(mail.text || '').replace(/\s+/g, ' ').trim().slice(0, 150)
  };
}

export async function testImap(settings) {
  return withImap(settings, async client => ({ connected: true, mailbox: client.mailbox.path, exists: client.mailbox.exists }));
}

export async function listMessages(settings, alias) {
  return withImap(settings, async client => {
    const all = await client.search({ all: true }, { uid: true });
    const latest = all.slice(-80).reverse();
    const result = [];
    for (const uid of latest) {
      const fetched = await client.fetchOne(uid, { source: true }, { uid: true });
      if (!fetched?.source) continue;
      const mail = await simpleParser(fetched.source);
      if (matchingMessage(mail, alias)) result.push(item(mail, uid));
      if (result.length >= 40) break;
    }
    return result;
  });
}

export async function listMessagesForApi(settings, alias, requestedLimit = 20) {
  const limit = Math.min(50, Math.max(1, Number(requestedLimit) || 20));
  return withImap(settings, async client => {
    const all = await client.search({ all: true }, { uid: true });
    const latest = all.slice(-100).reverse();
    const result = [];
    for (const uid of latest) {
      const fetched = await client.fetchOne(uid, { source: true }, { uid: true });
      if (!fetched?.source) continue;
      const mail = await simpleParser(fetched.source);
      if (!matchingMessage(mail, alias)) continue;
      const text = String(mail.text || '').slice(0, 100000);
      const html = typeof mail.html === 'string' ? mail.html.slice(0, 100000) : '';
      const code = text.match(/(^|\D)(\d{6})(?!\d)/)?.[2] || '';
      result.push({
        ...item(mail, uid), id: uid, emailId: uid,
        sender: mail.from?.text || '', recipient: mail.to?.text || alias || settings.email,
        receivedAt: mail.date?.toISOString?.() || null,
        text, body: text, html, bodyPreview: text.replace(/\s+/g, ' ').trim().slice(0, 500),
        ...(code ? { verificationCode: code } : {})
      });
      if (result.length >= limit) break;
    }
    return result;
  });
}

export async function readMessage(settings, alias, uid) {
  return withImap(settings, async client => {
    const fetched = await client.fetchOne(uid, { source: true }, { uid: true });
    if (!fetched?.source) return null;
    const mail = await simpleParser(fetched.source);
    if (!matchingMessage(mail, alias)) return null;
    return {
      ...item(mail, uid),
      text: String(mail.text || '').slice(0, 100000),
      attachments: mail.attachments.map(a => ({ filename: a.filename || 'lampiran', size: a.size, contentType: a.contentType }))
    };
  });
}
