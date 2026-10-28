# Automated Security & Integration Tests

Folder ini diperuntukkan bagi pengujian otomatis untuk memvalidasi postur keamanan Zero Trust.

## Lingkup Pengujian:
1. `tests/unit/`:
   - Evaluator Policy Engine (`policy.test.js`).
   - Logika verifikasi token JWT & rotasi refresh token.
2. `tests/integration/`:
   - Skenario pengujian ujung-ke-ujung (*end-to-end*) mencakup 16 kasus uji keamanan:
     - Autentikasi & device binding.
     - Horizontal privilege escalation (IDOR Mahasiswa).
     - Vertical privilege escalation (Mahasiswa memanggil route Dosen/Admin).
     - Pembatasan kepemilikan kelas dosen (*Dosen A vs Dosen B*).
     - Pembatasan temporal jam akses (07.00–21.00 WIB via mock header).
     - Immutability record kelas `FINAL`.
     - Direct access bypass protection (`X-Gateway-Secret`).
     - Defense-in-depth token validation di level resource service.
     - Penolakan user token pada endpoint sinkronisasi S2S.
     - Integritas data audit log.

*Catatan: Test suite akan dibangun dan dijalankan pada Tahap 6.*
