# API Gateway — Menjalankan dan Menguji

Gateway merupakan **Policy Enforcement Point (PEP)** pada `http://localhost:3000`. Semua endpoint resource melewati verifikasi JWT, evaluasi kebijakan, dan pencatatan audit sebelum diteruskan. Service Nilai berjalan pada port 3001 dan Service Transkrip pada port 3002. Pengujian Gateway HTTP mengisolasi downstream dengan mock; pengujian Tahap 5 menguji kedua service aplikasi lewat Gateway dengan port ephemeral.

Gateway memerlukan `JWT_SECRET`, `GATEWAY_SECRET`, `SERVICE_NILAI_CLIENT_ID`, dan `SERVICE_NILAI_CLIENT_SECRET` di `.env`. `JWT_SECRET` dan `GATEWAY_SECRET` wajib ada saat startup; tidak ada nilai rahasia fallback di source.

## Jalankan Gateway

Dari folder proyek:

```bash
npm install
npm run db:init
npm run start:gateway
```

Pastikan `.env` memiliki `JWT_SECRET`, `GATEWAY_SECRET`, `SERVICE_NILAI_CLIENT_ID`, dan `SERVICE_NILAI_CLIENT_SECRET`. Credential wajib diisi dan tidak boleh disimpan ke Git. Gunakan nilai acak lokal; jangan gunakan contoh placeholder sebagai secret deployment.

Cek health di terminal lain:

```cmd
curl.exe -i http://localhost:3000/health
```

Health hanya mengembalikan status layanan, nama komponen, role PEP dan timestamp; tidak menyertakan rahasia.

## Endpoint

| Method | Path | Fungsi |
|---|---|---|
| `GET` | `/health` | Health check tanpa kredensial |
| `POST` | `/auth/login` | Login user, perlu header `X-Device-ID` terdaftar |
| `POST` | `/auth/refresh` | Rotasi refresh token; body berisi `refreshToken` |
| `POST` | `/auth/logout` | Cabut refresh token; body berisi `refreshToken` |
| `POST` | `/auth/service` | Autentikasi Service Nilai; body berisi `clientId` dan `clientSecret` |
| `GET`, `PUT` | `/nilai`, `/nilai/:id` | Gateway memverifikasi policy lalu proxy ke port 3001 |
| `POST` | `/kelas/:id/finalisasi` | Gateway memverifikasi policy lalu proxy ke port 3001 |
| `GET` | `/transkrip/:nim` | Gateway memverifikasi policy lalu proxy ke port 3002 |
| `POST` | `/transkrip/sinkron` | Hanya service token; proxy ke port 3002 |

Setiap request resource user menyertakan `Authorization: Bearer <accessToken>` dan `X-Device-ID`. Service Token untuk sinkronisasi tidak menggunakan device user. Gateway membuang `X-Gateway-Secret` dari ingress client dan hanya memasang nilai yang dikonfigurasi pada proxy upstream. Token dan secret tidak ditulis ke log.

## Contoh cURL Windows CMD

Login (CMD menerima satu baris; gunakan `curl.exe`):

```cmd
curl.exe -i -X POST "http://localhost:3000/auth/login" -H "Content-Type: application/json" -H "X-Device-ID: dev-mhs-ahmad" -d "{\"username\":\"<USERNAME>\",\"password\":\"<PASSWORD>\"}"
```

Gunakan token yang diterima untuk menguji kebijakan. Ganti placeholder token di bawah dengan access token dari respons login:

```cmd
curl.exe -i "http://localhost:3000/nilai" -H "Authorization: Bearer <ACCESS_TOKEN>" -H "X-Device-ID: dev-mhs-ahmad"
```

Refresh dan logout:

```cmd
curl.exe -i -X POST "http://localhost:3000/auth/refresh" -H "Content-Type: application/json" -H "X-Device-ID: dev-mhs-ahmad" -d "{\"refreshToken\":\"<REFRESH_TOKEN>\"}"
```

```cmd
curl.exe -i -X POST "http://localhost:3000/auth/logout" -H "Content-Type: application/json" -d "{\"refreshToken\":\"<REFRESH_TOKEN>\"}"
```

Jangan memasukkan token atau secret ke screenshot, repositori, atau audit log.

## Menjalankan ketiga service (Windows CMD)

Pastikan konfigurasi `.env` tersedia. Setiap server menggunakan database bersama `data/database.sqlite`; server tidak menjalankan reset otomatis. Untuk database lama, migrasi skema bersifat additive, tetapi jangan jalankan `npm run db:init` tanpa memahami bahwa perintah tersebut juga menjalankan seed.

Buka tiga terminal CMD di folder proyek dan jalankan masing-masing:

```cmd
npm run start:gateway
```

```cmd
npm run start:nilai
```

```cmd
npm run start:transkrip
```

Login dan baca nilai lewat Gateway (token yang dikembalikan ditempelkan di placeholder; jangan tempel token ke dokumentasi):

```cmd
curl.exe -i -X POST "http://localhost:3000/auth/login" -H "Content-Type: application/json" -H "X-Device-ID: dev-mhs-ahmad" -d "{\"username\":\"<USERNAME>\",\"password\":\"<PASSWORD>\"}"
```

```cmd
curl.exe -i "http://localhost:3000/nilai" -H "Authorization: Bearer <ACCESS_TOKEN>" -H "X-Device-ID: dev-mhs-ahmad"
```

Dosen dapat mengubah nilai dengan angka dan huruf sebagai atribut terpisah (tanpa konversi otomatis):

```cmd
curl.exe -i -X PUT "http://localhost:3000/nilai/1" -H "Content-Type: application/json" -H "Authorization: Bearer <ACCESS_TOKEN_DOSEN>" -H "X-Device-ID: dev-dosen-budi" -d "{\"nilai_angka\":81,\"nilai_huruf\":\"A-\"}"
```

Finalisasi kelas diproses oleh Service Nilai dan sinkronisasi dipanggil melalui Gateway:

```cmd
curl.exe -i -X POST "http://localhost:3000/kelas/1/finalisasi" -H "Authorization: Bearer <ACCESS_TOKEN_DOSEN>" -H "X-Device-ID: dev-dosen-budi" -H "Content-Type: application/json" -d "{}"
```

## Uji Otomatis

```cmd
node --test tests/services.test.js
npm test
```

Tes layanan menggunakan HTTP sungguhan pada port ephemeral, aplikasi Gateway aktual, kedua aplikasi service, dan database SQLite `:memory:` terisolasi. Tes memeriksa secret/token, role/ownership, idempotensi dan alur sync/failure. Tes tidak menyentuh database proyek. Nilai mutu GPA: A=4.0, A-=3.7, B+=3.3, B=3.0, B-=2.7, C+=2.3, C=2.0, D+=1.7, D=1.3, D-=1.0, E=0.0. Label legacy `AB`/`BC` tidak memiliki mapping mutu dan penghitungan IPK akan menolak bila label tersebut masih berada di data transkrip.

Gateway integration tests juga menggunakan mock downstream; service tests terpisah menguji integrasi Gateway dengan dua resource service yang berjalan pada port ephemeral.
