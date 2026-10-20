const crypto = require('crypto');
const path = require('path');
require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const { PrismaClient } = require('@prisma/client');

const app = express();
const prisma = new PrismaClient();
const ROOT_DIR = __dirname;

const PORT = Number(process.env.PORT || 8080);
const COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'inkmotion_session';
const OAUTH_RETURN_COOKIE = 'inkmotion_oauth_return';
const SESSION_DAYS = 30;
const JSON_LIMIT = process.env.JSON_LIMIT || '150mb';
const PROJECT_STATE_LIMIT = Number(process.env.PROJECT_STATE_LIMIT_BYTES || 120 * 1024 * 1024);
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const APP_BASE_URL = (process.env.APP_BASE_URL || `http://127.0.0.1:${PORT}`).replace(/\/$/, '');
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL || `${APP_BASE_URL}/api/auth/google/callback`;
const APP_NAME = process.env.APP_NAME || 'InkMotion Studio';
const MAIL_HOST = process.env.MAIL_HOST || process.env.SES_SMTP_HOST || '';
const MAIL_PORT = Number(process.env.MAIL_PORT || process.env.SES_SMTP_PORT || 587);
const MAIL_USERNAME = process.env.MAIL_USERNAME || process.env.SES_SMTP_USER || '';
const MAIL_PASSWORD = process.env.MAIL_PASSWORD || process.env.SES_SMTP_PASSWORD || '';
const MAIL_ENCRYPTION = String(process.env.MAIL_ENCRYPTION || '').toLowerCase();
const MAIL_FROM_ADDRESS = process.env.MAIL_FROM_ADDRESS || '';
const MAIL_FROM_NAME = (process.env.MAIL_FROM_NAME || APP_NAME).replace('${APP_NAME}', APP_NAME);
const MAIL_FROM = MAIL_FROM_ADDRESS
  ? `${MAIL_FROM_NAME} <${MAIL_FROM_ADDRESS}>`
  : process.env.SES_FROM_EMAIL || `${APP_NAME} <no-reply@example.com>`;

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

app.use(express.json({ limit: JSON_LIMIT }));
app.use(cookieParser());

const rateBuckets = new Map();

function clientKey(req) {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function rateLimit({ windowMs, max, prefix }) {
  return (req, res, next) => {
    const now = Date.now();
    const key = `${prefix}:${clientKey(req)}`;
    const bucket = rateBuckets.get(key) || { count: 0, resetAt: now + windowMs };

    if (bucket.resetAt <= now) {
      bucket.count = 0;
      bucket.resetAt = now + windowMs;
    }

    bucket.count += 1;
    rateBuckets.set(key, bucket);

    if (bucket.count > max) {
      res.status(429).json({ error: 'Too many requests. Try again soon.' });
      return;
    }

    next();
  };
}

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateBuckets) {
    if (bucket.resetAt <= now) rateBuckets.delete(key);
  }
}, 10 * 60 * 1000).unref();

const authLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 40, prefix: 'auth' });
const passwordResetLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 10, prefix: 'password-reset' });

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    hasGoogle: !!user.googleId,
    createdAt: user.createdAt,
  };
}

function setSessionCookie(res, token, expiresAt) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    expires: expiresAt,
    path: '/',
  });
}

async function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);

  await prisma.session.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      expiresAt,
    },
  });

  setSessionCookie(res, token, expiresAt);
}

async function currentUser(req) {
  const token = req.cookies[COOKIE_NAME];
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });

  if (!session || session.expiresAt <= new Date()) {
    if (session) {
      await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    }
    return null;
  }

  return session.user;
}

