const jwt = require('jsonwebtoken');
const crypto = require('crypto');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET;
const ACCESS_TOKEN_EXPIRY = '10m';      // 10 menit sesuai PDF
const SERVICE_TOKEN_EXPIRY = '5m';     // 5 menit sesuai PDF
const REFRESH_TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000; // 1 hari (24 jam) sesuai PDF

/**
 * Menghasilkan Access Token JWT untuk pengguna (10 menit).
 * @param {object} user - Data pengguna dari database
 * @param {string} [customExpiry] - Opsi durasi kustom (misal untuk testing expired token)
 * @returns {string} Signed JWT
 */
function generateAccessToken(user, customExpiry = ACCESS_TOKEN_EXPIRY) {
  const payload = {
    sub: user.id,
    username: user.username,
    role: user.role,
    identifier: user.identifier, // NIM untuk mahasiswa, NIP untuk dosen, kode admin
    type: 'user',
    jti: crypto.randomUUID()
  };

  const signOptions = { expiresIn: customExpiry };
  if (process.env.JWT_ISSUER) signOptions.issuer = process.env.JWT_ISSUER;
  if (process.env.JWT_AUDIENCE) signOptions.audience = process.env.JWT_AUDIENCE;
  return jwt.sign(payload, JWT_SECRET, signOptions);
}

/**
 * Menghasilkan Service Token JWT untuk panggilan antar-service (5 menit).
 * @param {string} clientId - ID client service (misal 'service-nilai')
 * @param {string} [customExpiry] - Opsi durasi kustom
 * @returns {string} Signed JWT
 */
function generateServiceToken(clientId, customExpiry = SERVICE_TOKEN_EXPIRY) {
  const payload = {
    sub: clientId,
    role: 'service',
    type: 'service',
    jti: crypto.randomUUID()
  };

  const signOptions = { expiresIn: customExpiry };
  if (process.env.JWT_ISSUER) signOptions.issuer = process.env.JWT_ISSUER;
  if (process.env.JWT_AUDIENCE) signOptions.audience = process.env.JWT_AUDIENCE;
  return jwt.sign(payload, JWT_SECRET, signOptions);
}

/**
 * Menghasilkan Refresh Token acak yang aman dan informasi masa berlakunya.
 * @returns {{ rawToken: string, jti: string, expiresAt: Date }}
 */
function generateRefreshToken() {
  const rawToken = crypto.randomBytes(40).toString('hex');
  const jti = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS);

  return {
    rawToken,
    jti,
    expiresAt
  };
}

/**
 * Melakukan hashing SHA-256 terhadap string token.
 * Token mentah tidak disimpan langsung di database untuk mematuhi prinsip Assume Breach.
 * @param {string} token
 * @returns {string} Hex string hasil hash
 */
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Memverifikasi validitas token JWT.
 * @param {string} token - String JWT Bearer
 * @param {string} [secret] - Kunci rahasia untuk verifikasi
 * @returns {{ valid: boolean, payload?: object, error?: string, message?: string }}
 */
function verifyToken(token, secret = JWT_SECRET) {
  if (!token) {
    return {
      valid: false,
      error: 'TOKEN_MISSING',
      message: 'Token tidak disertakan'
    };
  }

  try {
    if (!secret) {
      return {
        valid: false,
        error: 'SERVER_MISCONFIGURATION',
        message: 'JWT_SECRET belum dikonfigurasi'
      };
    }

    const verifyOptions = {};
    if (process.env.JWT_ISSUER) verifyOptions.issuer = process.env.JWT_ISSUER;
    if (process.env.JWT_AUDIENCE) verifyOptions.audience = process.env.JWT_AUDIENCE;
    const decoded = jwt.verify(token, secret, verifyOptions);

    const validUserRoles = ['admin', 'dosen', 'mahasiswa'];
    const validUser = decoded.type === 'user' &&
      Number.isInteger(decoded.sub) &&
      validUserRoles.includes(decoded.role) &&
      typeof decoded.jti === 'string' && decoded.jti.length > 0;
    const validService = decoded.type === 'service' &&
      decoded.role === 'service' &&
      typeof decoded.sub === 'string' && decoded.sub.length > 0 &&
      typeof decoded.jti === 'string' && decoded.jti.length > 0;

    if (!validUser && !validService) {
      return {
        valid: false,
        error: 'TOKEN_INVALID_CLAIMS',
        message: 'Claims token tidak lengkap atau tipe token tidak dikenali'
      };
    }

    return { valid: true, payload: decoded };
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return {
        valid: false,
        error: 'TOKEN_EXPIRED',
        message: 'Token telah kedaluwarsa'
      };
    }
    if (err.name === 'JsonWebTokenError') {
      return {
        valid: false,
        error: 'TOKEN_INVALID',
        message: 'Tanda tangan token tidak valid atau token rusak'
      };
    }
    return {
      valid: false,
      error: 'TOKEN_ERROR',
      message: err.message || 'Gagal memverifikasi token'
    };
  }
}

module.exports = {
  JWT_SECRET,
  ACCESS_TOKEN_EXPIRY,
  SERVICE_TOKEN_EXPIRY,
  REFRESH_TOKEN_EXPIRY_MS,
  generateAccessToken,
  generateServiceToken,
  generateRefreshToken,
  hashToken,
  verifyToken
};
