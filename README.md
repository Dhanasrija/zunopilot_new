# WhatsApp Business Automation Platform

A multi-tenant WhatsApp automation platform for small businesses and restaurants.

## Tech stack
- **Backend**: Node.js + Express, ES modules, Prisma ORM, PostgreSQL, JWT auth, express-validator, Winston logger, global error handling
- **Frontend**: React + Vite + TypeScript, Tailwind + shadcn-style components, TanStack Query (polling), Sonner toasts

## Modules covered
1. Tenant onboarding (signup, business profile, staff list)
2. WhatsApp Embedded Signup v4 (Meta integration + token storage)
3. Webhook engine (inbound text / media / interactive payloads)
4. Keyword & fallback automation
5. Shared inbox + human takeover toggle + internal notes
6. Menu management (categories, items, add-on groups)
7. Structured ordering flow over WhatsApp interactive components (list + buttons + stateful cart)
8. Order management with status state machine
9. Order status → utility template dispatch
10. Customer CRM with order history + lifetime spend
11. Core analytics dashboard

## Quick start

### 1. Backend
```bash
cd backend
cp .env.example .env
# Edit .env: DATABASE_URL, JWT_SECRET, META_* values
npm install
npx prisma migrate dev --name init
npm run prisma:seed     # creates demo tenant
npm run dev
```

Backend runs on `http://localhost:4000`.

### 2. Frontend
```bash
cd ../frontend
npm install
npm run dev             # http://localhost:5173
```

Login with **owner@demo.com / Password123!**

### 3. WhatsApp webhook
Configure Meta to call `POST /api/webhook` with verify token from `META_WEBHOOK_VERIFY_TOKEN`. Use ngrok / Cloudflare tunnel for local testing.

## Project layout
```
whatsapp_automation/
├── backend/
│   ├── prisma/             # schema.prisma + seed.js
│   └── src/
│       ├── config/         # env, prisma, logger
│       ├── middleware/     # auth, validate, errorHandler
│       ├── controllers/    # MVC controllers
│       ├── routes/         # express routers
│       ├── services/       # whatsapp / automation / ordering / templates
│       ├── validators/     # express-validator chains
│       ├── utils/          # ApiError, asyncHandler, jwt
│       ├── app.js          # express app builder
│       └── server.js       # entry
└── frontend/
    ├── src/
    │   ├── components/ui/  # shadcn-style primitives
    │   ├── components/layout/
    │   ├── pages/          # one per module
    │   ├── lib/            # api client, utils
    │   ├── stores/         # zustand auth store
    │   ├── App.tsx
    │   └── main.tsx
    └── vite.config.ts
```

## Notes
- This is the MVP scaffold. Production deployment additionally needs: HTTPS, persistent media storage for WhatsApp media IDs, encrypted-at-rest access tokens, webhook signature verification (X-Hub-Signature-256), email delivery for verification, and template-approval workflow with Meta.
- The ordering flow honours Meta's UI limits (list rows ≤ 10, button reply ≤ 3 — quick-quantity uses 1/2/3 with a follow-up message expected for higher quantities).
