require('dotenv').config();

const ACCESS_START_HOUR = parseInt(process.env.ACCESS_START_HOUR || '7', 10);
const ACCESS_END_HOUR = parseInt(process.env.ACCESS_END_HOUR || '21', 10);

/**
 * Mengecek apakah jam berada dalam rentang jam operasional (07.00 - 21.00 WIB).
 * @param {number} hour
 * @param {number} [start]
 * @param {number} [end]
 * @returns {boolean}
 */
function isWithinOperationalHours(hour, start = ACCESS_START_HOUR, end = ACCESS_END_HOUR) {
  return hour >= start && hour < end;
}

/**
 * Mendapatkan jam saat ini dalam zona waktu Asia/Jakarta (WIB).
 * @returns {number}
 */
function getCurrentJakartaHour() {
  const hourStr = new Date().toLocaleString('en-US', {
    timeZone: 'Asia/Jakarta',
    hour: 'numeric',
    hour12: false
  });
  return parseInt(hourStr, 10);
}

/**
 * Policy Engine (PE) — Mengevaluasi konteks akses berdasarkan atribut, role,
 * device binding, kepemilikan data, status kelas, dan jam kerja sesuai NIST SP 800-207.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{
 *   subject?: { sub: any, username?: string, role: string, identifier?: string, type?: string },
 *   action: string,
 *   resource: string,
 *   context?: {
 *     deviceId?: string,
 *     params?: Record<string, string>,
 *     body?: any,
 *     currentHour?: number
 *   }
 * }} input
 * @returns {{ decision: 'ALLOW' | 'DENY', reason: string, meta?: object }}
 */
