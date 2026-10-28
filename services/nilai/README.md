# Resource Service: Nilai (Port 3001)

Layanan ini mengelola entitas nilai dan kelas perkuliahan.

## Tanggung Jawab:
1. Menerapkan *defense-in-depth*: memvalidasi keberadaan header `X-Gateway-Secret` dan memverifikasi token JWT secara mandiri.
2. Menyediakan endpoint:
   - `GET /nilai`: Mengembalikan daftar nilai sesuai kewenangan role (Mahasiswa: nilai sendiri; Dosen: kelas ampuannya).
   - `PUT /nilai/:id`: Mengubah nilai (khusus Dosen pengampu, kelas belum `FINAL`, dan dalam jam kerja 07.00–21.00).
   - `POST /kelas/:id/finalisasi`: Mengunci status kelas menjadi `FINAL` dan memicu sinkronisasi ke Service Transkrip.
3. Melakukan panggilan *service-to-service* (S2S) ke Service Transkrip **wajib melalui Gateway PEP (port 3000)** dengan membawa Service Token.

*Catatan: Implementasi kode akan dikembangkan secara bertahap pada Tahap 5.*
