const bcrypt = require('bcryptjs');
const {
  generateAccessToken,
  generateRefreshToken,
  generateServiceToken,
  hashToken
} = require('./tokens');

/**
 * Memproses autentikasi pengguna dan penerbitan token.
 * Menegakkan verifikasi kredensial serta keterikatan perangkat (Device Binding).
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{ username: string, password: string, deviceId: string }} params
 */
function login(db, { username, password, deviceId }) {
  if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password) {
    return {
      success: false,
      error: 'MISSING_CREDENTIALS',
      message: 'Username dan password wajib diisi'
    };
  }

  if (!deviceId) {
    return {
      success: false,
      error: 'MISSING_DEVICE_ID',
      message: 'Header X-Device-ID wajib disertakan untuk autentikasi'
    };
  }

  // 1. Cari pengguna berdasarkan username
  const user = db.prepare(`
    SELECT id, username, password_hash, role, identifier, nama
    FROM users
    WHERE username = ?;
  `).get(username);

  if (!user) {
    return {
      success: false,
      error: 'INVALID_CREDENTIALS',
      message: 'Kredensial login tidak valid'
    };
  }

  // 2. Verifikasi hash password
  const isPasswordValid = bcrypt.compareSync(password, user.password_hash);
  if (!isPasswordValid) {
    return {
      success: false,
      error: 'INVALID_CREDENTIALS',
      message: 'Kredensial login tidak valid'
    };
  }

  // 3. Verifikasi apakah perangkat terdaftar dan aktif untuk pengguna ini
  const device = db.prepare(`
    SELECT id, device_id, label, is_active
    FROM devices
    WHERE user_id = ? AND device_id = ? AND is_active = 1;
  `).get(user.id, deviceId);

  if (!device) {
    return {
      success: false,
      error: 'UNREGISTERED_DEVICE',
      message: 'Perangkat tidak terdaftar untuk pengguna ini'
    };
  }

  // 4. Terbitkan Access Token (10 menit)
  const accessToken = generateAccessToken(user);

  // 5. Terbitkan Refresh Token (1 hari) dan simpan hash-nya di database
  const { rawToken, jti, expiresAt } = generateRefreshToken();
  const tokenHash = hashToken(rawToken);

  db.prepare(`
    INSERT INTO refresh_tokens (user_id, token_hash, jti, expires_at, revoked)
    VALUES (?, ?, ?, ?, 0);
  `).run(user.id, tokenHash, jti, expiresAt.toISOString());

  return {
    success: true,
    accessToken,
    refreshToken: rawToken,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      identifier: user.identifier,
      nama: user.nama
    }
  };
}

/**
 * Melakukan perpanjangan Access Token dengan rotasi Refresh Token (Refresh Token Rotation).
 * Token lama langsung dicabut (revoked = 1) untuk mencegah replay attack.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{ refreshToken: string, deviceId?: string }} params
 */
