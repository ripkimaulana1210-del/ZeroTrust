# Tahap 6 — Pengujian API dengan cURL (Windows CMD)

Panduan ini merangkum kontrak endpoint dari Gateway dan service yang ada. Semua contoh memakai `curl.exe` satu baris agar dapat ditempel di Windows Command Prompt (`cmd.exe`). Ganti placeholder seperti `<ACCESS_TOKEN>`, `<NILAI_ID>`, `<KELAS_ID>`, dan `<NIM>` dengan nilai dari respons/API dan database uji Anda. Jangan menaruh token atau secret aktif dalam dokumen, tangkapan layar, atau repositori.

## Batas keamanan dan lingkungan

- Gateway: `http://localhost:3000`; Service Nilai: `http://localhost:3001`; Service Transkrip: `http://localhost:3002`.
- Arahkan seluruh pemanggilan resource melalui Gateway. Service menuntut `X-Gateway-Secret`; Gateway menambahkan secret hanya pada permintaan internal. Jangan mengirim atau menuliskan secret pada contoh ini.
- User request resource memerlukan `Authorization: Bearer <ACCESS_TOKEN>` serta `X-Device-ID` yang aktif dan terikat pada akun. ID perangkat yang ditampilkan dokumentasi proyek mencakup `dev-mhs-ahmad` dan `dev-dosen-budi`. Gunakan hanya bila cocok dengan seed/database yang dipakai.
- Login menerima `username` dan `password`, tetapi kredensial bergantung pada database; contoh sengaja memakai placeholder dan tidak menyatakan adanya kredensial default.
- Untuk melindungi data asli, gunakan database uji terpisah. Contoh pada Windows CMD, di tiga terminal CMD terpisah dari folder proyek, dengan nama database salinan yang memang tersedia:

```cmd
set "DATABASE_PATH=data\stage5a-live-verified2.sqlite" && npm run start:gateway
```

```cmd
set "DATABASE_PATH=data\stage5a-live-verified2.sqlite" && npm run start:nilai
```

```cmd
set "DATABASE_PATH=data\stage5a-live-verified2.sqlite" && npm run start:transkrip
```

Pastikan `.env` lokal telah berisi konfigurasi yang dibutuhkan oleh server (`JWT_SECRET`, `GATEWAY_SECRET`, `SERVICE_NILAI_CLIENT_ID`, dan `SERVICE_NILAI_CLIENT_SECRET`). Jangan membagikan nilai rahasia. Jangan menjalankan `npm run db:init` untuk sekadar memulai server: skrip tersebut juga menjalankan seed. Server membaca database yang ditentukan oleh `DATABASE_PATH`; jangan arahkan ke `data/database.sqlite` untuk eksperimen.

## Health check

Gateway menyediakan `GET /health` (publik):

```cmd
curl.exe -i "http://localhost:3000/health"
```

**Service Nilai dan Service Transkrip tidak memiliki route `/health` pada implementasi saat ini.** Untuk mengecek proses/konektivitas tanpa gateway secret, kirim permintaan ke route resource; respons `403 FORBIDDEN_DIRECT_ACCESS` menandakan service menjawab dan menolak akses langsung:

```cmd
curl.exe -i "http://localhost:3001/nilai"
```

```cmd
curl.exe -i "http://localhost:3002/transkrip/<NIM>"
```

## Login dan token

Login memakai `POST /auth/login`, JSON `username`/`password`, dan device ID terdaftar pada header `X-Device-ID`. Respons sukses berisi data autentikasi termasuk access token dan refresh token; gunakan nilai access token untuk request resource. Jangan simpan token ke file publik.

```cmd
curl.exe -i -X POST "http://localhost:3000/auth/login" -H "Content-Type: application/json" -H "X-Device-ID: <DEVICE_ID_TERDAFTAR>" -d "{\"username\":\"<USERNAME>\",\"password\":\"<PASSWORD>\"}"
```

Contoh pola header untuk request mahasiswa:

```cmd
-H "Authorization: Bearer <ACCESS_TOKEN>" -H "X-Device-ID: <DEVICE_ID_TERDAFTAR>"
```

