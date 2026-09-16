# Surat — inbox web untuk email Hostinger

Web ini membaca email Hostinger melalui IMAP dan membuat tautan inbox seperti `/i/<kunci>` untuk kotak surat utama atau alias yang sudah aktif. Cloudflare tidak diperlukan. Surat juga menyediakan API publik yang dapat dipakai web lain untuk membuat alamat dan membaca pesan.

Email Anda tetap dihosting di Hostinger. Di komputer, Surat memakai file lokal untuk pengaturan. Di Vercel, Surat memakai **Private Vercel Blob** agar pengaturan dan tautan inbox bertahan setelah deploy. GitHub hanya menyimpan kode.

## Jalankan di komputer ini

1. Pastikan Node.js 20 atau lebih baru tersedia.
2. Klik dua kali `BUKA SURAT.bat`. Pada pembukaan pertama, kata sandi admin baru akan ditampilkan; simpan untuk keperluan konfigurasi online nanti.
3. Buka `http://localhost:3000` di browser. Mode lokal langsung menampilkan panel tanpa meminta kata sandi admin.
4. Buka **Pengaturan koneksi**, isi email dan kata sandi kotak surat Hostinger, lalu tekan **Uji koneksi & simpan**.

Alternatif melalui terminal: `npm install`, `node setup.js`, lalu `npm start`.

Untuk layanan **Hostinger Email**, server IMAP lazimnya `imap.hostinger.com`, port `993`, SSL/TLS. Jika paket Anda adalah **Titan Email** atau **cPanel Email**, ambil server IMAP yang sesuai dari panel Hostinger Anda. Kata sandi IMAP disimpan terenkripsi memakai kata sandi admin sebagai kunci. Folder `data` dan `.env` diabaikan Git.

File BAT mencari Node.js yang ada di PATH, lalu memakai `C:\Program Files\nodejs\node.exe` sebagai cadangan. Ini membantu jika Explorer memakai PATH yang berbeda dari terminal.

## API untuk web lain

Buka **Pengaturan koneksi → API untuk web lain**, tekan **Buat token API**, lalu salin `TOKEN_API_PUBLIK` dan `PASSWORDS`. URL yang perlu dimasukkan pada proyek lain adalah URL aplikasi Surat (misalnya `https://surat.domainanda.com`) dan URL pengambilan publiknya berakhiran `/api/new_address`.

Web lain membuat alamat dengan `POST /api/new_address`, header `Authorization: Bearer TOKEN_API_PUBLIK`, header `X-Custom-Auth: PASSWORDS`, dan body opsional `{ "days": 7 }`. Respons mengembalikan `address` dan `jwt`; simpan `jwt` sebagai token alamat. Untuk mengambil pesan, kirim `Authorization: Bearer <jwt>` ke `GET /api/mails` atau `GET /api/parsed_mails`. Pesan tunggal tersedia di `/api/mails/<uid>` atau `/api/parsed_mail/<uid>`.

API hanya membuat alamat acak bila Catch-All Hostinger sudah diverifikasi dan diarahkan ke inbox utama. Jika belum, tandai alamat sebagai alias yang sudah dibuat di Hostinger atau aktifkan Catch-All terlebih dahulu. Membuat token API tidak membuat alias Hostinger secara otomatis.

## Alias dan tautan inbox

Buat alias lebih dahulu di **hPanel Hostinger → Emails → Email Alias**, atau atur Catch-All ke kotak surat utama. Membuat tautan di web ini **tidak** membuat alamat baru pada Hostinger. Saat membuat tautan alias, web menyaring pesan berdasarkan alamat pada header `To`, `Cc`, `Delivered-To`, atau `X-Original-To`. Sebagian pesan terusan atau Bcc mungkin tidak membawa header asli, sehingga tidak muncul pada tampilan alias. Tautan untuk alamat kotak surat utama menampilkan seluruh INBOX.

Tombol **Isi alamat acak untuk Catch-All** membuat nama alamat acak di formulir. Alamat itu hanya akan menerima pesan jika Catch-All domain sudah aktif di Hostinger; tombol ini tidak mengubah konfigurasi Hostinger. Panjang nama acaknya mengikuti nilai **Panjang bagian lokal** pada Pengaturan API (default 12).

Tautan berlaku 1, 7, atau 30 hari dan dapat dicabut dari panel admin. Kunci tautan hanya terlihat saat dibuat; simpan tautan itu jika ingin membukanya lagi. Orang yang memegang tautan dapat membaca pesan pada inbox yang terkait.

## GitHub dan Vercel

1. Buat repositori **private** yang kosong pada akun GitHub pribadi. Folder proyek ini sudah disiapkan sebagai repo lokal; hubungkan dengan `git remote add origin <URL-repo-GitHub>` lalu `git push -u origin main`. Jika Anda menyalin file ke folder baru tanpa `.git`, jalankan `git init -b main`, `git add .`, `git commit -m "Siapkan Surat untuk Vercel"` sebelum menghubungkan remote. Pastikan `.env`, `data/`, `node_modules/`, dan file ZIP tidak ada pada `git status` sebelum commit.
2. Di Vercel pilih **Add New → Project**, impor repositori GitHub tersebut. Framework Preset `Express` sudah dinyatakan di `vercel.json`; Root Directory adalah akar repositori. Saat impor, isi Environment Variables Production: `ADMIN_PASSWORD` dengan kata sandi admin baru minimal 12 karakter dan `LOCAL_NO_LOGIN=0`. Jangan memasukkan kata sandi email Hostinger di sini.
3. Setelah proyek Vercel terbentuk, buka **Storage**, buat **Blob** dengan akses **Private**, lalu hubungkan ke proyek Surat untuk lingkungan **Production**. Vercel akan menambahkan `BLOB_READ_WRITE_TOKEN` ke Environment Variables. Jangan memasukkan token Blob ke GitHub.
4. Di **Settings → Environment Variables**, aktifkan **Automatically expose System Environment Variables** agar `VERCEL=1` dan URL produksi tersedia. Bila Anda memakai domain sendiri, isi `PUBLIC_URL=https://subdomain-anda`; jika belum, Surat memakai domain produksi Vercel secara otomatis. URL ini harus tetap sama agar kolom API di web lain tidak perlu diubah setiap deploy.
5. Deploy ulang setelah menambahkan storage. Buka URL Vercel, masuk dengan kata sandi admin, lalu hubungkan kembali email Hostinger lewat panel. Data lokal sengaja tidak dimasukkan ke GitHub; tautan inbox lokal perlu dibuat ulang di web Vercel. Uji `/api/status`, kemudian buat token API di panel.

Untuk membuat alamat acak, aktifkan dan verifikasi Catch-All Hostinger yang diarahkan ke mailbox utama, lalu centang konfirmasi Catch-All pada panel Surat. Tanpa Catch-All, gunakan alamat utama atau alias yang memang sudah aktif. Jangan menaruh `TOKEN_API_PUBLIK` dan `PASSWORDS` dalam JavaScript browser web lain; simpan di pengaturan server web tersebut.

Di komputer, `LOCAL_NO_LOGIN=1` hanya berlaku bila web mendengarkan `127.0.0.1`, URL memakai localhost, dan permintaan datang dari localhost. Pada Vercel panel admin meminta kata sandi terpisah dari kata sandi email Hostinger.

Perintah `npm test` memeriksa penyaringan alias, enkripsi, serta penyimpanan lokal dan penolakan penulisan Vercel dari salinan data yang usang.
