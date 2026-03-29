'use strict';

const express = require('express');
const morgan = require('morgan');
const { PrismaClient } = require('@prisma/client');

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.CATALOG_PORT || 3002;

app.use(express.json());
app.use(morgan('combined'));

// ─── Health ──────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'catalog', timestamp: new Date().toISOString() });
});

// ─── Seed (idempotent — only inserts if table is empty) ───────────────────────
async function seed() {
  const count = await prisma.product.count();
  if (count > 0) return;

  await prisma.product.createMany({
    data: [
      { name: 'Wireless Headphones', description: 'Noise-cancelling over-ear headphones', price: 89.99, stock: 50, category: 'electronics' },
      { name: 'Mechanical Keyboard', description: 'Compact TKL with Cherry MX Blue switches', price: 129.99, stock: 30, category: 'electronics' },
      { name: 'USB-C Hub', description: '7-in-1 hub with HDMI, USB-A, SD card reader', price: 39.99, stock: 100, category: 'electronics' },
      { name: 'Standing Desk Mat', description: 'Anti-fatigue ergonomic mat 90×60 cm', price: 49.99, stock: 75, category: 'furniture' },
      { name: 'Coffee Mug', description: 'Insulated 350 ml stainless-steel travel mug', price: 19.99, stock: 200, category: 'kitchen' },
    ],
  });
  console.log('[catalog] seeded 5 demo products');
}

// ─── List products ────────────────────────────────────────────────────────────
app.get('/products', async (req, res) => {
  const { category, search } = req.query;
  const where = {};
  if (category) where.category = category;
  if (search) where.name = { contains: search };

  try {
    const products = await prisma.product.findMany({ where, orderBy: { createdAt: 'desc' } });
    return res.json(products);
  } catch (err) {
    console.error('list products:', err);
    return res.status(500).json({ error: 'internal server error' });
  }
});

// ─── Get product ──────────────────────────────────────────────────────────────
app.get('/products/:id', async (req, res) => {
  try {
    const product = await prisma.product.findUnique({ where: { id: req.params.id } });
    if (!product) return res.status(404).json({ error: 'product not found' });
    return res.json(product);
  } catch (err) {
    console.error('get product:', err);
    return res.status(500).json({ error: 'internal server error' });
  }
});

// ─── Create product ───────────────────────────────────────────────────────────
app.post('/products', async (req, res) => {
  const { name, description, price, stock, category, imageUrl } = req.body;

  if (!name || price == null) {
    return res.status(400).json({ error: 'name and price are required' });
  }

  try {
    const product = await prisma.product.create({
      data: { name, description: description || '', price: Number(price), stock: stock || 0, category: category || 'general', imageUrl: imageUrl || '' },
    });
    return res.status(201).json(product);
  } catch (err) {
    console.error('create product:', err);
    return res.status(500).json({ error: 'internal server error' });
  }
});

// ─── Update product ───────────────────────────────────────────────────────────
app.put('/products/:id', async (req, res) => {
  const { name, description, price, stock, category, imageUrl } = req.body;
  const data = {};
  if (name !== undefined) data.name = name;
  if (description !== undefined) data.description = description;
  if (price !== undefined) data.price = Number(price);
  if (stock !== undefined) data.stock = Number(stock);
  if (category !== undefined) data.category = category;
  if (imageUrl !== undefined) data.imageUrl = imageUrl;

  try {
    const product = await prisma.product.update({ where: { id: req.params.id }, data });
    return res.json(product);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'product not found' });
    console.error('update product:', err);
    return res.status(500).json({ error: 'internal server error' });
  }
});

// ─── Delete product ───────────────────────────────────────────────────────────
app.delete('/products/:id', async (req, res) => {
  try {
    await prisma.product.delete({ where: { id: req.params.id } });
    return res.status(204).send();
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'product not found' });
    console.error('delete product:', err);
    return res.status(500).json({ error: 'internal server error' });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`[catalog] listening on :${PORT}`);
  await seed();
});

process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  process.exit(0);
});
