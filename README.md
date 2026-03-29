# Barakaya — Microservices Demo

A production-ready microservices e-commerce platform built to showcase DevOps practices:
multi-stage Docker builds, Docker Compose orchestration with health checks, GitHub Actions CI/CD, and Kubernetes deployment manifests.

## Architecture

```
                     ┌─────────────────────────────────────────────┐
         HTTP        │              API Gateway :8080               │
Client ──────────────►  /auth/*  /catalog/*  /orders/*  /payments/* │
                     └──────┬───────────┬──────────┬────────┬──────┘
                            │           │          │        │
                     ┌──────▼──┐  ┌─────▼──┐  ┌───▼────┐  ┌▼───────────┐
                     │  Auth   │  │Catalog │  │ Orders │  │  Payments  │
                     │  :3001  │  │  :3002 │  │  :3003 │  │   :3004    │
                     │ SQLite  │  │ SQLite │  │ SQLite │  │  SQLite    │
                     └─────────┘  └────────┘  └───┬────┘  └────────────┘
                                                   │ calls catalog & payments
```

## Services

| Service  | Port | Description |
|----------|------|-------------|
| gateway  | 8080 | Reverse proxy — single entry point for all clients |
| auth     | 3001 | Register, login, JWT token issuance & verification |
| catalog  | 3002 | Product CRUD with auto-seeded demo data |
| orders   | 3003 | Order creation, status tracking (JWT-protected) |
| payments | 3004 | Simulated payment processing |

## Quick Start

### Prerequisites
- Docker ≥ 24
- Docker Compose ≥ 2.20

### Run locally

```bash
cp .env.example .env
docker compose up --build
```

The gateway is available at **http://localhost:8080**.

## API Reference

All requests go through the gateway (`http://localhost:8080`).

### Auth
```
POST   /auth/register          { email, password }
POST   /auth/login             { email, password }
POST   /auth/verify            { token } or Authorization: Bearer <token>
GET    /auth/profile           Authorization: Bearer <token>
```

### Catalog
```
GET    /catalog/products                       list (optional ?category=&search=)
GET    /catalog/products/:id
POST   /catalog/products       { name, description, price, stock, category }
PUT    /catalog/products/:id   partial update
DELETE /catalog/products/:id
```

### Orders  _(requires Bearer token)_
```
GET    /orders                                 list user's orders
GET    /orders/:id
POST   /orders                 { items: [{ productId, quantity }] }
PATCH  /orders/:id/status      { status: pending|confirmed|shipped|delivered|cancelled }
```

### Payments
```
POST   /payments/payments      { orderId, amount, method? }
GET    /payments/payments/:id
GET    /payments/payments/order/:orderId
PATCH  /payments/payments/:id  { status: pending|paid|refunded|failed }
```

### Health checks
```
GET    /health                 gateway status
GET    /auth/health
GET    /catalog/health
GET    /orders/health
GET    /payments/health
```

## Example Flow

```bash
# 1. Register
TOKEN=$(curl -s -X POST http://localhost:8080/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"secret123"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

# 2. Browse products
curl http://localhost:8080/catalog/products

# 3. Place an order (replace <product-id> with a real ID from step 2)
curl -X POST http://localhost:8080/orders \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"items":[{"productId":"<product-id>","quantity":2}]}'
```

## CI/CD

GitHub Actions workflow (`.github/workflows/ci.yml`):

| Stage | Trigger | Action |
|-------|---------|--------|
| Lint | every push / PR | syntax check for all services |
| Build | after lint | Docker build (no push) for each service |
| Smoke Test | after build | `docker compose up`, run curl health & API checks, then tear down |
| Push | push to `main`/`master` | build + push all images to GHCR with `sha` and `latest` tags |

## Kubernetes

Manifests in `k8s/` are ready to apply to any Kubernetes cluster:

```bash
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/secrets.yaml      # edit JWT_SECRET first!
kubectl apply -f k8s/auth.yaml
kubectl apply -f k8s/catalog.yaml
kubectl apply -f k8s/payments.yaml
kubectl apply -f k8s/orders.yaml
kubectl apply -f k8s/gateway.yaml
```

Each service has:
- **Deployment** with liveness + readiness probes
- **Service** (ClusterIP for internal; LoadBalancer for gateway)
- **PersistentVolumeClaim** for SQLite data
- **HorizontalPodAutoscaler** on the gateway (2–6 replicas at 70% CPU)

## Tech Stack

- **Runtime**: Node.js 20 (Alpine)
- **Framework**: Express 4
- **ORM**: Prisma 5 + SQLite
- **Auth**: JWT (jsonwebtoken) + bcryptjs
- **Gateway**: http-proxy-middleware
- **Containers**: Docker multi-stage builds
- **Orchestration**: Docker Compose / Kubernetes
- **CI/CD**: GitHub Actions → GHCR
