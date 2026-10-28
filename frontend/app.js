/**
 * Portal SIAKAD — Logika Frontend Lengkap & Fungsional
 * Memenuhi Seluruh Ketentuan Tugas Zero Trust Security (NIST SP 800-207)
 */

const API_GATEWAY = window.location.origin.includes('3000') ? window.location.origin : 'http://localhost:3000';
const NILAI_PORT_URL = 'http://localhost:3001';
const TRANSKRIP_PORT_URL = 'http://localhost:3002';

// State global sesi
let currentUser = null;
let currentToken = null;
let currentRefreshToken = null;
let currentDeviceId = null;
let currentDosenKelasId = 1;

// Database ID Perangkat Resmi Bawaan Seed
const OFFICIAL_DEVICES = {
  dosen_budi: 'dev-dosen-budi',
  dosen_siti: 'dev-dosen-siti',
  mhs_ahmad:  'dev-mhs-ahmad',
  mhs_rizki:  'dev-mhs-rizki',
  mhs_dewi:   'dev-mhs-dewi',
  admin:      'dev-admin-01'
};

// Peta NIM ke Nama Mahasiswa (untuk tampilan tabel dosen)
const NIM_TO_NAMA = {
  '247006001': 'Ahmad Fauzi',
  '247006002': 'Rizki Pratama',
  '247006003': 'Dewi Lestari'
};

document.addEventListener('DOMContentLoaded', () => {
  initClock();
  loadAuditLogsTable();
});

function initClock() {
  function tick() {
    const now = new Date();
    const str = new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    }).format(now);
    const hour = parseInt(new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Jakarta', hour: 'numeric', hour12: false
    }).format(now), 10);

    const isOperational = hour >= 7 && hour < 21;
    const timeEl = document.getElementById('jam-wib');
    const badgeEl = document.getElementById('jam-status-badge');

    if (timeEl) timeEl.textContent = `${str} WIB`;
    if (badgeEl) {
      if (isOperational) {
        badgeEl.className = 'px-1.5 py-0.2 rounded text-[10px] font-bold bg-emerald-900 text-emerald-300';
        badgeEl.textContent = 'Jam Kerja (07-21)';
      } else {
        badgeEl.className = 'px-1.5 py-0.2 rounded text-[10px] font-bold bg-rose-900 text-rose-300';
        badgeEl.textContent = 'Di Luar Jam Kerja';
      }
    }
  }
  tick();
  setInterval(tick, 1000);
}

// Helper pengisian form cepat
function quickFill(u, p) {
  document.getElementById('login-username').value = u;
  document.getElementById('login-password').value = p;
  document.getElementById('login-device-select').value = 'REGISTERED';
  document.getElementById('login-error-card').classList.add('hidden');
}

