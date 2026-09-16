import test from 'node:test';
import assert from 'node:assert/strict';
import { imapPublicMessage } from './imap.js';

test('error autentikasi IMAP menjelaskan jenis password yang diperlukan', () => {
  const message = imapPublicMessage({ serverResponseCode: 'AUTHENTICATIONFAILED', responseText: 'Authentication failed.' });
  assert.match(message, /Login IMAP ditolak/);
  assert.match(message, /kata sandi mailbox/);
  assert.match(message, /bukan password hPanel/);
});

test('error koneksi IMAP dibedakan dari error autentikasi', () => {
  const message = imapPublicMessage({ code: 'ETIMEDOUT' });
  assert.match(message, /tidak dapat dijangkau/);
});
