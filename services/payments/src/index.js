'use strict';

const express = require('express');
const morgan = require('morgan');
const { PrismaClient } = require('@prisma/client');

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PAYMENTS_PORT || 3004;

app.use(express.json());
app.use(morgan('combined'));

// ─── Health ──────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'payments', timestamp: new Date().toISOString() });
});

// ─── Create payment ───────────────────────────────────────────────────────────
// Body: { orderId, amount, method? }
app.post('/payments', async (req, res) => {
  const { orderId, amount, method = 'card' } = req.body;

  if (!orderId || amount == null) {
    return res.status(400).json({ error: 'orderId and amount are required' });
  }

  try {
    const existing = await prisma.payment.findUnique({ where: { orderId } });
    if (existing) {
      return res.status(409).json({ error: 'payment already exists for this order', payment: existing });
    }

    // Simulate payment processing (always succeeds in this demo)
    const payment = await prisma.payment.create({
      data: { orderId, amount: Number(amount), method, status: 'paid' },
    });

    console.log(`[payments] processed orderId=${orderId} amount=${amount} status=paid`);
    return res.status(201).json(payment);
  } catch (err) {
    console.error('create payment:', err);
    return res.status(500).json({ error: 'internal server error' });
  }
});

// ─── Get payment by ID ────────────────────────────────────────────────────────
app.get('/payments/:id', async (req, res) => {
  try {
    const payment = await prisma.payment.findUnique({ where: { id: req.params.id } });
    if (!payment) return res.status(404).json({ error: 'payment not found' });
    return res.json(payment);
  } catch (err) {
    console.error('get payment:', err);
    return res.status(500).json({ error: 'internal server error' });
  }
});

// ─── Get payment by order ID ──────────────────────────────────────────────────
app.get('/payments/order/:orderId', async (req, res) => {
  try {
    const payment = await prisma.payment.findUnique({ where: { orderId: req.params.orderId } });
    if (!payment) return res.status(404).json({ error: 'payment not found for this order' });
    return res.json(payment);
  } catch (err) {
    console.error('get payment by order:', err);
    return res.status(500).json({ error: 'internal server error' });
  }
});

// ─── Refund / update payment status ──────────────────────────────────────────
app.patch('/payments/:id', async (req, res) => {
  const { status } = req.body;
  const allowed = ['pending', 'paid', 'refunded', 'failed'];
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${allowed.join(', ')}` });
  }

  try {
    const payment = await prisma.payment.update({ where: { id: req.params.id }, data: { status } });
    return res.json(payment);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'payment not found' });
    console.error('update payment:', err);
    return res.status(500).json({ error: 'internal server error' });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => console.log(`[payments] listening on :${PORT}`));

process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  process.exit(0);
});
