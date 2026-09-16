import test from 'node:test';
import assert from 'node:assert/strict';
import { decrypt, encrypt, matchingMessage, normalizeEmail, randomToken, tokenHash } from './lib.js';

test('alamat email dinormalisasi dan alamat salah ditolak', () => {
  assert.equal(normalizeEmail('  Alias@Example.com '), 'alias@example.com');
  assert.throws(() => normalizeEmail('bukan-email'));
});

test('konfigurasi rahasia terenkripsi dan hanya terbuka dengan kunci benar', () => {
  const encoded=encrypt('kata-sandi-imep', 'kata-sandi-admin-yang-panjang');
  assert.ok(!encoded.includes('kata-sandi-imep'));
  assert.equal(decrypt(encoded, 'kata-sandi-admin-yang-panjang'), 'kata-sandi-imep');
  assert.throws(() => decrypt(encoded, 'kunci-lain'));
});

test('alias hanya melihat pesan dengan tujuan yang cocok', () => {
  const mail={headers:new Map([['to',{text:'Orang <alias@example.com>'}]])};
  assert.equal(matchingMessage(mail,'alias@example.com'),true);
  assert.equal(matchingMessage(mail,'lain@example.com'),false);
  assert.equal(matchingMessage({headers:new Map([['to','alias@example.com.evil']])},'alias@example.com'),false);
});

test('tautan menggunakan kunci acak yang tidak disimpan mentah', () => {
  const a=randomToken(), b=randomToken();
  assert.notEqual(a,b);
  assert.ok(a.length>=40);
  assert.notEqual(tokenHash(a),a);
});