function evaluatePolicy(db, { subject, action, resource, context = {} }) {
  const method = (action || '').toUpperCase();
  const endpoint = resource || '';
  const deviceId = context.deviceId;
  const params = context.params || {};

  // 1. Verifikasi Autentikasi Subjek
  if (!subject || !subject.role || subject.role === 'anonymous') {
    return {
      decision: 'DENY',
      reason: 'Token autentikasi tidak ada atau tidak valid'
    };
  }

  // 2. Evaluasi Endpoint Khusus Service-to-Service: POST /transkrip/sinkron
  if (endpoint === '/transkrip/sinkron' && method === 'POST') {
    if (subject.role === 'service' && subject.type === 'service') {
      return {
        decision: 'ALLOW',
        reason: 'Sinkronisasi transkrip antar-service diizinkan menggunakan Token Service'
      };
    }
    return {
      decision: 'DENY',
      reason: 'Hanya panggilan antar-service dengan Token Service yang diizinkan mengakses sinkronisasi transkrip. Token user ditolak'
    };
  }

  // Jika token bertipe 'service' mencoba mengakses endpoint user lain, tolak
  if (subject.role === 'service' || subject.type === 'service') {
    return {
      decision: 'DENY',
      reason: 'Token Service tidak diizinkan mengakses endpoint pengguna'
    };
  }

  // 3. Verifikasi Konteks Perangkat (Device Binding) untuk Semua Token Pengguna
  if (!deviceId) {
    return {
      decision: 'DENY',
      reason: 'Header X-Device-ID wajib disertakan untuk mengakses resource'
    };
  }

  const boundDevice = db.prepare(`
    SELECT id, is_active FROM devices
    WHERE user_id = ? AND device_id = ? AND is_active = 1;
  `).get(subject.sub, deviceId);

  if (!boundDevice) {
    return {
      decision: 'DENY',
      reason: 'Perangkat tidak terdaftar atau tidak aktif untuk pengguna ini'
    };
  }

  // Evaluasi jam akses untuk operasi yang memerlukan batas waktu (07.00 - 21.00 WIB)
  const hour = (context.currentHour !== undefined && context.currentHour !== null)
    ? Number(context.currentHour)
    : getCurrentJakartaHour();

  // 4. Evaluasi Kebijakan Berdasarkan Matriks Endpoint (Tabel 3 PDF)

  // A. GET /nilai
  if (endpoint === '/nilai' && method === 'GET') {
    if (subject.role === 'mahasiswa') {
      return {
        decision: 'ALLOW',
        reason: 'Akses nilai diizinkan (Mahasiswa dibatasi hanya melihat nilai miliknya sendiri)',
        meta: { filter: 'mahasiswa', mahasiswa_id: subject.sub }
      };
    }

    if (subject.role === 'dosen') {
      return {
        decision: 'ALLOW',
        reason: 'Akses nilai diizinkan (Dosen dibatasi hanya melihat kelas yang diampunya)',
        meta: { filter: 'dosen', dosen_id: subject.sub }
      };
    }

    return {
      decision: 'DENY',
      reason: `Role '${subject.role}' tidak memiliki hak akses melihat data nilai`
    };
  }

  // B. PUT /nilai/:id
  if ((endpoint === '/nilai/:id' || endpoint.startsWith('/nilai/')) && method === 'PUT') {
    if (subject.role !== 'dosen') {
      return {
        decision: 'DENY',
        reason: 'Hanya dosen yang diizinkan untuk mengubah nilai mahasiswa'
      };
    }

    // Pengecekan Batas Waktu Operasional (Jam Akses)
    if (!isWithinOperationalHours(hour)) {
      return {
        decision: 'DENY',
        reason: `Perubahan nilai hanya diizinkan pada jam akses ${ACCESS_START_HOUR}.00–${ACCESS_END_HOUR}.00 WIB`
      };
    }

    // Ekstrak ID nilai dari params atau URL
    const nilaiId = params.id || endpoint.split('/')[2];
    if (!nilaiId) {
      return {
        decision: 'DENY',
        reason: 'ID nilai tidak valid'
      };
    }

    // Cek kepemilikan kelas oleh dosen dan status kelas
    const nilaiRow = db.prepare(`
      SELECT n.id, n.kelas_id, k.dosen_id, k.status
      FROM nilai n
      JOIN kelas k ON n.kelas_id = k.id
      WHERE n.id = ?;
    `).get(nilaiId);

    if (!nilaiRow) {
      return {
        decision: 'DENY',
        reason: 'Data nilai tidak ditemukan'
      };
    }

    if (nilaiRow.dosen_id !== subject.sub) {
      return {
        decision: 'DENY',
        reason: 'Dosen hanya diizinkan mengubah nilai pada kelas yang diampunya'
      };
    }

    if (nilaiRow.status === 'FINAL') {
      return {
        decision: 'DENY',
        reason: 'Nilai tidak dapat diubah karena kelas sudah berstatus FINAL'
      };
    }

    return {
      decision: 'ALLOW',
      reason: 'Perubahan nilai diizinkan'
    };
  }

  // C. POST /kelas/:id/finalisasi
  if (
    (endpoint === '/kelas/:id/finalisasi' || (endpoint.startsWith('/kelas/') && endpoint.endsWith('/finalisasi'))) &&
    method === 'POST'
  ) {
    if (subject.role !== 'dosen') {
      return {
        decision: 'DENY',
        reason: 'Hanya dosen yang diizinkan memfinalisasi kelas'
      };
    }

    // Pengecekan Batas Waktu Operasional (Jam Akses)
    if (!isWithinOperationalHours(hour)) {
      return {
        decision: 'DENY',
        reason: `Finalisasi kelas hanya diizinkan pada jam akses ${ACCESS_START_HOUR}.00–${ACCESS_END_HOUR}.00 WIB`
      };
    }

    const kelasId = params.id || endpoint.split('/')[2];
    if (!kelasId) {
      return {
        decision: 'DENY',
        reason: 'ID kelas tidak valid'
      };
    }

    const kelasRow = db.prepare(`
      SELECT id, dosen_id, status, sync_pending FROM kelas WHERE id = ?;
    `).get(kelasId);

    if (!kelasRow) {
      return {
        decision: 'DENY',
        reason: 'Data kelas tidak ditemukan'
      };
    }

    if (kelasRow.dosen_id !== subject.sub) {
      return {
        decision: 'DENY',
        reason: 'Dosen hanya diizinkan memfinalisasi kelas yang diampunya'
      };
    }

    if (kelasRow.status === 'FINAL' && !kelasRow.sync_pending) {
      return {
        decision: 'DENY',
        reason: 'Kelas sudah berstatus FINAL dan tidak dapat difinalisasi ulang'
      };
    }

    return {
      decision: 'ALLOW',
      reason: 'Finalisasi kelas diizinkan'
    };
  }

  // D. GET /transkrip/:nim
  if ((endpoint === '/transkrip/:nim' || endpoint.startsWith('/transkrip/')) && method === 'GET') {
    const targetNim = params.nim || endpoint.split('/')[2];

    if (!targetNim) {
      return {
        decision: 'DENY',
        reason: 'NIM mahasiswa wajib disertakan pada path transkrip'
      };
    }

    if (subject.role === 'admin') {
      return {
        decision: 'ALLOW',
        reason: 'Admin diizinkan melihat transkrip seluruh mahasiswa'
      };
    }

    if (subject.role === 'mahasiswa') {
      if (subject.identifier === targetNim) {
        return {
          decision: 'ALLOW',
          reason: 'Mahasiswa diizinkan melihat transkrip miliknya sendiri'
        };
      }
      return {
        decision: 'DENY',
        reason: 'Mahasiswa hanya diizinkan melihat transkrip dengan NIM miliknya sendiri'
      };
    }

    return {
      decision: 'DENY',
      reason: `Role '${subject.role}' tidak memiliki izin melihat data transkrip`
    };
  }

  // Default DENY untuk endpoint yang tidak terdaftar
  return {
    decision: 'DENY',
    reason: `Akses ditolak: Endpoint '${method} ${endpoint}' tidak terdaftar dalam matriks kebijakan`
  };
}

module.exports = {
  ACCESS_START_HOUR,
  ACCESS_END_HOUR,
  isWithinOperationalHours,
  getCurrentJakartaHour,
  evaluatePolicy
};
