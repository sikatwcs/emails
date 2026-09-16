import crypto from 'node:crypto';

export function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9.+_-]{0,63}@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) throw new Error('Alamat email tidak valid.');
  return email;
}

export function matchingMessage(mail, address) {
  if (!address) return true;
  const escaped = address.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const exactAddress = new RegExp(`(^|[^a-z0-9.+_-])${escaped}(?=$|[^a-z0-9.+_-])`, 'i');
  const headers = ['to', 'cc', 'delivered-to', 'x-original-to', 'envelope-to', 'x-forwarded-to'];
  const needles = headers.map(key => {
    const val = mail.headers?.get?.(key);
    if (!val) return '';
    if (typeof val === 'string') return val.toLowerCase();
    if (val.text) return String(val.text).toLowerCase();
    return JSON.stringify(val).toLowerCase();
  });
  return needles.some(text => exactAddress.test(text));
}

export function encrypt(plaintext, passphrase) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(passphrase, salt, 32);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return [salt, iv, cipher.getAuthTag(), encrypted].map(v => v.toString('base64url')).join('.');
}

export function decrypt(payload, passphrase) {
  const [salt, iv, tag, data] = String(payload).split('.').map(v => Buffer.from(v, 'base64url'));
  const key = crypto.scryptSync(passphrase, salt, 32);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

export function randomToken() { return crypto.randomBytes(32).toString('base64url'); }
export function tokenHash(token) { return crypto.createHash('sha256').update(String(token)).digest('hex'); }

export function safeEquals(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}
