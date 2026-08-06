# WhatsApp Automation — Frontend

React + Vite + TypeScript + Tailwind + shadcn-style components + TanStack Query + Sonner toasts.

## Setup
```bash
npm install
npm run dev      # http://localhost:5173 (proxies /api -> :4000)
```

## Production build
```bash
npm run build
npm run preview
```

Default login (after backend seed): phone `15550000001`. No password — a one-time
code, shown on the login page while `OTP_ECHO=true` is set in `backend/.env`.

## Notes
- Auth token stored in `localStorage` (key: `token`) and sent on every API call.
- Inbox / Orders use TanStack Query polling (`refetchInterval`) every 5s.
- WhatsApp Embedded Signup page launches FB.login via the Facebook JS SDK; for local dev a manual-credential form is provided.
