'use strict';

const express = require('express');
const morgan = require('morgan');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = process.env.GATEWAY_PORT || 8080;

const SERVICES = {
  auth: process.env.AUTH_URL || 'http://localhost:3001',
  catalog: process.env.CATALOG_URL || 'http://localhost:3002',
  orders: process.env.ORDERS_URL || 'http://localhost:3003',
  payments: process.env.PAYMENTS_URL || 'http://localhost:3004',
};

app.use(morgan('combined'));

// ─── Gateway health ───────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'gateway',
    timestamp: new Date().toISOString(),
    routes: {
      '/auth/*': SERVICES.auth,
      '/catalog/*': SERVICES.catalog,
      '/orders/*': SERVICES.orders,
      '/payments/*': SERVICES.payments,
    },
  });
});

// ─── Helper: build proxy for a service ───────────────────────────────────────
function proxy(prefix, target) {
  return createProxyMiddleware({
    target,
    changeOrigin: true,
    pathRewrite: { [`^/${prefix}`]: '' },
    onError(err, req, res) {
      console.error(`[gateway] proxy error → ${target}:`, err.message);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `${prefix} service unavailable`, details: err.message }));
    },
    logLevel: 'warn',
  });
}

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/auth',     proxy('auth',     SERVICES.auth));
app.use('/catalog',  proxy('catalog',  SERVICES.catalog));
app.use('/orders',   proxy('orders',   SERVICES.orders));
app.use('/payments', proxy('payments', SERVICES.payments));

// ─── 404 fallback ─────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    error: 'route not found',
    availableRoutes: ['/health', '/auth/*', '/catalog/*', '/orders/*', '/payments/*'],
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[gateway] listening on :${PORT}`);
  console.log('[gateway] routes:');
  Object.entries(SERVICES).forEach(([name, url]) => {
    console.log(`  /${name}/* → ${url}`);
  });
});