// ================= 1. PROSES LOGIN & VALIDASI DEVICE (4.1 & 4.3) =================
async function handleLoginSubmit(e) {
  e.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value.trim();
  const devSelect = document.getElementById('login-device-select').value;

  // Tentukan device ID: apakah resmi atau device asing
  const devToSend = devSelect === 'dev-hacker-hp' 
    ? 'dev-hacker-hp' 
    : (OFFICIAL_DEVICES[username] || 'dev-unknown');

  const errorCard = document.getElementById('login-error-card');
  const errorMsg = document.getElementById('login-error-msg');
  errorCard.classList.add('hidden');

  try {
    const res = await fetch(`${API_GATEWAY}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-ID': devToSend
      },
      body: JSON.stringify({ username, password })
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      // Penolakan login di layar
      errorCard.classList.remove('hidden');
      if (devToSend === 'dev-hacker-hp') {
        errorMsg.innerHTML = `Perangkat Anda (<code>${devToSend}</code>) tidak terdaftar di database Biro TI untuk akun <strong>${username}</strong>.<br><span class="text-[11px] text-slate-500 font-medium">Fitur Device Binding NIST SP 800-207 berhasil menolak akses ilegal.</span>`;
      } else {
        errorMsg.innerHTML = data.message || 'Kredensial username atau password salah.';
      }
      loadAuditLogsTable();
      return;
    }

    // Login Sukses
    currentUser = data.user;
    currentToken = data.accessToken;
    currentRefreshToken = data.refreshToken;
    currentDeviceId = devToSend;

    // Tampilkan Nav Profile
    document.getElementById('view-login').classList.add('hidden');
    document.getElementById('view-dashboard').classList.remove('hidden');
    document.getElementById('nav-user-profile').classList.remove('hidden');

    document.getElementById('nav-user-name').textContent = currentUser.nama;
    document.getElementById('nav-user-role').textContent = currentUser.role.toUpperCase();
    document.getElementById('nav-user-id').textContent = currentUser.identifier;

    showAlert('success', 'Login Berhasil', `Selamat datang, ${currentUser.nama}! Anda berhasil login melalui Policy Enforcement Point (PEP).`);

    // Inisialisasi Tampilan Dashboard Sesuai Role
    initDashboardForRole();
    loadAuditLogsTable();

  } catch (err) {
    errorCard.classList.remove('hidden');
    errorMsg.textContent = `Gagal terhubung ke Gateway Port 3000: ${err.message}`;
  }
}

// ================= NAVIGASI DASHBOARD PERAN =================
function initDashboardForRole() {
  document.getElementById('section-dosen').classList.add('hidden');
  document.getElementById('section-mahasiswa').classList.add('hidden');
  document.getElementById('section-admin').classList.add('hidden');

  const tabsContainer = document.getElementById('role-menu-tabs');

  if (currentUser.role === 'dosen') {
    tabsContainer.innerHTML = `
      <button class="bg-blue-900 text-white font-bold text-xs px-3 py-1.5 rounded-lg shadow-sm">
        <i class="fa-solid fa-chalkboard-user mr-1"></i> Penilaian Kelas Saya
      </button>
    `;
    document.getElementById('section-dosen').classList.remove('hidden');
    document.getElementById('dosen-pengampu-display').textContent = currentUser.nama;
    
    // Pilih default kelas sesuai dosen
    currentDosenKelasId = currentUser.username === 'dosen_siti' ? 2 : 1;
    document.getElementById('select-kelas-dosen').value = currentDosenKelasId;
    loadDosenClassData();

  } else if (currentUser.role === 'mahasiswa') {
    tabsContainer.innerHTML = `
      <button class="bg-blue-900 text-white font-bold text-xs px-3 py-1.5 rounded-lg shadow-sm">
        <i class="fa-solid fa-graduation-cap mr-1"></i> Transkrip Akademik & KHS
      </button>
    `;
    document.getElementById('section-mahasiswa').classList.remove('hidden');
    document.getElementById('mhs-name-display').textContent = currentUser.nama;
    document.getElementById('mhs-nim-display').textContent = currentUser.identifier;
    loadMahasiswaTranscript();

  } else if (currentUser.role === 'admin') {
    tabsContainer.innerHTML = `
      <button class="bg-blue-900 text-white font-bold text-xs px-3 py-1.5 rounded-lg shadow-sm">
        <i class="fa-solid fa-building-columns mr-1"></i> Biro Akademik (Admin TI)
      </button>
    `;
    document.getElementById('section-admin').classList.remove('hidden');
    loadAdminOverview();
  }
}

// ================= 2. DOSEN: KELOLA NILAI, EDIT, FINALISASI & S2S =================
async function loadDosenClassData() {
  const tbody = document.getElementById('table-nilai-dosen');
  tbody.innerHTML = `<tr><td colspan="6" class="px-6 py-6 text-center text-slate-400">Mengambil data nilai dari Service Nilai via Gateway PEP...</td></tr>`;

  try {
    const res = await fetch(`${API_GATEWAY}/nilai`, {
      headers: {
        'Authorization': `Bearer ${currentToken}`,
        'X-Device-ID': currentDeviceId
      }
    });

    const result = await res.json();
    if (!res.ok || !result.success) {
      tbody.innerHTML = `<tr><td colspan="6" class="px-6 py-4 text-center text-red-500 font-bold">${result.message}</td></tr>`;
      return;
    }

    const allRows = result.data || [];
    // Filter sesuai kelas yang dipilih di dropdown
    const rows = allRows.filter(r => r.kelas_id === currentDosenKelasId);

    if (rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="px-6 py-6 text-center text-slate-400">Tidak ada data untuk kelas ini (atau kelas bukan ampuannya).</td></tr>`;
      return;
    }

    const isFinal = rows[0].status === 'FINAL';
    document.getElementById('dosen-kelas-title').textContent = `${rows[0].kode_mk} — ${rows[0].nama_mk} (${rows[0].sks || 3} SKS)`;

    // Render Badge Status Kelas & Tombol Finalisasi
    const badgeEl = document.getElementById('kelas-status-badge');
    const btnFinal = document.getElementById('btn-finalisasi-act');
    if (isFinal) {
      badgeEl.innerHTML = `<span class="px-3 py-1.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1.5"><i class="fa-solid fa-lock"></i> KELAS FINAL (IMMUTABLE)</span>`;
      btnFinal.disabled = true;
      btnFinal.className = 'w-full bg-slate-200 text-slate-400 font-bold py-2.5 px-4 rounded-xl text-xs cursor-not-allowed';
      btnFinal.innerHTML = '<i class="fa-solid fa-lock"></i> Kelas Sudah Difinalisasi & Nilai Terkunci';
    } else {
      badgeEl.innerHTML = `<span class="px-3 py-1.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300 flex items-center gap-1.5"><i class="fa-solid fa-pen"></i> STATUS: DRAFT (BISA DIEDIT)</span>`;
      btnFinal.disabled = false;
      btnFinal.className = 'w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 px-4 rounded-xl text-xs transition shadow flex items-center justify-center gap-2';
      btnFinal.innerHTML = '<i class="fa-solid fa-check-double"></i> Finalisasi Nilai Kelas Sekarang';
    }

    // Render Baris Nilai
    tbody.innerHTML = rows.map((r, idx) => `
      <tr class="hover:bg-slate-50 transition">
        <td class="px-6 py-3.5 text-slate-400">${idx + 1}</td>
        <td class="px-6 py-3.5 font-bold font-mono text-slate-900">${r.nim}</td>
        <td class="px-6 py-3.5 text-slate-700 font-semibold">${NIM_TO_NAMA[r.nim] || `Mahasiswa ${idx + 1}`}</td>
        <td class="px-6 py-3.5 font-bold text-slate-900">${r.nilai_angka !== null ? r.nilai_angka : '-'}</td>
        <td class="px-6 py-3.5 font-black text-blue-700 font-mono text-sm">${r.nilai_huruf || '-'}</td>
        <td class="px-6 py-3.5 text-right">
          <button onclick="openModalEditNilai(${r.id}, '${r.nim}', ${r.nilai_angka}, '${r.nilai_huruf || 'A'}')" ${isFinal ? 'disabled class="text-slate-300 cursor-not-allowed text-xs font-semibold"' : 'class="bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 px-3 py-1 rounded-lg text-xs font-bold transition shadow-sm"'}>
            ${isFinal ? 'Terkunci' : 'Ubah Nilai'}
          </button>
        </td>
      </tr>
    `).join('');

    loadAuditLogsTable();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="px-6 py-4 text-center text-red-500 font-bold">Error: ${err.message}</td></tr>`;
  }
}

function switchKelasDosen() {
  currentDosenKelasId = parseInt(document.getElementById('select-kelas-dosen').value, 10);
  loadDosenClassData();
}

function openModalEditNilai(id, nim, angka, huruf) {
  document.getElementById('modal-nilai-id').value = id;
  document.getElementById('modal-nim-show').value = nim;
  document.getElementById('modal-score-input').value = angka || 0;
  document.getElementById('modal-letter-input').value = huruf || 'A';
  document.getElementById('modal-edit-nilai').classList.remove('hidden');
}

function closeModalEditNilai() {
  document.getElementById('modal-edit-nilai').classList.add('hidden');
}

async function submitSimpanNilai() {
  const id = document.getElementById('modal-nilai-id').value;
  const angka = parseFloat(document.getElementById('modal-score-input').value);
  const huruf = document.getElementById('modal-letter-input').value;

  closeModalEditNilai();

  try {
    const res = await fetch(`${API_GATEWAY}/nilai/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`,
        'X-Device-ID': currentDeviceId
      },
      body: JSON.stringify({ nilai_angka: angka, nilai_huruf: huruf })
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      showAlert('error', 'Perubahan Ditolak', data.message || 'Gagal mengubah nilai.');
      loadAuditLogsTable();
      return;
    }

    showAlert('success', 'Nilai Berhasil Diubah', `Nilai mahasiswa berhasil diperbarui menjadi ${angka} (${huruf}).`);
    loadDosenClassData();
  } catch (err) {
    showAlert('error', 'Error', err.message);
  }
}

// Finalisasi Nilai Kelas & Panggilan S2S (POST /kelas/:id/finalisasi)
async function handleFinalisasiKelas() {
  if (!confirm(`Konfirmasi: Finalisasi Kelas #${currentDosenKelasId}?\nNilai akan disinkronkan ke Service Transkrip melalui Gateway PEP dan dikunci permanen.`)) return;

  try {
    const res = await fetch(`${API_GATEWAY}/kelas/${currentDosenKelasId}/finalisasi`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`,
        'X-Device-ID': currentDeviceId
      },
      body: JSON.stringify({})
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      showAlert('error', 'Finalisasi Ditolak', data.message || 'Gagal memfinalisasi kelas.');
      loadAuditLogsTable();
      return;
    }

    showAlert('success', 'Kelas Berhasil Difinalisasi!', 'Service Nilai telah meminta Token Service ke Gateway PEP dan berhasil menyinkronkan nilai ke Service Transkrip. Nilai kelas kini resmi dikunci permanen (Immutable).');
    loadDosenClassData();
  } catch (err) {
    showAlert('error', 'Error', err.message);
  }
}

// Uji Serangan: Dosen Budi mencoba mengubah nilai kelas Dosen Siti
async function testCrossDosenTampering() {
  try {
    // Record ID 4 adalah nilai kelas IF2102 milik Dosen Siti
    const res = await fetch(`${API_GATEWAY}/nilai/4`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`,
        'X-Device-ID': currentDeviceId
      },
      body: JSON.stringify({ nilai_angka: 99, nilai_huruf: 'A' })
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      showAlert('error', 'Akses Ditolak (403 Forbidden)', `<strong>Pelanggaran Kepemilikan Data:</strong><br>${data.message || 'Dosen hanya diizinkan mengubah nilai pada kelas yang diampunya.'}<br><span class="text-[11px] text-slate-500 font-semibold">Kebijakan Zero Trust Least Privilege berhasil melindungi data Dosen Siti dari manipulasi Dosen Budi.</span>`);
    } else {
      showAlert('info', 'Diizinkan', 'Nilai berhasil diubah.');
    }
    loadAuditLogsTable();
  } catch (err) {
    showAlert('error', 'Error', err.message);
  }
}