Contoh ID device yang terdokumentasi: `dev-mhs-ahmad` untuk fixture mahasiswa Ahmad dan `dev-dosen-budi` untuk fixture dosen Budi. Device ID harus benar-benar terdaftar untuk akun terkait.

## Membaca nilai dan transkrip

`GET /nilai` mengembalikan daftar nilai sesuai role dan kepemilikan. `GET /nilai/:id` membaca satu nilai yang diizinkan. `GET /transkrip/:nim` membaca transkrip milik mahasiswa sendiri; admin dapat membaca transkrip seluruh mahasiswa.

```cmd
curl.exe -i "http://localhost:3000/nilai" -H "Authorization: Bearer <ACCESS_TOKEN>" -H "X-Device-ID: <DEVICE_ID_TERDAFTAR>"
```

```cmd
curl.exe -i "http://localhost:3000/nilai/<NILAI_ID>" -H "Authorization: Bearer <ACCESS_TOKEN>" -H "X-Device-ID: <DEVICE_ID_TERDAFTAR>"
```

```cmd
curl.exe -i "http://localhost:3000/transkrip/<NIM_MILIK_SENDIRI>" -H "Authorization: Bearer <ACCESS_TOKEN>" -H "X-Device-ID: <DEVICE_ID_TERDAFTAR>"
```

Data transkrip sukses menyertakan `data` dan `ringkasan` IPK/SKS. Perhitungan menggunakan angka mutu dari label tersimpan dan SKS kelas tersimpan. Label legacy tanpa mapping tidak ditebak; data transkrip yang tidak valid menyebabkan respons `500 INVALID_TRANSCRIPT_DATA`.

## Mengubah nilai dan finalisasi

Dosen pengampu mengubah nilai melalui `PUT /nilai/:id`. Nilai numerik dan huruf adalah input terpisah; payload yang diterima adalah `nilai_angka` (0–100) dan `nilai_huruf` salah satu dari `A`, `A-`, `B+`, `B`, `B-`, `C+`, `C`, `D+`, `D`, `D-`, `E`. Jam operasi adalah 07.00–21.00 WIB. Ganti ID dengan nilai/kelas milik dosen tersebut.

```cmd
curl.exe -i -X PUT "http://localhost:3000/nilai/<NILAI_ID>" -H "Content-Type: application/json" -H "Authorization: Bearer <ACCESS_TOKEN_DOSEN>" -H "X-Device-ID: <DEVICE_DOSEN_TERDAFTAR>" -d "{\"nilai_angka\":81,\"nilai_huruf\":\"A-\"}"
```

Finalisasi kelas dilakukan dengan `POST /kelas/:id/finalisasi`; body kosong berbentuk objek JSON:

```cmd
curl.exe -i -X POST "http://localhost:3000/kelas/<KELAS_ID>/finalisasi" -H "Content-Type: application/json" -H "Authorization: Bearer <ACCESS_TOKEN_DOSEN>" -H "X-Device-ID: <DEVICE_DOSEN_TERDAFTAR>" -d "{}"
```

Setelah kelas final, perubahan nilai ditolak. Respons implementasi untuk kelas final yang dicoba diubah adalah `409 CLASS_FINAL` dari Service Nilai; request yang ditolak kebijakan Gateway dapat berstatus `403` sesuai pemeriksaan PEP. Coba ulang perubahan pada nilai yang sama untuk memeriksa penolakan:

```cmd
curl.exe -i -X PUT "http://localhost:3000/nilai/<NILAI_ID>" -H "Content-Type: application/json" -H "Authorization: Bearer <ACCESS_TOKEN_DOSEN>" -H "X-Device-ID: <DEVICE_DOSEN_TERDAFTAR>" -d "{\"nilai_angka\":82,\"nilai_huruf\":\"A\"}"
```

## Menolak akses langsung dan user token pada sinkronisasi

Akses langsung tanpa gateway secret harus ditolak service. Gateway tidak meneruskan secret yang dikirim client; ia menyisipkannya sendiri ke upstream.

```cmd
curl.exe -i "http://localhost:3001/nilai" -H "Authorization: Bearer <ACCESS_TOKEN>" -H "X-Device-ID: <DEVICE_ID_TERDAFTAR>"
```

