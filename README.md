# Mostawdaee (مستودعي)

Warehouse, point-of-sale and accounting app for small merchants. Web (PWA) and Android (Capacitor), Arabic and English.

- Frontend: React 19, Vite, Tailwind CSS 4
- Data: Supabase (`merchant_documents` table, writes through the `merchant_commit` RPC)
- Server: Express (`server.ts`) for the AI assistant and Google Play subscription verification
- Mobile: Capacitor 8, Android package `com.mostawdaee.app`

## Requirements

- Node.js 22
- A Supabase project
- Android Studio / JDK 21 for Android builds

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in the values. Never commit `.env`.
3. In the Supabase SQL editor, run in order:
   1. `supabase_production_setup.sql`
   2. `supabase_cheques.sql`
   3. `supabase_inventory_audit.sql`

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Dev server with Vite middleware |
| `npm run lint` | Type check |
| `npm test` | Unit tests (Vitest) |
| `npm run build` | Build the web app to `dist/` and the server to `server-dist/` |
| `npm start` | Run the production server |
| `npm run android:sync` | Build and copy the web app into the Android project |

## Subscriptions

Premium access is granted only by the server after verifying a Google Play purchase (`/api/subscription/activate`, `/api/subscription/sync`) with `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`. Real-time developer notifications arrive on `/api/play/rtdn` (Pub/Sub push, audience `PLAY_RTDN_AUDIENCE`). The client never unlocks premium on its own.

## Release

Android release bundles are built in CI (`.github/workflows/final-build.yml`). The version code is passed with `-PversionCode`; bump `versionName` in `android/app/build.gradle` and `version` in `package.json` together.
