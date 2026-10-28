const express = require('express');
const http = require('http');
const https = require('https');
const path = require('path');
const { URL } = require('url');
const { login, refresh, logout, authenticateService } = require('./auth');
const { createPepMiddleware } = require('./middleware/pep');
const { recordAudit } = require('./audit');
require('dotenv').config();

/**
 * Membuat dan mengonfigurasi aplikasi Express untuk API Gateway (PEP).
 *
 * @param {import('better-sqlite3').Database} db - Instance koneksi database SQLite
 * @param {object} [options] - Opsi kustom (misal target proxy untuk testing)
 * @returns {import('express').Express}
 */
function createApp(db, options = {}) {
  const app = express();

  // Konfigurasi target service
  const serviceNilaiUrl = options.serviceNilaiUrl ||
    process.env.SERVICE_NILAI_URL ||
    `http://127.0.0.1:${process.env.SERVICE_NILAI_PORT || 3001}`;

  const serviceTranskripUrl = options.serviceTranskripUrl ||
    process.env.SERVICE_TRANSKRIP_URL ||
    `http://127.0.0.1:${process.env.SERVICE_TRANSKRIP_PORT || 3002}`;

  const gatewaySecret = process.env.GATEWAY_SECRET;
  if (!gatewaySecret) {
    throw new Error('GATEWAY_SECRET wajib dikonfigurasi sebelum Gateway dijalankan.');
  }
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET wajib dikonfigurasi sebelum Gateway dijalankan.');
  }

  // 1. Global Middleware
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Device-ID, X-Gateway-Secret');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  app.use(express.json({ limit: '1mb', strict: true }));

  // Static Frontend UI
  const frontendDir = path.join(__dirname, '..', '..', 'frontend');
  app.use(express.static(frontendDir));

  // 2. Health Endpoint
  app.get('/health', (req, res) => {
    res.status(200).json({
      status: 'UP',
      service: 'api-gateway',
      role: 'PEP',
      timestamp: new Date().toISOString()
    });
  });

  // Telemetri Audit Log untuk antarmuka dashboard frontend
  app.get('/api/audit-logs', (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit || '100', 10), 500);
      const rows = db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?').all(limit);
      res.json({ success: true, data: rows });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 3. Autentikasi Pengguna & Sesi (Ditangani langsung oleh Gateway / Policy Administrator)
  app.post('/auth/login', (req, res) => {
    const { username, password } = req.body || {};
    const deviceId = req.headers['x-device-id'];

    const result = login(db, { username, password, deviceId });

    if (!result.success) {
      recordAudit(db, {
        subject: username || 'anonymous',
        role: 'none',
        endpoint: '/auth/login',
        method: 'POST',
        deviceId: deviceId || null,
        decision: 'DENY',
        reason: result.message
      });

      return res.status(401).json(result);
    }

    recordAudit(db, {
      subject: result.user.username,
      role: result.user.role,
      endpoint: '/auth/login',
      method: 'POST',
      deviceId: deviceId || null,
      decision: 'ALLOW',
      reason: 'Login berhasil, token diterbitkan'
    });

    return res.status(200).json(result);
  });

  app.post('/auth/refresh', (req, res) => {
    const { refreshToken } = req.body || {};
    const deviceId = req.headers['x-device-id'];

    const result = refresh(db, { refreshToken, deviceId });

    if (!result.success) {
      recordAudit(db, {
        subject: 'anonymous',
        role: 'none',
        endpoint: '/auth/refresh',
        method: 'POST',
        deviceId: deviceId || null,
        decision: 'DENY',
        reason: result.message
      });

      return res.status(401).json(result);
    }

    recordAudit(db, {
      subject: 'refresh-session',
      role: 'user',
      endpoint: '/auth/refresh',
      method: 'POST',
      deviceId: deviceId || null,
      decision: 'ALLOW',
      reason: 'Refresh token rotation berhasil'
    });

    return res.status(200).json(result);
  });

  app.post('/auth/logout', (req, res) => {
    const { refreshToken } = req.body || {};

    const result = logout(db, { refreshToken });

    if (!result.success) {
      recordAudit(db, {
        subject: 'anonymous',
        role: 'none',
        endpoint: '/auth/logout',
        method: 'POST',
        deviceId: req.headers['x-device-id'] || null,
        decision: 'DENY',
        reason: result.message
      });
      return res.status(400).json(result);
    }

    recordAudit(db, {
      subject: 'logout-session',
      role: 'user',
      endpoint: '/auth/logout',
      method: 'POST',
      deviceId: req.headers['x-device-id'] || null,
      decision: 'ALLOW',
      reason: 'Sesi berhasil dicabut (logout)'
    });

    return res.status(200).json(result);
  });

  // 4. Autentikasi Service-to-Service (Menerbitkan Service Token 5 Menit)
  app.post('/auth/service', (req, res) => {
    const { clientId, clientSecret } = req.body || {};

    const result = authenticateService({ clientId, clientSecret });

    if (!result.success) {
      recordAudit(db, {
        subject: clientId || 'anonymous-service',
        role: 'service',
        endpoint: '/auth/service',
        method: 'POST',
        deviceId: null,
        decision: 'DENY',
        reason: result.message
      });

      return res.status(401).json(result);
    }

    recordAudit(db, {
      subject: clientId,
      role: 'service',
      endpoint: '/auth/service',
      method: 'POST',
      deviceId: null,
      decision: 'ALLOW',
      reason: 'Autentikasi service-to-service berhasil, Service Token diterbitkan'
    });

    return res.status(200).json(result);
  });

  // 5. Inisialisasi Middleware PEP (Policy Enforcement Point)
  const pepMiddleware = createPepMiddleware(db, { getCurrentHour: options.getCurrentHour });

  // HTTP proxy berbasis Node bawaan untuk menghindari dependency rentan.
  // JSON body diparse oleh Express; rekonstruksi body yang persis dari req.body.
  function createUpstreamProxy(targetUrl, serviceLabel) {
    return function upstreamProxy(req, res) {
      let body = null;
      if (req.body !== undefined && req.body !== null && !['GET', 'HEAD'].includes(req.method)) {
        body = Buffer.from(JSON.stringify(req.body));
      }

      let upstream;
      try {
        upstream = new URL(targetUrl);
      } catch (error) {
        return res.status(502).json({ success: false, error: 'BAD_GATEWAY', message: `URL upstream ${serviceLabel} tidak valid` });
      }

      const transport = upstream.protocol === 'https:' ? https : http;
      const headers = { ...req.headers };
      // Hop-by-hop and client-supplied internal headers must not pass upstream.
      for (const name of ['host', 'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailers', 'transfer-encoding', 'upgrade', 'x-gateway-secret', 'content-length']) {
        delete headers[name];
      }
      headers.host = upstream.host;
      headers['x-gateway-secret'] = gatewaySecret;
      if (body) {
        headers['content-length'] = String(body.length);
        headers['content-type'] = req.headers['content-type'] || 'application/json';
      }

      const upstreamReq = transport.request({
        protocol: upstream.protocol,
        hostname: upstream.hostname,
        port: upstream.port || (upstream.protocol === 'https:' ? 443 : 80),
        method: req.method,
        path: `${req.originalUrl}`,
        headers,
        timeout: 10000
      }, (upstreamRes) => {
        res.status(upstreamRes.statusCode || 502);
        for (const [name, value] of Object.entries(upstreamRes.headers)) {
          if (value !== undefined && !['transfer-encoding', 'connection'].includes(name.toLowerCase())) {
            res.setHeader(name, value);
          }
        }
        upstreamRes.pipe(res);
      });

      upstreamReq.on('timeout', () => upstreamReq.destroy(new Error('Upstream timeout')));
      upstreamReq.on('error', () => {
        if (!res.headersSent) {
          res.status(502).json({ success: false, error: 'BAD_GATEWAY', message: `Gagal menghubungi ${serviceLabel} downstream` });
        } else {
          res.destroy();
        }
      });
      if (body) upstreamReq.write(body);
      upstreamReq.end();
    };
  }

  const nilaiProxy = createUpstreamProxy(serviceNilaiUrl, 'Service Nilai (Port 3001)');
  const transkripProxy = createUpstreamProxy(serviceTranskripUrl, 'Service Transkrip (Port 3002)');

  // 8. Pemasangan Rute Resource Dilindungi PEP + Reverse Proxy
  app.use(['/nilai', '/kelas'], pepMiddleware, nilaiProxy);
  app.use('/transkrip', pepMiddleware, transkripProxy);

  // 9. 404 Handler untuk Rute yang Tidak Ditemukan
  app.use((req, res) => {
    res.status(404).json({
      success: false,
      error: 'NOT_FOUND',
      message: `Rute '${req.method} ${req.originalUrl}' tidak ditemukan`
    });
  });

  // 10. Centralized Error Handler
  app.use((err, req, res, next) => {
    console.error('[GATEWAY_ERROR]', err);
    res.status(500).json({
      success: false,
      error: 'INTERNAL_SERVER_ERROR',
      message: 'Terjadi kesalahan internal pada API Gateway'
    });
  });

  return app;
}

module.exports = {
  createApp
};