```cmd
curl.exe -i "http://localhost:3002/transkrip/<NIM>" -H "Authorization: Bearer <ACCESS_TOKEN>" -H "X-Device-ID: <DEVICE_ID_TERDAFTAR>"
```

Endpoint `POST /transkrip/sinkron` hanya untuk service token. Token user biasa yang dikirim lewat Gateway ditolak:

```cmd
curl.exe -i -X POST "http://localhost:3000/transkrip/sinkron" -H "Content-Type: application/json" -H "Authorization: Bearer <ACCESS_TOKEN_USER>" -H "X-Device-ID: <DEVICE_ID_TERDAFTAR>" -d "{\"kelasId\":<KELAS_ID>}"
```

Jangan memanggil endpoint sinkronisasi langsung ke port 3002. Service Nilai memperoleh service token melalui Gateway dan mengirim permintaan sinkronisasi melalui rute Gateway.

## Downstream gagal dan retry

Gunakan database uji terisolasi dan kelas DRAFT valid yang memang diampu dosen. Hentikan sementara Service Transkrip untuk mensimulasikan downstream tidak tersedia; jangan mengubah data produksi. Kirim finalisasi melalui Gateway seperti contoh di atas. Implementasi mengembalikan `502 TRANSCRIPT_SYNC_FAILED`, tetapi kelas telah menjadi `FINAL` dengan `sync_pending=1`; perubahan nilai selanjutnya tidak diizinkan. Nyalakan lagi Service Transkrip pada port 3002, lalu ulangi permintaan finalisasi yang sama melalui Gateway sebagai dosen pengampu. Retry yang berhasil mengembalikan HTTP `200`, melakukan sinkronisasi idempoten, dan menghapus `sync_pending` menjadi `0`.

Urutan contoh: hentikan proses Transkrip dengan Ctrl+C; jalankan lagi `npm run start:transkrip` pada terminal yang menggunakan `DATABASE_PATH` salinan yang sama; jalankan kembali perintah finalisasi. Jangan mengganti salinan di tengah skenario. Verifikasi status tersimpan dengan membaca kelas melalui `GET /kelas/<KELAS_ID>` jika status tersedia pada respons baca, dan pastikan transkrip lewat Gateway memuat baris yang disinkronkan.

## Hasil integrasi live yang sudah dilaporkan (bukan hasil menjalankan contoh di atas)

Pada pengujian live terdahulu, runner aplikasi menggunakan jam internal 10.00 WIB melalui dependency injection (bukan header HTTP), dengan akun dosen dan device yang terdaftar pada fixture; pengujian menggunakan database terisolasi, bukan `data/database.sqlite`.

| Skenario aktual | Bukti yang dilaporkan |
|---|---|
| Login dosen dan baca nilai melalui Gateway | HTTP `200` untuk keduanya |
| Ubah nilai saat kelas DRAFT | HTTP `200` |
| Downstream Transkrip dihentikan, finalisasi | HTTP `502`; database menunjukkan `status=FINAL`, `sync_pending=1` |
| Retry setelah Transkrip dipulihkan | HTTP `200`; respons menyatakan `synced=3`; database menunjukkan `sync_pending=0` |
| Ubah nilai setelah finalisasi | HTTP `403` |
| Baca transkrip mahasiswa melalui Gateway | HTTP `200`; tersimpan 3 baris IF2101; IPK `3.85`, total `6` SKS untuk data fixture pada pengujian itu |
| Request langsung tanpa gateway secret | HTTP `403` |
| Token pengguna biasa ke endpoint sinkronisasi Gateway | HTTP `403` |
| Kelas berstatus `sync_pending=1` setelah seluruh retry | `0` kelas |

Angka dan status di tabel di atas adalah hasil pengujian terdahulu pada `data/stage5a-live-verified2.sqlite`; contoh perintah lainnya adalah panduan untuk pengujian ulang manual dan bukan klaim bahwa perintah tersebut baru saja dijalankan. `data/database.sqlite` tidak diubah. Tes otomatis terakhir yang dilaporkan: `npm test`, 62 lulus dan 0 gagal; tidak dijalankan ulang khusus untuk perubahan dokumentasi ini.
