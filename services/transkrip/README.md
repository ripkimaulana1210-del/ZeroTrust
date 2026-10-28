# Resource Service: Transkrip (Port 3002)

Layanan ini mengelola transkrip akademik mahasiswa.

## Tanggung Jawab:
1. Menerapkan *defense-in-depth*: menolak request langsung tanpa `X-Gateway-Secret` dan memverifikasi token JWT secara mandiri.
2. Menyediakan endpoint:
   - `GET /transkrip/:nim`: Mengembalikan transkrip akademik (Mahasiswa: hanya NIM miliknya; Admin: seluruh NIM).
   - `POST /transkrip/sinkron`: Menerima pembaruan transkrip saat kelas difinalisasi.
3. Menegakkan kontrol ketat pada `POST /transkrip/sinkron`: **hanya** menerima token dengan `role: "service"`. Seluruh token user (`mahasiswa`, `dosen`, `admin`) wajib ditolak (403).

*Catatan: Implementasi kode akan dikembangkan secara bertahap pada Tahap 5.*