async function requireAuth(req, res, next) {
  try {
    const user = await currentUser(req);
    if (!user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function validatePassword(password) {
  return typeof password === 'string' && password.length >= 8;
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeProjectName(name, fallback = 'Untitled Project') {
  return String(name || fallback).trim().slice(0, 80) || fallback;
}

function stringifyProjectState(state) {
  const value = JSON.stringify(state || {});
  if (Buffer.byteLength(value, 'utf8') > PROJECT_STATE_LIMIT) {
    const err = new Error('Project is too large to save.');
    err.status = 413;
    throw err;
  }
  return value;
}

function parseProjectState(value) {
  try {
    return JSON.parse(value || '{}');
  } catch (err) {
    return {};
  }
}

function requireGoogleConfig(res) {
  if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) return true;
  res.status(503).json({ error: 'Google sign-in is not configured.' });
  return false;
}

function oauthState() {
  return crypto.randomBytes(24).toString('base64url');
}

function safeReturnTo(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.length > 512) return '/';
  if (!raw.startsWith('/')) return '/';
  if (raw.startsWith('//')) return '/';
  if (/[\r\n]/.test(raw)) return '/';
  return raw;
}

function withAuthQuery(returnTo, key, value) {
  const target = safeReturnTo(returnTo);
  const url = new URL(target, APP_BASE_URL);
  url.searchParams.set(key, value);
  return `${url.pathname}${url.search}${url.hash}`;
}

function resetPasswordUrl(token) {
  return `${APP_BASE_URL}/?reset_token=${encodeURIComponent(token)}`;
}

function getMailTransport() {
  if (!MAIL_HOST || !MAIL_USERNAME || !MAIL_PASSWORD) return null;
  return nodemailer.createTransport({
    host: MAIL_HOST,
    port: MAIL_PORT,
    secure: MAIL_PORT === 465 || MAIL_ENCRYPTION === 'ssl',
    requireTLS: MAIL_ENCRYPTION === 'tls' || MAIL_PORT === 587,
    auth: {
      user: MAIL_USERNAME,
      pass: MAIL_PASSWORD,
    },
  });
}

async function sendPasswordResetEmail(user, token) {
  const resetUrl = resetPasswordUrl(token);
  const transport = getMailTransport();
  if (!transport) {
    if (!IS_PRODUCTION) {
      console.log(`Password reset link for ${user.email}: ${resetUrl}`);
      return;
    }
    throw Object.assign(new Error('Email service is not configured.'), { status: 503 });
  }

  await transport.sendMail({
    from: MAIL_FROM,
    to: user.email,
    subject: 'Reset your InkMotion Studio password',
    text: [
      'Reset your InkMotion Studio password using this link:',
      '',
      resetUrl,
      '',
      'This link expires in 1 hour. If you did not request this email, you can ignore it.',
    ].join('\n'),
    html: `
      <p>Reset your InkMotion Studio password using this link:</p>
      <p><a href="${resetUrl}">${resetUrl}</a></p>
      <p>This link expires in 1 hour. If you did not request this email, you can ignore it.</p>
    `,
  });
}

app.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true });
  } catch (err) {
    res.status(503).json({ ok: false });
  }
});

app.post('/api/auth/signup', authLimiter, async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email);
    const name = String(req.body.name || '').trim().slice(0, 80) || null;
    const password = req.body.password;

    if (!validEmail(email)) {
      res.status(400).json({ error: 'Enter a valid email address.' });
      return;
    }
    if (!validatePassword(password)) {
      res.status(400).json({ error: 'Password must be at least 8 characters.' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { email, name, passwordHash },
    });

    await createSession(res, user.id);
    res.status(201).json({ user: publicUser(user) });
  } catch (err) {
    if (err.code === 'P2002') {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }
    next(err);
  }
});

app.post('/api/auth/password/forgot', passwordResetLimiter, async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email);
    if (!validEmail(email)) {
      res.status(400).json({ error: 'Enter a valid email address.' });
      return;
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (user) {
      const token = crypto.randomBytes(32).toString('base64url');
      await prisma.passwordReset.create({
        data: {
          tokenHash: hashToken(token),
          userId: user.id,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      });
      await sendPasswordResetEmail(user, token);
    }

    res.json({ ok: true, message: 'If an account exists for this email, a reset link has been sent.' });
  } catch (err) {
    next(err);
  }
});

