'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const morgan = require('morgan');
const { PrismaClient } = require('@prisma/client');

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.AUTH_PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'devsecret';
const JWT_EXPIRES_IN = '24h';

app.use(express.json());
app.use(morgan('combined'));

// ─── Health ──────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'auth', timestamp: new Date().toISOString() });
});

// ─── Register ─────────────────────────────────────────────────────────────────
app.post('/register', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'password must be at least 6 characters' });
  }

  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: 'email already registered' });
    }

    const hash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({ data: { email, password: hash } });
    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

    return res.status(201).json({
      message: 'user registered',
      token,
      user: { id: user.id, email: user.email },
    });
  } catch (err) {
    console.error('register:', err);
    return res.status(500).json({ error: 'internal server error' });
  }
});

// ─── Login ────────────────────────────────────────────────────────────────────
app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'invalid credentials' });
    }

    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

    return res.json({
      message: 'login successful',
      token,
      user: { id: user.id, email: user.email },
    });
  } catch (err) {
    console.error('login:', err);
    return res.status(500).json({ error: 'internal server error' });
  }
});

// ─── Verify token (called by other services) ──────────────────────────────────
app.post('/verify', (req, res) => {
  const authHeader = req.headers.authorization;
  const bodyToken = req.body && req.body.token;
  const token = bodyToken || (authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null);

  if (!token) {
    return res.status(400).json({ valid: false, error: 'token required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return res.json({ valid: true, userId: decoded.userId, email: decoded.email });
  } catch {
    return res.status(401).json({ valid: false, error: 'invalid or expired token' });
  }
});

// ─── Profile ──────────────────────────────────────────────────────────────────
app.get('/profile', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'authorization header required' });
  }

  try {
    const decoded = jwt.verify(authHeader.slice(7), JWT_SECRET);
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, email: true, createdAt: true },
    });
    if (!user) return res.status(404).json({ error: 'user not found' });
    return res.json(user);
  } catch {
    return res.status(401).json({ error: 'invalid or expired token' });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => console.log(`[auth] listening on :${PORT}`));

process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  process.exit(0);
});
