const { verifyToken } = require('../tokens');
const { evaluatePolicy } = require('../policy');
const { recordAudit } = require('../audit');

/**
 * Factory untuk membuat middleware Policy Enforcement Point (PEP).
 * Mencegat seluruh request menuju resource service, memvalidasi JWT,
 * memanggil Policy Engine, dan mencatat keputusan ke Audit Log.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {import('express').RequestHandler}
 */
function createPepMiddleware(db, options = {}) {
  return function pepMiddleware(req, res, next) {
    // 1. Sanitasi keamanan: Hapus header X-Gateway-Secret jika dikirim dari klien luar
    delete req.headers['x-gateway-secret'];

    // 2. Ekstrak Header Authorization Bearer
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      recordAudit(db, {
        subject: 'anonymous',
        role: 'none',
        endpoint: req.originalUrl.split('?')[0],
        method: req.method,
        deviceId: req.headers['x-device-id'] || null,
        decision: 'DENY',
        reason: 'Header Authorization Bearer tidak ditemukan atau format tidak sesuai'
      });

      return res.status(401).json({
        success: false,
        error: 'UNAUTHORIZED',
        message: 'Header Authorization Bearer token wajib disertakan'
      });
    }

    const token = authHeader.slice(7).trim();
    const verification = verifyToken(token);

    if (!verification.valid) {
      recordAudit(db, {
        subject: 'anonymous',
        role: 'none',
        endpoint: req.originalUrl.split('?')[0],
        method: req.method,
        deviceId: req.headers['x-device-id'] || null,
        decision: 'DENY',
        reason: verification.message || 'Token tidak valid'
      });

      return res.status(401).json({
        success: false,
        error: verification.error,
        message: verification.message
      });
    }

    const subject = verification.payload;
    req.user = subject;

    const resourcePath = req.originalUrl.split('?')[0];
    const deviceId = req.headers['x-device-id'];

    // 3. Evaluasi Kebijakan melalui Policy Engine (PE)
    const policyResult = evaluatePolicy(db, {
      subject,
      action: req.method,
      resource: resourcePath,
      context: {
        deviceId,
        body: req.body,
        params: req.params,
        // Override hanya bisa diberikan lewat opsi internal saat test, tidak lewat HTTP header.
        ...(typeof options.getCurrentHour === 'function'
          ? { currentHour: options.getCurrentHour() }
          : {})
      }
    });

    // 4. Catat telemetri keputusan ke Audit Log
    recordAudit(db, {
      subject: subject.username || subject.sub,
      role: subject.role || 'none',
      endpoint: resourcePath,
      method: req.method,
      deviceId: deviceId || null,
      decision: policyResult.decision,
      reason: policyResult.reason
    });

    // 5. Penegakan PEP (Enforcement)
    if (policyResult.decision === 'DENY') {
      return res.status(403).json({
        success: false,
        error: 'FORBIDDEN',
        message: policyResult.reason
      });
    }

    // Jika ALLOW, sematkan metadata kebijakan dan teruskan ke proxy
    req.policyMeta = policyResult.meta;
    next();
  };
}

module.exports = {
  createPepMiddleware
};