app.post('/api/auth/password/reset', passwordResetLimiter, async (req, res, next) => {
  try {
    const token = String(req.body.token || '');
    const password = req.body.password;
    if (!token) {
      res.status(400).json({ error: 'Reset token is missing.' });
      return;
    }
    if (!validatePassword(password)) {
      res.status(400).json({ error: 'Password must be at least 8 characters.' });
      return;
    }

    const reset = await prisma.passwordReset.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });
    if (!reset || reset.usedAt || reset.expiresAt <= new Date()) {
      res.status(400).json({ error: 'This reset link is invalid or expired.' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.$transaction([
      prisma.user.update({
        where: { id: reset.userId },
        data: { passwordHash },
      }),
      prisma.passwordReset.update({
        where: { id: reset.id },
        data: { usedAt: new Date() },
      }),
      prisma.session.deleteMany({
        where: { userId: reset.userId },
      }),
    ]);

    await createSession(res, reset.userId);
    res.json({ user: publicUser({ ...reset.user, passwordHash }) });
  } catch (err) {
    next(err);
  }
});

app.get('/api/auth/google', authLimiter, (req, res) => {
  const returnTo = safeReturnTo(req.query.returnTo || req.query.return_to);
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    res.redirect(withAuthQuery(returnTo, 'auth_error', 'google_not_configured'));
    return;
  }

  const state = oauthState();
  res.cookie('inkmotion_oauth_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PRODUCTION,
    maxAge: 10 * 60 * 1000,
    path: '/',
  });
  res.cookie(OAUTH_RETURN_COOKIE, returnTo, {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PRODUCTION,
    maxAge: 10 * 60 * 1000,
    path: '/',
  });

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', GOOGLE_CLIENT_ID);
  url.searchParams.set('redirect_uri', GOOGLE_CALLBACK_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  url.searchParams.set('prompt', 'select_account');
  res.redirect(url.toString());
});

app.get('/api/auth/google/callback', authLimiter, async (req, res, next) => {
  try {
    const returnTo = safeReturnTo(req.cookies[OAUTH_RETURN_COOKIE]);
    res.clearCookie(OAUTH_RETURN_COOKIE, { path: '/' });
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      res.redirect(withAuthQuery(returnTo, 'auth_error', 'google_not_configured'));
      return;
    }

    const expectedState = req.cookies.inkmotion_oauth_state;
    res.clearCookie('inkmotion_oauth_state', { path: '/' });
    if (!req.query.code || !req.query.state || req.query.state !== expectedState) {
      res.redirect(withAuthQuery(returnTo, 'auth_error', 'google_state'));
      return;
    }

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(req.query.code),
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: GOOGLE_CALLBACK_URL,
        grant_type: 'authorization_code',
      }),
    });
    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenData.access_token) {
      res.redirect(withAuthQuery(returnTo, 'auth_error', 'google_token'));
      return;
    }

    const profileResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const profile = await profileResponse.json();
    if (!profileResponse.ok || !profile.email || !profile.sub) {
      res.redirect(withAuthQuery(returnTo, 'auth_error', 'google_profile'));
      return;
    }

    const email = normalizeEmail(profile.email);
    const user = await prisma.user.upsert({
      where: { email },
      update: {
        googleId: String(profile.sub),
        name: profile.name || profile.given_name || email,
      },
      create: {
        email,
        name: profile.name || profile.given_name || email,
        googleId: String(profile.sub),
      },
    });

    await createSession(res, user.id);
    res.redirect(withAuthQuery(returnTo, 'auth', 'google'));
  } catch (err) {
    next(err);
  }
});

