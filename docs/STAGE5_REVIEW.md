# Tahap 5 — Review implementasi dan status verifikasi

Status: **kode dan tes otomatis Tahap 5 lulus; verifikasi operasional/live dan migrasi terhadap DB yang ada belum dilakukan**. Tidak ada perubahan atau reset terhadap file database proyek `data/database.sqlite`.

## Baseline dan tes

- Baseline sebelum Tahap 5: `npm test` lulus **51/51** (Tahap 2–4).
- Tes layanan baru `node --test tests/services.test.js`: **11/11 lulus**.
- Setelah implementasi/dokumentasi akhir: `npm test`: **62/62 lulus**, 0 gagal. Perintah migrasi `runMigrations` hanya dijalankan pada database `:memory:`; berhasil membuat kolom `kelas.sks` dan tabel `transkrip_v2`.
- Belum diverifikasi: migrasi pada DB yang sudah ada; ketiga proses live pada port 3000/3001/3002; uji cURL Windows CMD; rolling/backfill historis yang diperlukan untuk label legacy.
- Jangan gunakan perintah reset. `npm run db:init` menjalankan seed dan berpotensi mengubah baris seed; jangan jalankan pada DB pengguna tanpa persetujuan khusus.

## Perubahan dan asumsi yang perlu ditinjau

1. Service Nilai dan Service Transkrip memakai middleware JWT verifier bersama, memeriksa `X-Gateway-Secret`, lalu mengotorisasi ulang role dan kepemilikan dari SQLite. User token di kedua service kini juga diperiksa binding `X-Device-ID`.
2. Service Nilai memperoleh service token dari `POST /auth/service`, lalu mengirim `POST /transkrip/sinkron` ke URL Gateway; tidak memanggil port 3002 secara langsung.
3. Finalisasi menggunakan penanda `sync_pending`: source ditandai `FINAL` dan `sync_pending=1` sebelum sinkronisasi. Jika sinkronisasi gagal, kelas tetap FINAL tetapi immutable dan pending dapat dicoba lagi. Ini menghindari perubahan nilai di antara sinkronisasi dan finalisasi, tetapi pembaca dapat melihat nilai final sebelum sinkron selesai; client harus menganggap respons 502 sebagai “final, sinkronisasi pending”, bukan sebagai DRAFT.
4. Nilai angka dan huruf disimpan terpisah; tidak ada konversi otomatis/rentang nilai angka ke huruf.
5. Pemetaan mutu yang dipakai kalkulator: A=4.0, A-=3.7, B+=3.3, B=3.0, B-=2.7, C+=2.3, C=2.0, D+=1.7, D=1.3, D-=1.0, E=0.0. Label legacy `AB` dan `BC` tidak memiliki pemetaan; kalkulator menolak transkrip dengan label tak dikenal, bukan menebak poin.
6. Seed lama masih memuat AB/BC. Mengubah seed untuk memetakan label atau mengarang rentang angka-huruf dilarang. Skema lama memiliki CHECK constraint tetap untuk tabel nilai/transkrip; perubahan ke huruf plus/minus butuh strategi migrasi yang additive serta preservasi seluruh baris lama. Kandidat `transkrip_v2` dibuat untuk label baru, namun migrasi nilai/penanganan data historis perlu ditinjau dan dites sebelum dipakai.
7. Skema lama DB proyek terverifikasi belum mempunyai kolom `kelas.sks`; perubahan yang dibuat adalah migrasi additive dengan default 3. Pada pemeriksaan read-only sebelum migrasi, DB memiliki 6 user, 2 kelas, 6 nilai, 3 transkrip, dan 11 audit log. Tidak ada migrasi/seed dijalankan terhadap DB tersebut.
8. Definisi IPK perlu dipastikan sebagai IPK seluruh riwayat transkrip atau hanya data yang sudah tersinkron. Seed historis punya mata kuliah 3 SKS. Uji awal kelas IF2101 dan IF2102 masing-masing 3 SKS menghasilkan IPK 4.00 untuk data kelas itu saja; angka 3.50 sebelumnya diharapkan tes tidak sesuai dengan nilai fixture. Nilai IPK tidak boleh disetel agar lolos tanpa konfirmasi scope perhitungan.
9. Tes mengisolasi SQLite dengan `:memory:`; tidak memanggil reset atau menghapus data pada DB pengguna.

## Endpoint yang sudah ditulis (belum semua lolos verifikasi end-to-end)

- Nilai: `GET /nilai`, `GET /nilai/:id`, `GET /kelas`, `GET /kelas/:id`, `PUT /nilai/:id`, `POST /kelas/:id/finalisasi`.
- Transkrip: `GET /transkrip/:nim`, `POST /transkrip/sinkron`.
- Server entrypoint: `npm run start:nilai`, `npm run start:transkrip`.

Tes service yang ada mencakup direct access tanpa/secret salah, token invalid/expired, scoping nilai mahasiswa, daftar kelas dosen, penolakan perubahan kelas dosen lain, nilai sebelum/sesudah final, service-only sync, idempotensi, akses transkrip/IDOR/admin, mapping GPA dan label legacy, serta alur Gateway dan fail-pending retry. Pengujian live dan migrasi terhadap DB existing belum dijalankan; karena itu status milestone tetap tertunda.
