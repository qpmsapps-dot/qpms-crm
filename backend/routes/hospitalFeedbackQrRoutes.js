import express from 'express';

import {
  deleteHospitalFeedbackQr,
  generateHospitalFeedbackQr,
  invalidQrResponse,
  listHospitalFeedbackQrs,
  loadQrLocationOptions,
  previewHospitalFeedbackQr,
  reprintHospitalFeedbackQr,
  resolvePublicHospitalFeedbackQr,
  verifyPublicFeedbackSession,
} from '../services/hospitalFeedbackQrService.js';

function integerEnv(environment, key, fallback, min, max) {
  const value = Number.parseInt(String(environment[key] ?? ''), 10);
  if (!Number.isInteger(value) || value < min || value > max) return fallback;
  return value;
}

function createPublicQrRateLimit(environment = process.env) {
  const max = integerEnv(environment, 'HOSPITAL_FEEDBACK_QR_RATE_LIMIT_MAX', 30, 1, 1000);
  const windowMs = integerEnv(
    environment,
    'HOSPITAL_FEEDBACK_QR_RATE_LIMIT_WINDOW_MS',
    10 * 60 * 1000,
    60 * 1000,
    60 * 60 * 1000,
  );
  const buckets = new Map();
  return function publicQrRateLimit(request, response, next) {
    const key = request.ip || request.headers['x-forwarded-for'] || 'unknown';
    const now = Date.now();
    const current = buckets.get(key);
    if (!current || current.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }
    current.count += 1;
    if (current.count > max) {
      response.set('Retry-After', String(Math.ceil((current.resetAt - now) / 1000)));
      response.status(429).json({
        valid: false,
        code: 'RATE_LIMITED',
        message: 'Too many QR validation attempts. Please try again shortly.',
      });
      return;
    }
    next();
  };
}

function noStoreNoIndex(_request, response, next) {
  response.set('Cache-Control', 'no-store');
  response.set('X-Robots-Tag', 'noindex, nofollow');
  next();
}

function safeInternalError(response, error) {
  const status = Number(error?.statusCode || 500);
  response.status(status).json({
    ok: false,
    code: status >= 500 ? 'hospital_feedback_qr_failed' : error?.code || 'hospital_feedback_qr_error',
    message: status >= 500
      ? 'Hospital Feedback QR service is unavailable.'
      : error?.message || 'Unable to complete Hospital Feedback QR request.',
  });
}

export function createHospitalFeedbackQrRouter({
  serviceClient,
  requireAuth,
  environment = process.env,
}) {
  const router = express.Router();
  const publicQrRateLimit = createPublicQrRateLimit(environment);

  router.get('/qr/locations', requireAuth, async (request, response) => {
    try {
      const locations = await loadQrLocationOptions(serviceClient, {
        authUser: request.authUser,
        profile: request.profile,
      });
      response.json({ ok: true, locations });
    } catch (error) {
      safeInternalError(response, error);
    }
  });

  router.get('/qr', requireAuth, async (request, response) => {
    try {
      const result = await listHospitalFeedbackQrs({
        client: serviceClient,
        authUser: request.authUser,
        profile: request.profile,
        filters: request.query || {},
      });
      response.json({ ok: true, ...result });
    } catch (error) {
      safeInternalError(response, error);
    }
  });

  router.post('/qr', requireAuth, async (request, response) => {
    try {
      const result = await generateHospitalFeedbackQr({
        client: serviceClient,
        authUser: request.authUser,
        profile: request.profile,
        locationId: request.body?.location_id,
        environment,
        request,
      });
      response.status(result.existing ? 200 : 201).json({ ok: true, qr: result });
    } catch (error) {
      safeInternalError(response, error);
    }
  });

  router.get('/qr/:qrId/preview', requireAuth, async (request, response) => {
    try {
      const result = await previewHospitalFeedbackQr({
        client: serviceClient,
        authUser: request.authUser,
        profile: request.profile,
        qrId: request.params.qrId,
        environment,
        request,
      });
      response.json({ ok: true, ...result });
    } catch (error) {
      safeInternalError(response, error);
    }
  });

  router.post('/qr/:qrId/reprint', requireAuth, async (request, response) => {
    try {
      const result = await reprintHospitalFeedbackQr({
        client: serviceClient,
        authUser: request.authUser,
        profile: request.profile,
        qrId: request.params.qrId,
        environment,
        request,
      });
      response.json({ ok: true, ...result });
    } catch (error) {
      safeInternalError(response, error);
    }
  });

  router.delete('/qr/:qrId', requireAuth, async (request, response) => {
    try {
      const result = await deleteHospitalFeedbackQr({
        client: serviceClient,
        authUser: request.authUser,
        profile: request.profile,
        qrId: request.params.qrId,
      });
      response.json(result);
    } catch (error) {
      safeInternalError(response, error);
    }
  });

  router.get('/public/qr/:token', noStoreNoIndex, publicQrRateLimit, async (request, response) => {
    try {
      const result = await resolvePublicHospitalFeedbackQr({
        client: serviceClient,
        token: request.params.token,
        environment,
      });
      response.status(result.valid ? 200 : 404).json(result);
    } catch {
      response.status(503).json(invalidQrResponse());
    }
  });

  router.get('/public/session/:sessionToken', noStoreNoIndex, publicQrRateLimit, (request, response) => {
    const result = verifyPublicFeedbackSession(request.params.sessionToken);
    if (!result.valid) {
      response.status(401).json({
        valid: false,
        code: 'PUBLIC_SESSION_EXPIRED',
        message: 'This feedback session has expired. Please scan the QR code again.',
      });
      return;
    }
    response.json({ valid: true, expiresAt: result.expiresAt });
  });

  return router;
}

export function createPublicHospitalFeedbackQrRouter({
  serviceClient,
  environment = process.env,
}) {
  const router = express.Router();
  const publicQrRateLimit = createPublicQrRateLimit(environment);

  router.get('/qr/:token', noStoreNoIndex, publicQrRateLimit, async (request, response) => {
    try {
      const result = await resolvePublicHospitalFeedbackQr({
        client: serviceClient,
        token: request.params.token,
        environment,
      });
      response.status(result.valid ? 200 : 404).json(result);
    } catch {
      response.status(503).json(invalidQrResponse());
    }
  });

  router.get('/session/:sessionToken', noStoreNoIndex, publicQrRateLimit, (request, response) => {
    const result = verifyPublicFeedbackSession(request.params.sessionToken);
    if (!result.valid) {
      response.status(401).json({
        valid: false,
        code: 'PUBLIC_SESSION_EXPIRED',
        message: 'This feedback session has expired. Please scan the QR code again.',
      });
      return;
    }
    response.json({ valid: true, expiresAt: result.expiresAt });
  });

  return router;
}