app.post('/api/auth/login', authLimiter, async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || '');
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user || !user.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
      await bcrypt.compare(password || 'invalid-password', '$2a$12$CwTycUXWue0Thq9StjUM0uJ8Q3PlNzkjKIiOJneC.Ro/41QSq3gLK').catch(() => {});
      res.status(401).json({ error: 'Email or password is incorrect.' });
      return;
    }

    await createSession(res, user.id);
    res.json({ user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

app.post('/api/auth/logout', async (req, res, next) => {
  try {
    const token = req.cookies[COOKIE_NAME];
    if (token) {
      await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
    }
    res.clearCookie(COOKIE_NAME, { path: '/' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.get('/api/auth/me', async (req, res, next) => {
  try {
    res.json({ user: publicUser(await currentUser(req)) });
  } catch (err) {
    next(err);
  }
});

app.get('/api/projects', requireAuth, async (req, res, next) => {
  try {
    const projects = await prisma.project.findMany({
      where: { userId: req.user.id },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, name: true, createdAt: true, updatedAt: true },
    });
    res.json({ projects });
  } catch (err) {
    next(err);
  }
});

app.get('/api/projects/:id', requireAuth, async (req, res, next) => {
  try {
    const project = await prisma.project.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!project) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }
    res.json({ project: { ...project, state: parseProjectState(project.state) } });
  } catch (err) {
    next(err);
  }
});

app.post('/api/projects', requireAuth, async (req, res, next) => {
  try {
    const name = normalizeProjectName(req.body.name);
    const state = stringifyProjectState(req.body.state);
    const project = await prisma.project.create({
      data: { name, state, userId: req.user.id },
    });
    res.status(201).json({ project: { ...project, state: parseProjectState(project.state) } });
  } catch (err) {
    next(err);
  }
});

app.put('/api/projects/:id', requireAuth, async (req, res, next) => {
  try {
    const existing = await prisma.project.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!existing) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }

    const data = {};
    if (typeof req.body.name === 'string') {
      data.name = normalizeProjectName(req.body.name, existing.name);
    }
    if (req.body.state !== undefined) {
      data.state = stringifyProjectState(req.body.state);
    }

    const project = await prisma.project.update({
      where: { id: existing.id },
      data,
    });
    res.json({ project: { ...project, state: parseProjectState(project.state) } });
  } catch (err) {
    next(err);
  }
});

app.delete('/api/projects/:id', requireAuth, async (req, res, next) => {
  try {
    await prisma.project.deleteMany({
      where: { id: req.params.id, userId: req.user.id },
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

function blocksSensitiveFile(req, res, next) {
  let cleanPath;
  try {
    cleanPath = decodeURIComponent(req.path).replace(/\\/g, '/').toLowerCase();
  } catch (err) {
    res.status(400).send('Bad request');
    return;
  }
  const blocked =
    cleanPath.startsWith('/node_modules/') ||
    cleanPath.startsWith('/prisma/') ||
    cleanPath.startsWith('/.git/') ||
    cleanPath === '/server.js' ||
    cleanPath === '/package.json' ||
    cleanPath === '/package-lock.json' ||
    cleanPath === '/.env' ||
    cleanPath === '/.env.example';

  if (blocked) {
    res.status(404).send('Not found');
    return;
  }

  next();
}

function studioNestedAssetPath(req) {
  let cleanPath;
  try {
    cleanPath = decodeURIComponent(req.path).replace(/\\/g, '/');
  } catch (err) {
    return null;
  }
  const match = cleanPath.match(/^\/studio\/.+\/(animations\.js|site\.webmanifest|favicon\.svg|images\/[^/]+)$/);
  if (!match) return null;
  const assetPath = match[1];
  if (assetPath.includes('..')) return null;
  return path.join(ROOT_DIR, assetPath);
}

app.get(/^\/studio\/.+\/(?:animations\.js|site\.webmanifest|favicon\.svg|images\/[^/]+)$/, (req, res, next) => {
  const filePath = studioNestedAssetPath(req);
  if (!filePath) {
    next();
    return;
  }
  res.sendFile(filePath, err => {
    if (err) next();
  });
});

app.get('/', (req, res) => {
  res.redirect(302, '/en' + req.originalUrl.slice(1));
});

app.get(/^\/(en|pt|es)\/?$/, (req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'index.html'));
});

app.get(/^\/studio(?:\/.*)?$/, (req, res) => {
  res.redirect(302, '/en' + req.originalUrl);
});

app.get(/^\/(en|pt|es)\/docs\/?$/, (req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'pages/docs.html'));
});

app.get('/pages/docs.html', (req, res) => res.redirect(302, '/en/docs'));

app.get(/^\/(en|pt|es)\/studio(?:\/.*)?$/, (req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'studio.html'));
});

app.use(blocksSensitiveFile);
app.use(express.static(ROOT_DIR, {
  index: false,
  dotfiles: 'deny',
  fallthrough: true,
  maxAge: IS_PRODUCTION ? '1h' : 0,
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store');
    }
  },
}));

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Invalid JSON body.' });
    return;
  }
  if (err.type === 'entity.too.large') {
    res.status(413).json({ error: 'Project is too large for account save.' });
    return;
  }

  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Something went wrong.' : err.message });
});

const server = app.listen(PORT, () => {
  console.log(`InkMotion Studio running at http://127.0.0.1:${PORT}`);
});

async function shutdown(signal) {
  console.log(`${signal} received. Shutting down...`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