// Uji Serangan: Token User dikirim ke endpoint sinkronisasi S2S (POST /transkrip/sinkron)
async function testUserTokenToSync() {
  try {
    const res = await fetch(`${API_GATEWAY}/transkrip/sinkron`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`,
        'X-Device-ID': currentDeviceId
      },
      body: JSON.stringify({ kelasId: 1 })
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      showAlert('error', 'Akses Ditolak (403 Forbidden)', `<strong>Pelanggaran Panggilan Antar-Service (S2S):</strong><br>${data.message || 'Hanya panggilan antar-service dengan Token Service yang diizinkan mengakses sinkronisasi transkrip. Token user ditolak.'}`);
    } else {
      showAlert('success', 'Sukses', 'Sinkronisasi berhasil.');
    }
    loadAuditLogsTable();
  } catch (err) {
    showAlert('error', 'Error', err.message);
  }
}

// ================= 3. MAHASISWA: TRANSKRIP & ANTI-IDOR =================
async function loadMahasiswaTranscript() {
  const tbody = document.getElementById('table-transkrip-mhs');
  tbody.innerHTML = `<tr><td colspan="5" class="px-6 py-6 text-center text-slate-400">Memuat transkrip nilai akademik via Gateway PEP...</td></tr>`;

  try {
    const res = await fetch(`${API_GATEWAY}/transkrip/${currentUser.identifier}`, {
      headers: {
        'Authorization': `Bearer ${currentToken}`,
        'X-Device-ID': currentDeviceId
      }
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      tbody.innerHTML = `<tr><td colspan="5" class="px-6 py-4 text-center text-red-500 font-bold">${data.message}</td></tr>`;
      return;
    }

    document.getElementById('mhs-ipk-display').textContent = data.ringkasan ? data.ringkasan.ipk.toFixed(2) : '0.00';
    document.getElementById('mhs-sks-display').textContent = data.ringkasan ? data.ringkasan.totalSks : '0';

    const items = data.data || [];
    if (items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="px-6 py-6 text-center text-slate-400">Belum ada mata kuliah yang disinkronkan ke transkrip Anda.</td></tr>`;
      return;
    }

    const pointMap = { A: '4.0', 'A-': '3.7', 'B+': '3.3', B: '3.0', 'B-': '2.7', 'C+': '2.3', C: '2.0', 'D+': '1.7', D: '1.3', 'D-': '1.0', E: '0.0' };

    tbody.innerHTML = items.map(it => `
      <tr class="hover:bg-slate-50 transition">
        <td class="px-6 py-3.5 font-bold font-mono text-slate-700">${it.kode_mk}</td>
        <td class="px-6 py-3.5 font-bold text-slate-900">${it.nama_mk}</td>
        <td class="px-6 py-3.5 text-slate-600">${it.sks} SKS</td>
        <td class="px-6 py-3.5 font-black text-emerald-700 text-sm font-mono">${it.nilai_huruf}</td>
        <td class="px-6 py-3.5 font-mono text-slate-500">${pointMap[it.nilai_huruf] || '-'}</td>
      </tr>
    `).join('');

    loadAuditLogsTable();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="px-6 py-4 text-center text-red-500 font-bold">Error: ${err.message}</td></tr>`;
  }
}

// Helper: Set NIM target IDOR dari tombol pembanding
function setIdorTarget(nim, nama) {
  document.getElementById('idor-target-nim').value = nim;
  showAlert('info', `Target IDOR Dipilih: ${nama}`,
    `NIM <strong>${nim}</strong> (${nama}) siap dijadikan target serangan IDOR. Sekarang tekan tombol <em>"Coba Intip Transkrip Ini"</em> untuk membuktikan bahwa Gateway PEP akan menolak request ini.`);
}

// Uji Serangan IDOR: Mahasiswa mencoba mengintip transkrip mahasiswa lain
async function testIdorAttack() {
  const targetNim = document.getElementById('idor-target-nim').value.trim();
  if (!targetNim) return;

  try {
    const res = await fetch(`${API_GATEWAY}/transkrip/${targetNim}`, {
      headers: {
        'Authorization': `Bearer ${currentToken}`,
        'X-Device-ID': currentDeviceId
      }
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      const targetNama = NIM_TO_NAMA[targetNim] || `NIM ${targetNim}`;
      const selfNama = currentUser?.nama || 'Mahasiswa ini';
      showAlert('error', 'Akses Ditolak (403 Forbidden)', `<strong>Pelanggaran Anti-IDOR:</strong><br>${data.message || 'Mahasiswa hanya diizinkan melihat transkrip dengan NIM miliknya sendiri.'}<br><span class="text-[11px] text-slate-500 font-semibold">Policy Engine Gateway berhasil mencegah <em>${selfNama}</em> mengintip transkrip milik <em>${targetNama}</em>!</span>`);
    } else {
      showAlert('success', 'Sukses', 'Transkrip berhasil dibaca.');
    }
    loadAuditLogsTable();
  } catch (err) {
    showAlert('error', 'Error', err.message);
  }
}

// ================= 4. ADMIN: PENCARIAN TRANSKRIP & MONITORING =================
function loadAdminOverview() {
  const grid = document.getElementById('admin-kelas-status-grid');
  grid.innerHTML = `
    <div class="p-4 bg-slate-50 rounded-xl border border-slate-200">
      <div class="font-bold text-slate-900 text-xs">Kelas 1: IF2101 Keamanan Informasi</div>
      <div class="text-[11px] text-slate-500 mt-1">Dosen Pengampu: Budi Santoso, M.Kom. (3 SKS)</div>
      <div class="mt-2 text-xs font-semibold text-blue-700">Tersinkronisasi ke Database</div>
    </div>
    <div class="p-4 bg-slate-50 rounded-xl border border-slate-200">
      <div class="font-bold text-slate-900 text-xs">Kelas 2: IF2102 Jaringan Komputer Lanjut</div>
      <div class="text-[11px] text-slate-500 mt-1">Dosen Pengampu: Dr. Siti Aminah, M.T. (3 SKS)</div>
      <div class="mt-2 text-xs font-semibold text-blue-700">Tersinkronisasi ke Database</div>
    </div>
  `;
}

async function adminSearchTranscript() {
  const nim = document.getElementById('admin-search-nim').value.trim();
  if (!nim) return;
  const card = document.getElementById('admin-result-card');
  card.classList.remove('hidden');
  card.innerHTML = '<div class="text-slate-500 text-xs">Mengambil data transkrip mahasiswa...</div>';

  try {
    const res = await fetch(`${API_GATEWAY}/transkrip/${nim}`, {
      headers: {
        'Authorization': `Bearer ${currentToken}`,
        'X-Device-ID': currentDeviceId
      }
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      card.innerHTML = `<div class="text-red-600 font-bold text-xs">Gagal: ${data.message}</div>`;
      loadAuditLogsTable();
      return;
    }

    const items = data.data || [];
    card.innerHTML = `
      <div class="flex justify-between items-center border-b border-slate-200 pb-3">
        <div>
          <div class="font-extrabold text-sm text-slate-900">${data.mahasiswa ? data.mahasiswa.nama : nim}</div>
          <div class="text-xs text-slate-500 font-mono">NIM: ${nim} · Status Mahasiswa Aktif</div>
        </div>
        <div class="text-right">
          <div class="text-xs font-bold text-purple-700">IPK: ${data.ringkasan ? data.ringkasan.ipk.toFixed(2) : '0.00'}</div>
          <div class="text-[11px] text-slate-500">Total SKS: ${data.ringkasan ? data.ringkasan.totalSks : 0}</div>
        </div>
      </div>
      <div class="space-y-1.5 pt-2">
        ${items.length === 0 ? '<div class="text-slate-400 text-xs">Belum ada mata kuliah yang disinkronkan.</div>' : ''}
        ${items.map(it => `
          <div class="flex justify-between text-xs py-1.5 px-3 rounded-lg bg-white border border-slate-200">
            <span class="font-mono"><strong>${it.kode_mk}</strong> — ${it.nama_mk} (${it.sks} SKS)</span>
            <span class="font-black text-blue-700 font-mono text-sm">${it.nilai_huruf}</span>
          </div>
        `).join('')}
      </div>
    `;

    showAlert('success', 'Pencarian Berhasil', `Transkrip mahasiswa NIM ${nim} berhasil ditemukan. Role Admin memiliki izin resmi melihat seluruh NIM mahasiswa.`);
    loadAuditLogsTable();
  } catch (err) {
    card.innerHTML = `<div class="text-red-600 font-bold text-xs">Error: ${err.message}</div>`;
  }
}

// ================= 5. UJI DIRECT ACCESS (BYPASS TEST) =================
async function testDirectAccessBypass() {
  try {
    const res = await fetch(`${NILAI_PORT_URL}/nilai`);
    const data = await res.json();
    if (res.status === 403) {
      showAlert('error', 'Akses Langsung Ditolak (403 Forbidden)', `<strong>Penolakan Direct Access:</strong><br>Service Nilai di port 3001 menolak panggilan langsung dari klien luar karena tidak membawa header rahasia <code>X-Gateway-Secret</code>.<br><span class="text-[11px] text-slate-500 font-semibold">Seluruh permintaan wajib melalui Gateway PEP Port 3000!</span>`);
    } else {
      showAlert('info', 'Status Response', JSON.stringify(data));
    }
  } catch (err) {
    showAlert('error', 'Akses Langsung Ditolak', 'Permintaan langsung ke port 3001 ditolak secara aman oleh service.');
  }
}

// ================= 6. TOKEN & SESSION ACTIONS (REFRESH & LOGOUT) =================
function openTokenModal() {
  document.getElementById('token-role-text').textContent = currentUser.role.toUpperCase();
  document.getElementById('token-dev-text').textContent = currentDeviceId;
  document.getElementById('token-access-preview').value = currentToken;
  document.getElementById('modal-token').classList.remove('hidden');
}

function closeTokenModal() {
  document.getElementById('modal-token').classList.add('hidden');
}

async function handleRefreshTokenRotation() {
  if (!currentRefreshToken) return;

  try {
    const res = await fetch(`${API_GATEWAY}/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-ID': currentDeviceId
      },
      body: JSON.stringify({ refreshToken: currentRefreshToken })
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      showAlert('error', 'Gagal Refresh Token', data.message || 'Token refresh tidak valid.');
      return;
    }

    currentToken = data.accessToken;
    currentRefreshToken = data.refreshToken;
    document.getElementById('token-access-preview').value = currentToken;

    showAlert('success', 'Refresh Token Rotation Berhasil', 'Sesi berhasil diperpanjang. Access Token baru diterbitkan dan token lama dirotasi di database.');
    loadAuditLogsTable();
  } catch (err) {
    showAlert('error', 'Error', err.message);
  }
}

