import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(root, '.env');
if (fs.existsSync(target)) {
  console.log('Pengaturan admin sudah ada.');
  process.exit(0);
}
const password = crypto.randomBytes(21).toString('base64url');
fs.writeFileSync(target, `ADMIN_PASSWORD=${password}\nPORT=3000\nPUBLIC_URL=http://localhost:3000\nLISTEN_HOST=127.0.0.1\nLOCAL_NO_LOGIN=1\n`, { mode: 0o600, flag: 'wx' });
console.log('Kata sandi admin baru Anda: ' + password);
console.log('Simpan kata sandi ini untuk menjaga konfigurasi saat dipasang online. Mode localhost langsung membuka panel tanpa login.');
