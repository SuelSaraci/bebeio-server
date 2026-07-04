# Bebio API

Backend for the Bebio baby tracking app. Auth and database setup mirror the reference `server/` project: **Firebase** for login/signup and **PostgreSQL on Railway** for data storage.

**Bebio Plus** subscriptions are handled via **Paddle on the website** (same pattern as code-interview-app). The API stores subscription status and exposes it to the mobile app.

## Setup

```bash
cd bebio-api
npm install
cp .env.example .env
```

### Railway PostgreSQL

1. Create a Postgres service in [Railway](https://railway.app).
2. Copy `DATABASE_URL` from **Connect** into `.env`.
3. Keep `DB_SSL=true` for Railway.

### Firebase Admin

Use the same Firebase project as the mobile app:

- Set `FIREBASE_PROJECT_ID`, `FIREBASE_PRIVATE_KEY`, and `FIREBASE_CLIENT_EMAIL`, or
- Set `FIREBASE_SERVICE_ACCOUNT_JSON` to the full service account JSON (single line).

## Run

```bash
npm run dev    # watch mode
npm start      # production
npm run migrate
```

Default port: **5002** (reference server uses 5001).

## Auth flow

Login and signup happen in the mobile app via **Firebase Auth**. The API verifies the Firebase ID token on protected routes:

```
Authorization: Bearer <firebase-id-token>
```

`GET /api/auth/verify` — validates token, upserts user in Postgres, returns `{ user }`.

## API routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/api/auth/verify` | Verify Firebase token |
| GET/PUT | `/api/profile` | Parent profile (name, onboarding) |
| GET/PUT | `/api/baby` | Baby profile setup |
| GET/POST/DELETE | `/api/feedings` | Feeding logs |
| GET/POST/DELETE | `/api/sleep` | Sleep sessions |
| GET/POST/DELETE | `/api/diapers` | Diaper changes |
| GET/POST/DELETE | `/api/growth` | Growth measurements |
| GET/PUT | `/api/health/vaccinations` | Vaccination schedule |
| POST | `/api/health/vaccinations/bulk` | Replace all vaccinations |
| GET/POST | `/api/health/appointments` | Appointments |
| POST | `/api/health/appointments/bulk` | Replace all appointments |
| GET/POST/DELETE | `/api/health/notes` | Medical notes |
| GET/PUT | `/api/milestones` | Development milestones |
| POST | `/api/ai/chat` | AI assistant |
| POST | `/api/subscriptions/create` | Create Paddle checkout (`{ plan: "monthly" \| "yearly" }`) |
| GET | `/api/subscriptions/status` | Subscription status (`hasPremium`) |
| POST | `/paddle/webhook` | Paddle webhooks (also `/api/webhooks/paddle`) |

## Deploy (Railway)

1. Add a new service from this repo folder.
2. Set env vars: `DATABASE_URL`, Firebase credentials, `NODE_ENV=production`.
3. Start command: `npm start` (migrations run on boot).
