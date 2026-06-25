# WhatsApp Automation — Backend

Node.js + Express + Prisma + Postgres. ES modules. MVC.

## Setup
```bash
cp .env.example .env       # fill in DATABASE_URL, JWT_SECRET, META_* values
npm install
npx prisma migrate dev --name init
npm run prisma:seed        # creates demo tenant: owner@demo.com / Password123!
npm run dev
```

Server starts on `http://localhost:4000`. Health check at `/health`.

## Key endpoints
- `POST   /api/auth/signup`
- `POST   /api/auth/login`
- `GET    /api/auth/me`
- `GET    /api/tenant/me`
- `POST   /api/whatsapp/embedded-signup`     ← Module 2
- `GET/POST /api/webhook`                    ← Meta webhook
- `GET/POST/PATCH/DELETE /api/automation/keywords`
- `GET/PUT /api/automation/fallback`
- `GET    /api/inbox/conversations`
- `POST   /api/inbox/conversations/:id/messages`
- `POST   /api/inbox/conversations/:id/automation`   ← human takeover toggle
- `GET/POST/PATCH/DELETE /api/menu/{categories,items,addon-groups}`
- `GET    /api/orders` / `PATCH /api/orders/:id/status`
- `GET/PUT /api/templates`
- `GET    /api/customers`
- `GET    /api/analytics/overview`

## Webhook
Set Meta webhook URL to `https://<your-domain>/api/webhook` with verify token from `META_WEBHOOK_VERIFY_TOKEN`.
