'use strict';

const express = require('express');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const morgan = require('morgan');
const { PrismaClient } = require('@prisma/client');

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.ORDERS_PORT || 3003;
const JWT_SECRET = process.env.JWT_SECRET || 'devsecret';
const CATALOG_URL = process.env.CATALOG_URL || 'http://localhost:3002';
const PAYMENTS_URL = process.env.PAYMENTS_URL || 'http://localhost:3004';

app.use(express.json());
app.use(morgan('combined'));

// ─── Auth middleware ──────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'authorization header required' });
  }
  try {
    req.user = jwt.verify(authHeader.slice(7), JWT_SECRET);
    return next();
  } catch {
    return res.status(401).json({ error: 'invalid or expired token' });
  }
}

// ─── Health ──────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'orders', timestamp: new Date().toISOString() });
});

// ─── List orders (scoped to authenticated user) ───────────────────────────────
app.get('/', requireAuth, async (req, res) => {
  try {
    const orders = await prisma.order.findMany({
      where: { userId: req.user.userId },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
    });
    return res.json(orders);
  } catch (err) {
    console.error('list orders:', err);
    return res.status(500).json({ error: 'internal server error' });
  }
});

// ─── Get single order ─────────────────────────────────────────────────────────
app.get('/:id', requireAuth, async (req, res) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: { items: true },
    });
    if (!order) return res.status(404).json({ error: 'order not found' });
    if (order.userId !== req.user.userId) return res.status(403).json({ error: 'forbidden' });
    return res.json(order);
  } catch (err) {
    console.error('get order:', err);
    return res.status(500).json({ error: 'internal server error' });
  }
});

// ─── Create order ─────────────────────────────────────────────────────────────
// Body: { items: [{ productId, quantity }] }
app.post('/', requireAuth, async (req, res) => {
  const { items } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items array is required' });
  }

  try {
    // Validate and price every item against the catalog
    const resolvedItems = await Promise.all(
      items.map(async ({ productId, quantity }) => {
        if (!productId || !quantity || quantity < 1) {
          throw Object.assign(new Error('each item needs productId and quantity >= 1'), { status: 400 });
        }
        const { data: product } = await axios.get(`${CATALOG_URL}/products/${productId}`).catch(() => {
          throw Object.assign(new Error(`product ${productId} not found`), { status: 404 });
        });
        if (product.stock < quantity) {
          throw Object.assign(new Error(`insufficient stock for ${product.name}`), { status: 409 });
        }
        return { productId, name: product.name, quantity, price: product.price };
      }),
    );

    const total = resolvedItems.reduce((sum, i) => sum + i.price * i.quantity, 0);

    // Create the order record
    const order = await prisma.order.create({
      data: {
        userId: req.user.userId,
        total,
        status: 'pending',
        items: { create: resolvedItems },
      },
      include: { items: true },
    });

    // Request payment
    try {
      const { data: payment } = await axios.post(`${PAYMENTS_URL}/payments`, {
        orderId: order.id,
        amount: total,
      });
      // Update order status based on payment outcome
      const finalStatus = payment.status === 'paid' ? 'confirmed' : 'payment_failed';
      const updated = await prisma.order.update({
        where: { id: order.id },
        data: { status: finalStatus },
        include: { items: true },
      });
      return res.status(201).json({ order: updated, payment });
    } catch (payErr) {
      console.error('payment call failed:', payErr.message);
      // Return the order even if payment service is temporarily unavailable
      return res.status(201).json({ order, warning: 'payment service unreachable — order created as pending' });
    }
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('create order:', err);
    return res.status(500).json({ error: 'internal server error' });
  }
});

// ─── Update order status ──────────────────────────────────────────────────────
app.patch('/:id/status', requireAuth, async (req, res) => {
  const { status } = req.body;
  const allowed = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'];
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${allowed.join(', ')}` });
  }

  try {
    const order = await prisma.order.findUnique({ where: { id: req.params.id } });
    if (!order) return res.status(404).json({ error: 'order not found' });
    if (order.userId !== req.user.userId) return res.status(403).json({ error: 'forbidden' });

    const updated = await prisma.order.update({
      where: { id: req.params.id },
      data: { status },
      include: { items: true },
    });
    return res.json(updated);
  } catch (err) {
    console.error('update order status:', err);
    return res.status(500).json({ error: 'internal server error' });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => console.log(`[orders] listening on :${PORT}`));

process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  process.exit(0);
});