function refresh(db, { refreshToken, deviceId }) {
  if (!refreshToken) {
    return {
      success: false,
      error: 'MISSING_REFRESH_TOKEN',
      message: 'Refresh token wajib disertakan'
    };
  }

  const tokenHash = hashToken(refreshToken);

  const tokenRow = db.prepare(`
    SELECT r.id, r.user_id, r.expires_at, r.revoked, u.username, u.role, u.identifier, u.nama
    FROM refresh_tokens r
    JOIN users u ON r.user_id = u.id
    WHERE r.token_hash = ?;
  `).get(tokenHash);

  if (!tokenRow) {
    return {
      success: false,
      error: 'TOKEN_NOT_FOUND',
      message: 'Refresh token tidak ditemukan atau tidak valid'
    };
  }

  // Periksa apakah token telah dicabut (misal karena logout atau reuse)
  if (tokenRow.revoked === 1) {
    return {
      success: false,
      error: 'TOKEN_REVOKED',
      message: 'Refresh token telah dicabut dan tidak dapat digunakan lagi'
    };
  }

  // Periksa masa berlaku refresh token
  if (new Date(tokenRow.expires_at) < new Date()) {
    return {
      success: false,
      error: 'TOKEN_EXPIRED',
      message: 'Refresh token telah kedaluwarsa'
    };
  }

  // Jika deviceId disertakan, pastikan device masih aktif untuk user tersebut
  if (deviceId) {
    const activeDevice = db.prepare(`
      SELECT id FROM devices WHERE user_id = ? AND device_id = ? AND is_active = 1;
    `).get(tokenRow.user_id, deviceId);

    if (!activeDevice) {
      return {
        success: false,
        error: 'UNREGISTERED_DEVICE',
        message: 'Perangkat tidak terdaftar untuk pengguna ini'
      };
    }
  }

  // Rotasi token dalam satu transaksi atomik
  const rotateTx = db.transaction(() => {
    // 1. Cabut token lama
    db.prepare(`
      UPDATE refresh_tokens SET revoked = 1 WHERE id = ?;
    `).run(tokenRow.id);

    // 2. Terbitkan token baru
    const newAccessToken = generateAccessToken({
      id: tokenRow.user_id,
      username: tokenRow.username,
      role: tokenRow.role,
      identifier: tokenRow.identifier
    });

    const { rawToken: newRawRefreshToken, jti, expiresAt } = generateRefreshToken();
    const newTokenHash = hashToken(newRawRefreshToken);

    db.prepare(`
      INSERT INTO refresh_tokens (user_id, token_hash, jti, expires_at, revoked)
      VALUES (?, ?, ?, ?, 0);
    `).run(tokenRow.user_id, newTokenHash, jti, expiresAt.toISOString());

    return {
      accessToken: newAccessToken,
      refreshToken: newRawRefreshToken
    };
  });

  const tokens = rotateTx();

  return {
    success: true,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken
  };
}

/**
 * Mencabut refresh token pengguna (Logout).
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{ refreshToken: string }} params
 */
function logout(db, { refreshToken }) {
  if (!refreshToken) {
    return {
      success: false,
      error: 'MISSING_REFRESH_TOKEN',
      message: 'Refresh token wajib disertakan'
    };
  }

  const tokenHash = hashToken(refreshToken);

  const result = db.prepare(`
    UPDATE refresh_tokens
    SET revoked = 1
    WHERE token_hash = ?;
  `).run(tokenHash);

  if (result.changes === 0) {
    return {
      success: false,
      error: 'TOKEN_NOT_FOUND',
      message: 'Sesi refresh token tidak ditemukan'
    };
  }

  return {
    success: true,
    message: 'Logout berhasil, sesi refresh token telah dicabut'
  };
}

/**
 * Autentikasi Service-to-Service untuk Service Nilai.
 * Memvalidasi Client ID dan Secret dari environment.
 *
 * @param {{ clientId: string, clientSecret: string }} params
 */
function authenticateService({ clientId, clientSecret }) {
  const expectedClientId = process.env.SERVICE_NILAI_CLIENT_ID || 'service-nilai';
  const expectedClientSecret = process.env.SERVICE_NILAI_CLIENT_SECRET;

  if (!expectedClientSecret) {
    return {
      success: false,
      error: 'SERVER_MISCONFIGURATION',
      message: 'SERVICE_NILAI_CLIENT_SECRET belum dikonfigurasi di environment'
    };
  }

  if (!clientId || !clientSecret) {
    return {
      success: false,
      error: 'MISSING_CREDENTIALS',
      message: 'Client ID dan Client Secret service wajib diisi'
    };
  }

  if (clientId !== expectedClientId || clientSecret !== expectedClientSecret) {
    return {
      success: false,
      error: 'INVALID_SERVICE_CREDENTIALS',
      message: 'Kredensial service tidak valid'
    };
  }

  const serviceToken = generateServiceToken(clientId);

  return {
    success: true,
    serviceToken
  };
}

module.exports = {
  login,
  refresh,
  logout,
  authenticateService
};