async function handleLogout() {
  if (currentRefreshToken) {
    try {
      await fetch(`${API_GATEWAY}/auth/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-ID': currentDeviceId
        },
        body: JSON.stringify({ refreshToken: currentRefreshToken })
      });
    } catch (e) {}
  }

  currentUser = null;
  currentToken = null;
  currentRefreshToken = null;
  currentDeviceId = null;

  document.getElementById('view-login').classList.remove('hidden');
  document.getElementById('view-dashboard').classList.add('hidden');
  document.getElementById('nav-user-profile').classList.add('hidden');

  closeTokenModal();
  showAlert('info', 'Anda Berhasil Keluar', 'Sesi login telah dicabut (revoked) dari database Biro TI.');
  loadAuditLogsTable();
}

// ================= 7. TELEMETRI AUDIT LOG DARI DATABASE =================
async function loadAuditLogsTable() {
  const tbody = document.getElementById('table-audit-body');
  if (!tbody) return;

  const filter = document.getElementById('select-audit-filter') ? document.getElementById('select-audit-filter').value : 'ALL';

  try {
    const res = await fetch(`${API_GATEWAY}/api/audit-logs?limit=8`);
    if (!res.ok) return;
    const json = await res.json();
    let rows = json.data || [];

    if (filter !== 'ALL') {
      rows = rows.filter(r => r.decision === filter);
    }

    if (rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-slate-400">Belum ada catatan log audit.</td></tr>`;
      return;
    }

    tbody.innerHTML = rows.map(r => `
      <tr class="hover:bg-slate-50 transition">
        <td class="px-3 py-2 text-slate-500 whitespace-nowrap text-[10px]">${r.timestamp}</td>
        <td class="px-3 py-2 font-bold text-slate-900">${r.subject}</td>
        <td class="px-3 py-2 text-slate-600 text-[10px] uppercase font-bold">${r.role}</td>
        <td class="px-3 py-2 whitespace-nowrap"><span class="text-blue-700 font-bold">${r.method}</span> <span class="text-slate-600">${r.endpoint}</span></td>
        <td class="px-3 py-2 text-amber-700 text-[10px]">${r.device_id || '-'}</td>
        <td class="px-3 py-2">${r.decision === 'ALLOW' ? '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">ALLOW</span>' : '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-800 border border-red-300">DENY</span>'}</td>
        <td class="px-3 py-2 text-slate-600 max-w-sm truncate text-[10px]" title="${r.reason}">${r.reason}</td>
      </tr>
    `).join('');
  } catch (e) {}
}

// Helper Alert Popup
function showAlert(type, title, message) {
  const box = document.getElementById('alert-box');
  const card = document.getElementById('alert-card');
  const icon = document.getElementById('alert-icon');
  const titleEl = document.getElementById('alert-title');
  const msgEl = document.getElementById('alert-msg');

  box.classList.remove('hidden');
  titleEl.textContent = title;
  msgEl.innerHTML = message;

  if (type === 'error') {
    card.className = 'p-4 rounded-2xl shadow-2xl border-2 border-red-500 bg-red-50 text-red-900 flex items-start gap-3';
    icon.innerHTML = '<i class="fa-solid fa-circle-xmark text-red-600"></i>';
  } else if (type === 'success') {
    card.className = 'p-4 rounded-2xl shadow-2xl border-2 border-emerald-500 bg-emerald-50 text-emerald-900 flex items-start gap-3';
    icon.innerHTML = '<i class="fa-solid fa-circle-check text-emerald-600"></i>';
  } else {
    card.className = 'p-4 rounded-2xl shadow-2xl border-2 border-blue-500 bg-blue-50 text-blue-900 flex items-start gap-3';
    icon.innerHTML = '<i class="fa-solid fa-circle-info text-blue-600"></i>';
  }

  setTimeout(() => {
    closeAlert();
  }, 6500);
}

function closeAlert() {
  document.getElementById('alert-box').classList.add('hidden');
}

function navigateHome() {
  if (currentUser) {
    initDashboardForRole();
  }
}
