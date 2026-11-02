import express from "express";
import helmet from "helmet";
import compression from "compression";
import path from "path";
import fs from "fs";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { GoogleAuth, OAuth2Client } from "google-auth-library";
import { fileURLToPath } from "url";
import { isVerifiedAdmin } from "./src/lib/adminAccess";
import { type PlatformAction, type PlatformRole, SUPPORT_GRACE_DAYS, isPlatformRole, staffCan } from "./src/lib/platformStaff";
import {
  MAX_SUBSCRIPTION_GRANT_DAYS,
  SUBSCRIPTION_DAY_MS,
  TRIAL_DAYS,
  subscriptionWindow,
  trialStartForEnd,
} from "./src/lib/subscriptionAccess";
import { PlayTokenState, isEntitled, reconcilePlaySubscription } from "./src/lib/playEntitlement";
import {
  ASSISTANT_LIMITS,
  buildSystemInstruction,
  sanitizeAssistantAction,
  sanitizeContext,
  sanitizeHistory,
} from "./src/lib/assistantContext";
import {
  ACCOUNT_DELETION_PATH,
  PRIVACY_PATH,
  type PolicyDoc,
  accountDeletionInfo,
  privacyPolicy,
  renderPolicyHtml,
} from "./src/lib/privacyPolicy";
import {
  JOFOTARA_ENDPOINT,
  type JoFotaraSeller,
  buildJoFotaraXml,
  isJoFotaraIncomeSource,
  isJoFotaraTin,
  joFotaraFromInvoice,
  joFotaraRequestBody,
  readJoFotaraResponse,
} from "./src/lib/jofotara";
import {
  encodeZatcaTlv,
  formatZatcaAmount,
  isZatcaVatNumber,
} from "./src/lib/zatcaTlv";
import { openSecret, parseSecretKey, sealSecret } from "./src/lib/secretBox";
import type { Invoice } from "./src/types";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Determine production mode robustly based on environment variable or the executed bundler file path
const isProduction = process.env.NODE_ENV === "production" || 
                     __filename.endsWith("server.js") || 
                     __filename.includes("dist") ||
                     !fs.existsSync(path.resolve(process.cwd(), 'src/main.tsx'));

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash";
// Every question resends the store data (up to ~25k tokens), so each store gets a daily allowance.
const AI_DAILY_QUESTIONS_PER_STORE = (() => {
  const n = Number(process.env.AI_DAILY_QUESTIONS_PER_STORE);
  return Number.isInteger(n) && n >= 0 ? n : 20;
})();

// Lazy initialization of Gemini
let ai: GoogleGenAI | null = null;
function getAI() {
  if (!ai) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn("GEMINI_API_KEY is missing. Smart features will be disabled.");
      return null;
    }
    ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
  return ai;
}

function getSupabaseAnonClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return createClient(url, anonKey);
}

function getSupabaseServiceClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Must match Google Play Console SKU and src/services/billing.ts PLAY_PREMIUM_PRODUCT_ID. Billed amount is set in Play Console (USD 119/year). */
const PLAY_PRODUCT_ID = "mostawdaee_premium_100";
const PLAY_PACKAGE_NAME = process.env.GOOGLE_PLAY_PACKAGE_NAME || "com.mostawdaee.app";

type PlayFetch =
  | {
      ok: true;
      state: string;
      expiry: string | null;
      acknowledged: boolean;
      linkedPurchaseToken: string | null;
    }
  | { ok: false; status: number; message: string };

let playAuth: GoogleAuth | null = null;

async function playAccessToken(): Promise<string | { status: number; message: string }> {
  const raw = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    console.error("[Play] GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is not configured");
    return { status: 503, message: "Play billing verification is unavailable" };
  }
  if (!playAuth) {
    let credentials: any;
    try {
      credentials = JSON.parse(raw);
    } catch {
      console.error("[Play] GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is not valid JSON");
      return { status: 503, message: "Play billing verification is unavailable" };
    }
    playAuth = new GoogleAuth({ credentials, scopes: ["https://www.googleapis.com/auth/androidpublisher"] });
  }
  const token = (await (await playAuth.getClient()).getAccessToken()).token;
  return token || { status: 502, message: "Could not obtain a Google Play API token" };
}

/** Reads a purchase token's current state from the Google Play Developer API (never trust the client). */
async function fetchPlaySubscription(purchaseToken: string): Promise<PlayFetch> {
  try {
    const accessToken = await playAccessToken();
    if (typeof accessToken !== "string") return { ok: false, ...accessToken };

    const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(PLAY_PACKAGE_NAME)}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (response.status === 404 || response.status === 400 || response.status === 410) {
      return { ok: false, status: 400, message: "Purchase token was not found in Google Play" };
    }
    if (!response.ok) {
      return { ok: false, status: 502, message: `Google Play verification failed (${response.status})` };
    }

    const data: any = await response.json();
    const line = (data?.lineItems || []).find((item: any) => item?.productId === PLAY_PRODUCT_ID);
    if (!line) {
      return { ok: false, status: 400, message: "Purchase token does not belong to the premium product" };
    }
    const expiryMs = Date.parse(line.expiryTime || "");
    return {
      ok: true,
      state: String(data?.subscriptionState || ""),
      expiry: Number.isFinite(expiryMs) ? new Date(expiryMs).toISOString() : null,
      acknowledged: data?.acknowledgementState === "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED",
      linkedPurchaseToken: data?.linkedPurchaseToken || null,
    };
  } catch (error: any) {
    console.error("[Play verification]", error?.message || error);
    return { ok: false, status: 502, message: "Google Play verification error" };
  }
}

/** Google refunds purchases that stay unacknowledged for 3 days, so the server acknowledges once access is granted. */
async function acknowledgePlaySubscription(purchaseToken: string) {
  const accessToken = await playAccessToken();
  if (typeof accessToken !== "string") return;
  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(PLAY_PACKAGE_NAME)}/purchases/subscriptions/${encodeURIComponent(PLAY_PRODUCT_ID)}/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`;
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!response.ok && response.status !== 400) {
    console.warn(`[Play acknowledge] failed (${response.status})`);
  }
}

type ServiceClient = NonNullable<ReturnType<typeof getSupabaseServiceClient>>;

/**
 * Re-reads every Play token the account owns from Google and writes the resulting paid window.
 * Covers first purchase, renewals, cancellation, grace, refunds and revocations.
 */
async function syncPlayEntitlement(service: ServiceClient, userId: string) {
  const { data: rows, error } = await service
    .from("play_purchases")
    .select("purchase_token, expiry_time")
    .eq("user_id", userId);
  if (error) throw new Error(`play_purchases table is not available: ${error.message}`);
  if (!rows?.length) return null;

  const tokens: PlayTokenState[] = [];
  for (const row of rows) {
    const result = await fetchPlaySubscription(row.purchase_token);
    if (result.ok === false) {
      if (result.status === 400) {
        tokens.push({ state: "SUBSCRIPTION_STATE_EXPIRED", expiry: null, previousExpiry: row.expiry_time });
        continue;
      }
      // Google is unreachable: change nothing rather than revoke or grant on partial data.
      throw Object.assign(new Error(result.message), { status: result.status });
    }
    tokens.push({ state: result.state, expiry: result.expiry, previousExpiry: row.expiry_time });
    await service.from("play_purchases").update({
      state: result.state,
      expiry_time: result.expiry,
      linked_purchase_token: result.linkedPurchaseToken,
      updated_at: new Date().toISOString(),
    }).eq("purchase_token", row.purchase_token);
    if (!result.acknowledged && isEntitled({ state: result.state, expiry: result.expiry })) {
      await acknowledgePlaySubscription(row.purchase_token).catch(() => {});
    }
  }

  const { data: current, error: currentError } = await service
    .from("user_subscriptions")
    .select("subscription_status, expiry_date")
    .eq("user_id", userId)
    .maybeSingle();
  if (currentError) throw new Error(currentError.message);

  const change = reconcilePlaySubscription(
    current ? { status: current.subscription_status, expiry: current.expiry_date } : null,
    tokens,
  );
  if (change) {
    const { error: writeError } = await service.from("user_subscriptions").upsert({
      user_id: userId,
      subscription_status: change.status,
      expiry_date: change.expiry,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (writeError) throw new Error(writeError.message);
    await service.from("profiles").update({
      is_premium: change.status === "active",
      subscription_status: change.status,
      updated_at: new Date().toISOString(),
    }).eq("id", userId);
  }
  return change;
}

async function getRequestUser(req: { headers: { authorization?: string } }) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return null;
  const client = getSupabaseAnonClient();
  if (!client) return null;
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function presentSubscriber(authUser: any, profile: any, sub: any) {
  const status = sub?.subscription_status || "trial";
  const trialStart = sub?.trial_start_date || authUser?.created_at || null;
  const expiry = sub?.expiry_date || null;
  const access = subscriptionWindow({ status, trialStart, expiry });
  return {
    id: authUser?.id || profile?.id,
    email: authUser?.email || "",
    displayName: profile?.user_name || authUser?.user_metadata?.full_name || "",
    businessName: profile?.business_name || authUser?.user_metadata?.business_name || "",
    role: isVerifiedAdmin(authUser) ? "founder" : "user",
    status: access.kind === "paid" ? "active" : access.kind === "trial" ? "trial" : "expired",
    trialStart,
    expiry,
    endsAt: access.endsAt ? new Date(access.endsAt).toISOString() : null,
    daysRemaining: access.daysRemaining,
  };
}

async function listAuthUsers(service: ReturnType<typeof getSupabaseServiceClient>) {
  const users: any[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await service!.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const batch = data?.users || [];
    users.push(...batch);
    if (batch.length < 200) break;
  }
  return users;
}

async function startServer() {
  const app = express();
  // Express 4 ignores a rejected async handler: the request would hang until the client gives up.
  for (const method of ["get", "post"] as const) {
    const register = app[method].bind(app) as (...args: any[]) => any;
    (app as any)[method] = (...args: any[]) => register(...args.map((handler) => (typeof handler !== "function" ? handler
      : (req: any, res: any, next: any) => {
          try {
            const result = handler(req, res, next);
            if (result && typeof result.catch === "function") result.catch(next);
            return result;
          } catch (error) {
            next(error);
          }
        })));
  }
  const PORT = process.env.PORT || 3000;
  if (isProduction) app.set("trust proxy", 1); // real client IP behind a reverse proxy

  app.disable("x-powered-by");
  // Real CSP: self + Supabase + Google (sign-in / Drive). Vite HMR extras only outside production.
  const supabaseOrigin = (() => {
    try {
      const raw = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
      return raw ? new URL(raw).origin : "";
    } catch {
      return "";
    }
  })();
  const connectSrc = [
    "'self'",
    "https://*.supabase.co",
    "wss://*.supabase.co",
    "https://accounts.google.com",
    "https://oauth2.googleapis.com",
    "https://www.googleapis.com",
    "https://www.google.com",
    ...(supabaseOrigin ? [supabaseOrigin, supabaseOrigin.replace("https://", "wss://")] : []),
    ...(!isProduction ? ["ws://localhost:*", "ws://127.0.0.1:*", "http://localhost:*", "http://127.0.0.1:*"] : []),
  ];
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        "default-src": ["'self'"],
        "base-uri": ["'self'"],
        "object-src": ["'none'"],
        "frame-ancestors": ["'none'"],
        "form-action": ["'self'", "https://accounts.google.com"],
        "script-src": isProduction
          ? ["'self'"]
          : ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
        "style-src": ["'self'", "'unsafe-inline'"],
        "img-src": ["'self'", "data:", "blob:", "https:"],
        "font-src": ["'self'", "data:"],
        "connect-src": connectSrc,
        "frame-src": ["'self'", "https://accounts.google.com", "https://*.google.com"],
        "worker-src": ["'self'", "blob:"],
        "media-src": ["'self'", "blob:"],
      },
    },
    crossOriginEmbedderPolicy: false,
    // Google sign-in popups need to talk back to this window.
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
    hsts: isProduction ? { maxAge: 15552000, includeSubDomains: true } : false,
  }));
  app.use(compression());

  // Add robust but clean request logging (API and primary navigation only)
  app.use((req, res, next) => {
    const url = req.url;
    const isApi = url.startsWith('/api/');
    const isHtml = req.headers.accept && req.headers.accept.includes('text/html');
    const hasExtension = path.extname(url.split('?')[0]) !== '';

    if (isApi || (isHtml && !hasExtension && !url.includes('__vite') && !url.includes('hot'))) {
      console.log(`[Express Server] Incoming request: ${req.method} ${url.split("?")[0]}`);
    }
    next();
  });

  // CORS: the Capacitor app runs on https://localhost (Android) / capacitor://localhost (iOS)
  // and calls this API cross-origin. Extra origins can be added via ALLOWED_ORIGINS (comma separated).
  const allowedOrigins = new Set([
    "https://localhost",
    "http://localhost",
    "capacitor://localhost",
    "ionic://localhost",
    ...String(process.env.ALLOWED_ORIGINS || "").split(",").map((o) => o.trim()).filter(Boolean),
  ]);
  app.use("/api", (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && (allowedOrigins.has(origin) || /^http:\/\/localhost:\d+$/.test(origin))) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, Cache-Control, Pragma, Expires");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Max-Age", "86400");
    }
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  app.use(express.json({ limit: "2mb" }));

  // Tiny in-memory rate limiter (per user id or IP) to protect paid endpoints
  const rateBuckets = new Map<string, { count: number; resetAt: number }>();
  const rateLimit = (key: string, max: number, windowMs: number) => {
    const now = Date.now();
    const bucket = rateBuckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    bucket.count += 1;
    return bucket.count <= max;
  };
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of rateBuckets) if (v.resetAt <= now) rateBuckets.delete(k);
  }, 60_000).unref();

  // Health Check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Public pages Google Play links to; they must open without the app or a sign-in.
  const policyPage = (route: string, build: (ar: boolean) => PolicyDoc) => (req: express.Request, res: express.Response) => {
    const ar = req.query.lang !== "en";
    res.type("html").set("Cache-Control", "public, max-age=3600")
      .send(renderPolicyHtml(build(ar), ar, ar ? `${route}?lang=en` : route));
  };
  app.get(PRIVACY_PATH, policyPage(PRIVACY_PATH, privacyPolicy));
  app.get(ACCOUNT_DELETION_PATH, policyPage(ACCOUNT_DELETION_PATH, accountDeletionInfo));

  app.post("/api/subscription/activate", async (req, res) => {
    try {
      if (!rateLimit(`activate:${req.ip}`, 10, 60_000)) {
        return res.status(429).json({ message: "Too many requests" });
      }
      const user = await getRequestUser(req);
      if (!user) {
        return res.status(401).json({ message: "Invalid or missing Supabase session" });
      }

      const productId = String(req.body?.productId || "");
      const purchaseToken = String(req.body?.purchaseToken || "");
      const platform = String(req.body?.platform || "");

      if (productId !== PLAY_PRODUCT_ID || platform !== "play") {
        return res.status(400).json({ message: "Unsupported product or platform" });
      }

      if (
        !purchaseToken ||
        purchaseToken.startsWith("simulated_") ||
        purchaseToken.startsWith("token_")
      ) {
        return res.status(400).json({ message: "Rejected simulated or empty purchase token" });
      }

      const service = getSupabaseServiceClient();
      if (!service) {
        return res.status(503).json({ message: "Billing is not configured" });
      }

      // 1. Verify the purchase with Google Play (fails closed)
      const verification = await fetchPlaySubscription(purchaseToken);
      if (verification.ok === false) {
        return res.status(verification.status).json({ message: verification.message });
      }
      if (!isEntitled({ state: verification.state, expiry: verification.expiry })) {
        return res.status(402).json({ message: `Subscription is not active (${verification.state || "unknown"})` });
      }

      // 2. A purchase token can only ever belong to ONE account (blocks sharing/replaying a valid token)
      const { data: existingPurchase, error: lookupError } = await service
        .from("play_purchases")
        .select("user_id")
        .eq("purchase_token", purchaseToken)
        .maybeSingle();
      if (lookupError) {
        console.error("[Subscription activate] play_purchases lookup failed", lookupError.message);
        return res.status(503).json({ message: "Purchase records are not available on the server" });
      }
      if (existingPurchase && existingPurchase.user_id !== user.id) {
        return res.status(409).json({ message: "This purchase is already linked to another account" });
      }
      // Re-subscribe / replace: the new token must stay with the account that owns the linked prior token.
      if (!existingPurchase && verification.linkedPurchaseToken) {
        const { data: linkedOwner, error: linkedError } = await service
          .from("play_purchases")
          .select("user_id")
          .eq("purchase_token", verification.linkedPurchaseToken)
          .maybeSingle();
        if (linkedError) {
          console.error("[Subscription activate] linked token lookup failed", linkedError.message);
          return res.status(503).json({ message: "Purchase records are not available on the server" });
        }
        if (!linkedOwner?.user_id) {
          return res.status(409).json({
            message: "This purchase replaces another that is not linked yet. Open the original account first, or wait and try again.",
          });
        }
        if (linkedOwner.user_id !== user.id) {
          return res.status(409).json({ message: "This purchase is already linked to another account" });
        }
      }
      if (!existingPurchase) {
        const { error: insertError } = await service.from("play_purchases").insert({
          purchase_token: purchaseToken,
          user_id: user.id,
          product_id: productId,
        });
        if (insertError) {
          console.error("[Subscription activate] link failed", insertError.message);
          return res.status(500).json({ message: "Could not link the purchase to this account" });
        }
      }

      // 3. Grant from Google's state across all of this account's tokens, then acknowledge.
      await syncPlayEntitlement(service, user.id);
      const { data: sub } = await service
        .from("user_subscriptions")
        .select("subscription_status, expiry_date")
        .eq("user_id", user.id)
        .maybeSingle();
      return res.json({ ok: true, status: sub?.subscription_status, expiry_date: sub?.expiry_date });
    } catch (error: any) {
      console.error("[Subscription activate]", error?.message || error);
      return res.status(error?.status || 500).json({ message: "Activation failed" });
    }
  });

  // Re-checks the account's Play purchases (renewals, refunds). Safe to call on every app start.
  app.post("/api/subscription/sync", async (req, res) => {
    try {
      const user = await getRequestUser(req);
      if (!user) return res.status(401).json({ message: "Invalid or missing Supabase session" });
      if (!rateLimit(`sync:${user.id}`, 6, 60_000)) {
        return res.status(429).json({ message: "Too many requests" });
      }
      const service = getSupabaseServiceClient();
      if (!service) return res.status(503).json({ message: "Billing is not configured" });
      const change = await syncPlayEntitlement(service, user.id);
      return res.json({ ok: true, changed: !!change });
    } catch (error: any) {
      console.error("[Subscription sync]", error?.message || error);
      return res.status(error?.status || 500).json({ message: "Subscription sync failed" });
    }
  });

  // Deletes the signed-in account. An owner's store data cascades with it; a member only leaves the store.
  // The caller retypes the account email; a Google Play subscription is cancelled in Play, not here.
  app.post("/api/account/delete", async (req, res) => {
    try {
      const user = await getRequestUser(req);
      if (!user) return res.status(401).json({ code: "sign_in_required", message: "Sign in again to delete the account" });
      if (!rateLimit(`delete:${user.id}`, 3, 10 * 60_000)) {
        return res.status(429).json({ code: "rate_limited", message: "Too many requests" });
      }
      const typed = typeof req.body?.confirmEmail === "string" ? req.body.confirmEmail.trim().toLowerCase() : "";
      if (!user.email || typed !== user.email.trim().toLowerCase()) {
        return res.status(400).json({ code: "confirm_mismatch", message: "The typed email does not match this account" });
      }
      if (isVerifiedAdmin(user)) {
        return res.status(403).json({ code: "founder_account", message: "The founder account cannot be deleted" });
      }
      const service = getSupabaseServiceClient();
      if (!service) return res.status(503).json({ code: "not_configured", message: "Account deletion is not configured on the server" });

      const prepared = await service.rpc("account_delete_prepare", { p_user: user.id });
      if (prepared.error) {
        if (/cannot delete the founder/.test(prepared.error.message)) {
          return res.status(403).json({ code: "founder_account", message: "The founder account cannot be deleted" });
        }
        throw new Error(prepared.error.message);
      }
      const { error } = await service.auth.admin.deleteUser(user.id);
      if (error) throw new Error(error.message);
      return res.json({ ok: true });
    } catch (error: any) {
      console.error("[Account delete]", error?.message || error);
      return res.status(500).json({ code: "delete_failed", message: "The account could not be deleted" });
    }
  });

  // Google Play Real-time Developer Notifications (Pub/Sub push with an OIDC token).
  app.post("/api/play/rtdn", async (req, res) => {
    const audience = process.env.PLAY_RTDN_AUDIENCE;
    // Any Google service account can mint a token for any audience, so the sender must be pinned too.
    const expectedSender = process.env.PLAY_RTDN_SERVICE_ACCOUNT;
    if (!audience || !expectedSender) {
      return res.status(503).json({ message: "PLAY_RTDN_AUDIENCE and PLAY_RTDN_SERVICE_ACCOUNT must be configured" });
    }
    if (!rateLimit(`rtdn:${req.ip}`, 120, 60_000)) return res.sendStatus(429);
    try {
      const header = req.headers.authorization || "";
      const idToken = header.startsWith("Bearer ") ? header.slice(7) : "";
      if (!idToken) return res.sendStatus(401);
      const ticket = await new OAuth2Client().verifyIdToken({ idToken, audience });
      const claims = ticket.getPayload();
      if (!claims?.email_verified || claims.email !== expectedSender) {
        return res.sendStatus(403);
      }
    } catch {
      return res.sendStatus(401);
    }

    try {
      const raw = Buffer.from(String(req.body?.message?.data || ""), "base64").toString("utf8");
      const notification = raw ? JSON.parse(raw) : null;
      if (notification?.packageName && notification.packageName !== PLAY_PACKAGE_NAME) return res.sendStatus(204);
      const purchaseToken = String(
        notification?.subscriptionNotification?.purchaseToken
          || notification?.voidedPurchaseNotification?.purchaseToken
          || "",
      );
      if (!purchaseToken) return res.sendStatus(204);

      const service = getSupabaseServiceClient();
      if (!service) return res.sendStatus(503);
      const { data: owner } = await service
        .from("play_purchases")
        .select("user_id")
        .eq("purchase_token", purchaseToken)
        .maybeSingle();
      let userId = owner?.user_id as string | undefined;
      if (!userId) {
        // A re-subscription carries a new token linked to one we already know.
        const fetched = await fetchPlaySubscription(purchaseToken);
        if (fetched.ok && fetched.linkedPurchaseToken) {
          const { data: linked } = await service
            .from("play_purchases")
            .select("user_id")
            .eq("purchase_token", fetched.linkedPurchaseToken)
            .maybeSingle();
          if (linked?.user_id) {
            userId = linked.user_id;
            await service.from("play_purchases").upsert({
              purchase_token: purchaseToken,
              user_id: userId,
              product_id: PLAY_PRODUCT_ID,
            }, { onConflict: "purchase_token", ignoreDuplicates: true });
          }
        }
      }
      // Unknown token: the app links it on activation, so there is nothing to update yet.
      if (!userId) return res.sendStatus(204);
      await syncPlayEntitlement(service, userId);
      return res.sendStatus(204);
    } catch (error: any) {
      console.error("[Play RTDN]", error?.message || error);
      // A 5xx makes Pub/Sub redeliver the notification.
      return res.sendStatus(500);
    }
  });

  // Platform console: the founder and the staff in platform_staff. The database re-checks the role
  // in every admin_* / support_staff_* function, so a bug here cannot widen anyone's rights.
  async function requireStaff(req: any, res: any, action: PlatformAction | null) {
    const user = await getRequestUser(req);
    if (!user) {
      res.status(401).json({ message: "يجب تسجيل الدخول" });
      return null;
    }
    if (!user.email_confirmed_at) {
      res.status(403).json({ message: "أكّد بريدك الإلكتروني أولاً" });
      return null;
    }
    const service = getSupabaseServiceClient();
    if (!service) {
      res.status(503).json({ message: "مفتاح الخدمة غير مضبوط على الخادم، ولن يُمنح اشتراك من المتصفح" });
      return null;
    }
    if (!rateLimit(`admin:${user.id}`, 60, 60_000)) {
      res.status(429).json({ message: "محاولات كثيرة، انتظر دقيقة" });
      return null;
    }
    let role: PlatformRole | null = isVerifiedAdmin(user) ? "founder" : null;
    if (!role) {
      const { data, error } = await service.rpc("platform_role_of", { p_user: user.id });
      if (error) {
        console.error("[Admin] staff check failed", error.message);
        res.status(503).json({ message: "تعذر التحقق من صلاحيات الفريق. شغّل ملف supabase_production_setup.sql" });
        return null;
      }
      role = isPlatformRole(data) ? data : null;
    }
    if (!role) {
      res.status(403).json({ message: "هذه اللوحة لفريق مستودعي فقط" });
      return null;
    }
    if (action && !staffCan(role, action)) {
      res.status(403).json({ message: "صلاحيتك لا تسمح بهذا الإجراء" });
      return null;
    }
    return { user, service, role };
  }

  // Database refusals arrive as Postgres exception text.
  const CONSOLE_ERRORS: Array<[RegExp, number, string]> = [
    [/role not allowed|not platform staff/, 403, "صلاحيتك لا تسمح بهذا الإجراء"],
    [/could not find the function|PGRST202|does not exist/i, 503, "ميزة الفريق غير مفعّلة بعد. شغّل ملف supabase_production_setup.sql"],
    [/account not found/, 404, "الحساب غير موجود"],
    [/ticket not found/, 404, "الطلب غير موجود"],
    [/staff not found/, 404, "هذا البريد ليس في الفريق"],
    [/account not confirmed/, 409, "أكّد الموظف بريده في مستودعي أولاً، ثم أكّد تعيينه من هنا"],
    [/notice not found/, 404, "هذا التنبيه غير موجود"],
    [/cannot change the founder/, 400, "لا يمكن تغيير حساب المؤسس"],
    [/invalid email/, 400, "البريد غير صالح"],
    [/invalid role/, 400, "الدور غير صالح"],
    [/invalid status/, 400, "الحالة غير صالحة"],
    [/invalid message/, 400, "الرد فارغ أو أطول من 4000 حرف"],
    [/staff is full/, 400, "وصل الفريق إلى 50 عضواً"],
  ];
  function sendConsoleError(res: any, error: any, label: string, fallback: string) {
    const text = String(error?.message || error?.code || error || "");
    const match = CONSOLE_ERRORS.find(([pattern]) => pattern.test(text) || pattern.test(String(error?.code || "")));
    if (match) return res.status(match[1]).json({ message: match[2] });
    console.error(`[${label}]`, text);
    return res.status(500).json({ message: fallback });
  }

  const TICKET_ID_PATTERN = USER_ID_PATTERN;
  const STAFF_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  app.get("/api/admin/me", async (req, res) => {
    const staff = await requireStaff(req, res, null);
    if (!staff) return;
    return res.json({ role: staff.role, email: staff.user.email });
  });

  app.get("/api/admin/subscribers", async (req, res) => {
    const staff = await requireStaff(req, res, "view_subscribers");
    if (!staff) return;
    try {
      const [authUsers, profilesResult, subsResult, usageResult] = await Promise.all([
        listAuthUsers(staff.service),
        staff.service.from("profiles").select("id, user_name, business_name, role"),
        staff.service.from("user_subscriptions").select("user_id, subscription_status, trial_start_date, expiry_date"),
        staffCan(staff.role, "view_ai_usage")
          ? staff.service.rpc("admin_ai_usage", { p_actor: staff.user.id, p_days: 30 })
          : Promise.resolve({ data: null, error: null }),
      ]);
      if (profilesResult.error) throw profilesResult.error;
      if (subsResult.error) throw subsResult.error;
      // Usage is informational; the list still loads if the usage function is not installed yet.
      if (usageResult.error) console.error("[Admin subscribers] usage", usageResult.error.message);
      const usage = new Map<string, { today: number; period: number }>();
      for (const row of (Array.isArray(usageResult.data) ? usageResult.data : [])) {
        usage.set(String(row.owner_id), { today: Number(row.today) || 0, period: Number(row.period) || 0 });
      }
      const profiles = profilesResult.data || [];
      const subs = subsResult.data || [];
      const seen = new Set<string>();
      const withUsage = (row: ReturnType<typeof presentSubscriber>) => ({
        ...row,
        aiToday: usageResult.data ? usage.get(row.id)?.today ?? 0 : null,
        ai30d: usageResult.data ? usage.get(row.id)?.period ?? 0 : null,
      });
      const subscribers = authUsers.map((authUser) => {
        seen.add(authUser.id);
        const profile = profiles.find((row) => row.id === authUser.id);
        const sub = subs.find((row) => row.user_id === authUser.id);
        return withUsage(presentSubscriber(authUser, profile, sub));
      });
      for (const profile of profiles) {
        if (seen.has(profile.id)) continue;
        const sub = subs.find((row) => row.user_id === profile.id);
        subscribers.push(withUsage(presentSubscriber(null, profile, sub)));
      }
      subscribers.sort((a, b) => {
        if (a.endsAt === b.endsAt) return a.email.localeCompare(b.email);
        if (!a.endsAt) return 1;
        if (!b.endsAt) return -1;
        return a.endsAt < b.endsAt ? -1 : 1;
      });
      return res.json({ subscribers, aiDailyLimit: AI_DAILY_QUESTIONS_PER_STORE });
    } catch (error: any) {
      console.error("[Admin subscribers]", error);
      return res.status(500).json({ message: "تعذر قراءة المشتركين" });
    }
  });

  app.post("/api/admin/subscription", async (req, res) => {
    const staff = await requireStaff(req, res, "grant_grace");
    if (!staff) return;
    const userId = String(req.body?.userId || "");
    const op = String(req.body?.op || "");
    if (!USER_ID_PATTERN.test(userId)) {
      return res.status(400).json({ message: "معرّف الحساب غير صالح" });
    }
    if (!["extend", "expire", "mark_paid", "set_trial", "set_expiry"].includes(op)) {
      return res.status(400).json({ message: "الأمر غير معروف" });
    }
    const days = req.body?.days === undefined || req.body?.days === null ? null : Number(req.body.days);
    if (days !== null && (!Number.isInteger(days) || days < 1 || days > MAX_SUBSCRIPTION_GRANT_DAYS)) {
      return res.status(400).json({ message: "عدد الأيام يجب أن يكون بين 1 و 730" });
    }
    if (op === "extend" && days === null) {
      return res.status(400).json({ message: "حدد عدد أيام التمديد" });
    }
    const graceOnly = !staffCan(staff.role, "manage_subscriptions");
    if (graceOnly && (op !== "extend" || days! > SUPPORT_GRACE_DAYS)) {
      return res.status(403).json({ message: `الدعم الفني يمنح مهلة حتى ${SUPPORT_GRACE_DAYS} أيام فقط` });
    }

    try {
      const authLookup = await staff.service.auth.admin.getUserById(userId);
      if (authLookup.error || !authLookup.data.user) {
        return res.status(404).json({ message: "الحساب غير موجود" });
      }
      const authUser = authLookup.data.user;
      const { data: existing, error: readError } = await staff.service
        .from("user_subscriptions")
        .select("subscription_status, trial_start_date, expiry_date")
        .eq("user_id", userId)
        .maybeSingle();
      if (readError) throw readError;

      const current = subscriptionWindow({
        status: existing?.subscription_status || "trial",
        trialStart: existing?.trial_start_date || authUser.created_at,
        expiry: existing?.expiry_date,
      });
      const now = Date.now();
      let status: "trial" | "active" | "expired" = existing?.subscription_status === "active"
        ? "active"
        : existing?.subscription_status === "expired"
          ? "expired"
          : "trial";
      let endsAt = current.endsAt && current.endsAt > now ? current.endsAt : now;

      if (op === "extend") {
        endsAt += days! * SUBSCRIPTION_DAY_MS;
        if (status === "expired" || (status === "active" && current.kind === "expired" && graceOnly)) status = "trial";
        if (graceOnly) {
          endsAt = Math.min(endsAt, now + SUPPORT_GRACE_DAYS * SUBSCRIPTION_DAY_MS);
          if (current.endsAt && endsAt <= current.endsAt) {
            return res.status(400).json({ message: `لدى هذا الحساب أكثر من ${SUPPORT_GRACE_DAYS} أيام متبقية` });
          }
        }
      } else if (op === "mark_paid") {
        status = "active";
        if (days) endsAt += days * SUBSCRIPTION_DAY_MS;
        if (endsAt <= now) endsAt = now + 30 * SUBSCRIPTION_DAY_MS;
      } else if (op === "set_trial") {
        status = "trial";
        endsAt = now + TRIAL_DAYS * SUBSCRIPTION_DAY_MS;
      } else if (op === "expire") {
        status = "expired";
        endsAt = now;
      } else {
        const expiryDate = Date.parse(`${req.body?.expiry}T23:59:59.000Z`);
        if (!Number.isFinite(expiryDate)) {
          return res.status(400).json({ message: "تاريخ الانتهاء غير صالح" });
        }
        if (expiryDate <= now || expiryDate > now + MAX_SUBSCRIPTION_GRANT_DAYS * SUBSCRIPTION_DAY_MS) {
          return res.status(400).json({ message: "التاريخ يجب أن يكون خلال 730 يوماً" });
        }
        endsAt = expiryDate;
        if (status === "expired") status = "trial";
      }

      const trialStart = status === "trial"
        ? trialStartForEnd(endsAt)
        : (existing?.trial_start_date || authUser.created_at || new Date(now).toISOString());
      const expiry = new Date(endsAt).toISOString();
      const { error: writeError } = await staff.service.rpc("admin_apply_subscription", {
        p_actor: staff.user.id,
        p_action: op,
        p_target: userId,
        p_status: status,
        p_trial_start: trialStart,
        p_expiry: expiry,
        p_details: { days, expiry: req.body?.expiry ?? null },
      });
      if (writeError) return sendConsoleError(res, writeError, "Admin subscription", "تعذر تعديل الاشتراك");

      const { data: profile } = await staff.service
        .from("profiles")
        .select("id, user_name, business_name, role")
        .eq("id", userId)
        .maybeSingle();
      return res.json({
        subscriber: presentSubscriber(authUser, profile, {
          subscription_status: status,
          trial_start_date: trialStart,
          expiry_date: expiry,
        }),
      });
    } catch (error: any) {
      console.error("[Admin subscription]", error);
      return res.status(500).json({ message: "تعذر تعديل الاشتراك" });
    }
  });

  app.get("/api/admin/staff", async (req, res) => {
    const staff = await requireStaff(req, res, "manage_staff");
    if (!staff) return;
    const { data, error } = await staff.service.rpc("admin_staff_list", { p_actor: staff.user.id });
    if (error) return sendConsoleError(res, error, "Admin staff", "تعذر قراءة الفريق");
    return res.json({ staff: Array.isArray(data) ? data : [] });
  });

  app.post("/api/admin/staff", async (req, res) => {
    const staff = await requireStaff(req, res, "manage_staff");
    if (!staff) return;
    const email = String(req.body?.email || "").trim().toLowerCase();
    const role = String(req.body?.role || "");
    if (!STAFF_EMAIL_PATTERN.test(email) || email.length > 254) return res.status(400).json({ message: "البريد غير صالح" });
    if (role !== "operations" && role !== "support") return res.status(400).json({ message: "الدور غير صالح" });
    const { error } = await staff.service.rpc("admin_staff_set", { p_actor: staff.user.id, p_email: email, p_role: role });
    if (error) return sendConsoleError(res, error, "Admin staff", "تعذر حفظ العضو");
    return res.json({ ok: true });
  });

  app.post("/api/admin/staff/confirm", async (req, res) => {
    const staff = await requireStaff(req, res, "manage_staff");
    if (!staff) return;
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!STAFF_EMAIL_PATTERN.test(email)) return res.status(400).json({ message: "البريد غير صالح" });
    const { error } = await staff.service.rpc("admin_staff_confirm", { p_actor: staff.user.id, p_email: email });
    if (error) return sendConsoleError(res, error, "Admin staff confirm", "تعذر تأكيد العضو");
    return res.json({ ok: true });
  });

  app.post("/api/admin/staff/remove", async (req, res) => {
    const staff = await requireStaff(req, res, "manage_staff");
    if (!staff) return;
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!STAFF_EMAIL_PATTERN.test(email)) return res.status(400).json({ message: "البريد غير صالح" });
    const { error } = await staff.service.rpc("admin_staff_remove", { p_actor: staff.user.id, p_email: email });
    if (error) return sendConsoleError(res, error, "Admin staff", "تعذر إزالة العضو");
    return res.json({ ok: true });
  });

  app.get("/api/admin/audit", async (req, res) => {
    const staff = await requireStaff(req, res, "view_audit");
    if (!staff) return;
    const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 500);
    const { data, error } = await staff.service.rpc("admin_audit_list", { p_actor: staff.user.id, p_limit: limit });
    if (error) return sendConsoleError(res, error, "Admin audit", "تعذر قراءة السجل");
    return res.json({ entries: Array.isArray(data) ? data : [] });
  });

  app.get("/api/admin/notices", async (req, res) => {
    const staff = await requireStaff(req, res, "view_audit");
    if (!staff) return;
    const { data, error } = await staff.service.rpc("admin_open_notices", { p_actor: staff.user.id });
    if (error) return sendConsoleError(res, error, "Admin notices", "تعذر قراءة التنبيهات");
    return res.json({ notices: Array.isArray(data) ? data : [] });
  });

  app.post("/api/admin/notices/ack", async (req, res) => {
    const staff = await requireStaff(req, res, "view_audit");
    if (!staff) return;
    const id = Number(req.body?.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ message: "معرّف التنبيه غير صالح" });
    const { error } = await staff.service.rpc("admin_notice_ack", { p_actor: staff.user.id, p_id: id });
    if (error) return sendConsoleError(res, error, "Admin notice ack", "تعذر إخفاء التنبيه");
    return res.json({ ok: true });
  });

  app.get("/api/admin/tickets", async (req, res) => {
    const staff = await requireStaff(req, res, "answer_tickets");
    if (!staff) return;
    const status = String(req.query.status || "open");
    if (!["open", "answered", "closed", "all"].includes(status)) return res.status(400).json({ message: "الحالة غير صالحة" });
    const { data, error } = await staff.service.rpc("support_staff_list", { p_actor: staff.user.id, p_status: status });
    if (error) return sendConsoleError(res, error, "Admin tickets", "تعذر قراءة الطلبات");
    return res.json({ tickets: Array.isArray(data) ? data : [] });
  });

  app.get("/api/admin/tickets/:id", async (req, res) => {
    const staff = await requireStaff(req, res, "answer_tickets");
    if (!staff) return;
    if (!TICKET_ID_PATTERN.test(req.params.id)) return res.status(400).json({ message: "معرّف الطلب غير صالح" });
    const { data, error } = await staff.service.rpc("support_staff_thread", { p_actor: staff.user.id, p_ticket: req.params.id });
    if (error) return sendConsoleError(res, error, "Admin ticket", "تعذر قراءة الطلب");
    return res.json(data);
  });

  app.post("/api/admin/tickets/:id/reply", async (req, res) => {
    const staff = await requireStaff(req, res, "answer_tickets");
    if (!staff) return;
    if (!TICKET_ID_PATTERN.test(req.params.id)) return res.status(400).json({ message: "معرّف الطلب غير صالح" });
    const body = String(req.body?.body || "").trim();
    if (!body || body.length > 4000) return res.status(400).json({ message: "الرد فارغ أو أطول من 4000 حرف" });
    const { error } = await staff.service.rpc("support_staff_reply", {
      p_actor: staff.user.id, p_ticket: req.params.id, p_body: body, p_close: req.body?.close === true,
    });
    if (error) return sendConsoleError(res, error, "Admin ticket", "تعذر إرسال الرد");
    return res.json({ ok: true });
  });

  app.post("/api/admin/tickets/:id/status", async (req, res) => {
    const staff = await requireStaff(req, res, "answer_tickets");
    if (!staff) return;
    if (!TICKET_ID_PATTERN.test(req.params.id)) return res.status(400).json({ message: "معرّف الطلب غير صالح" });
    const status = String(req.body?.status || "");
    if (!["open", "answered", "closed"].includes(status)) return res.status(400).json({ message: "الحالة غير صالحة" });
    const { error } = await staff.service.rpc("support_staff_set_status", {
      p_actor: staff.user.id, p_ticket: req.params.id, p_status: status,
    });
    if (error) return sendConsoleError(res, error, "Admin ticket", "تعذر تغيير الحالة");
    return res.json({ ok: true });
  });

  // Supabase Auth Callback Route
  // Serve the frontend React SPA (index.html) directly for `/auth/callback` on the server-side.
  // This guarantees that the Single Page Application's assets load correctly,
  // and enables the client-side Supabase SDK to parse both query string and hash parameters flawlessly.
  app.get(["/auth/callback", "/auth/callback/"], async (req, res, next) => {
    console.log(`[Express Server] /auth/callback fallback (query keys: ${Object.keys(req.query || {}).join(",") || "none"})`);
    
    if (!isProduction) {
      // In development mode, hand off to the Vite fallback handler to serve index.html with transformations
      return next();
    } else {
      const distPath = path.join(process.cwd(), 'dist');
      const indexPath = path.join(distPath, 'index.html');
      if (fs.existsSync(indexPath)) {
        console.log(`[Express Server Prod] Serving index.html directly for /auth/callback without redirect`);
        return res.sendFile(indexPath);
      } else {
        console.error("[Express Server Prod] Missing index.html in dist/");
        // Determine the environment's host dynamically
        const host = req.get('host') || req.hostname;
        const protocol = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
        const appOrigin = `${protocol}://${host}`;
        return res.redirect(`${appOrigin}/`);
      }
    }
  });

  // API Routes
  const RATE_CACHE_MS = 10 * 60_000;
  const rateCache = new Map<string, { at: number; data: unknown }>();

  app.get("/api/exchange-rate/:base", async (req, res) => {
    const { base } = req.params;
    const baseUpper = (base || "USD").toUpperCase();
    if (!/^[A-Z]{3}$/.test(baseUpper)) {
      return res.status(400).json({ message: "Invalid currency code" });
    }
    const cached = rateCache.get(baseUpper);
    if (cached && Date.now() - cached.at < RATE_CACHE_MS) {
      return res.json(cached.data);
    }
    if (!rateLimit(`rates:${req.ip}`, 60, 60_000)) {
      return res.status(429).json({ message: "Too many requests, please wait a minute" });
    }
    
    // Built-in offline fallback dictionary
    const fallbackRates: Record<string, Record<string, number>> = {
      USD: { USD: 1, JOD: 0.709, ILS: 3.70, EGP: 47.50, EUR: 0.92, SAR: 3.75, AED: 3.6725, IQD: 1310, LYD: 4.8 },
      JOD: { JOD: 1, USD: 1.41, ILS: 5.22, EGP: 67.00, EUR: 1.30, SAR: 5.29, AED: 5.18, IQD: 1850, LYD: 6.77 },
      ILS: { ILS: 1, USD: 0.27, JOD: 0.1916, EGP: 12.83, EUR: 0.25, SAR: 1.01, AED: 0.99, IQD: 354, LYD: 1.30 }
    };

    try {
      const response = await fetch(`https://open.er-api.com/v6/latest/${baseUpper}`);
      if (!response.ok) {
        throw new Error(`External service responded with status ${response.status}`);
      }
      const data = await response.json();
      if (data?.result === "success" && data?.rates && typeof data.rates === "object") {
        rateCache.set(baseUpper, { at: Date.now(), data });
      }
      res.json(data);
    } catch (error) {
      console.warn(`[Exchange Proxy] Failed to fetch external rates for ${baseUpper}, serving local fallbacks.`, error);
      
      const rates = fallbackRates[baseUpper];
      if (!rates) {
        return res.status(503).json({ message: "Live exchange rates are unavailable right now" });
      }
      res.json({
        result: "success",
        base_code: baseUpper,
        rates: rates,
        provider: "local_database_fallback"
      });
    }
  });

  // AI Status diagnostics endpoint
  app.get("/api/ai-status", (req, res) => {
    const initialized = !!process.env.GEMINI_API_KEY;
    res.json({
      status: initialized ? "configured" : "missing_key",
      model: GEMINI_MODEL,
      features: {
        chat: initialized,
        analysis: initialized
      }
    });
  });

  type AssistantRefusal = { status: number; code: string; message: string };

  /**
   * The store the request is billed to (members use their owner's subscription), or the refusal
   * to send. Fails closed.
   */
  async function checkAssistantAccess(user: any): Promise<{ refusal: AssistantRefusal } | { ownerId: string }> {
    return checkStoreAccess(user, ["owner", "manager"], true);
  }

  /**
   * The caller's store and role (members act for their owner). With `requireActive`, the store's
   * subscription must be live on the server clock. Fails closed.
   */
  async function checkStoreAccess(
    user: any,
    roles: Array<"owner" | "manager" | "cashier">,
    requireActive: boolean,
  ): Promise<{ refusal: AssistantRefusal } | { ownerId: string; role: "owner" | "manager" | "cashier" }> {
    if (isVerifiedAdmin(user)) return { ownerId: user.id, role: "owner" };
    const service = getSupabaseServiceClient();
    if (!service) {
      return { refusal: { status: 503, code: "subscription_check_unavailable", message: "Subscription check is not configured on the server" } };
    }
    let ownerId = user.id;
    let role: "owner" | "manager" | "cashier" = "owner";
    const membership = await service
      .from("workspace_members")
      .select("owner_id, role")
      .eq("member_id", user.id)
      .eq("status", "active")
      .maybeSingle();
    // Without the teams table every account is its own store; any other failure must not bill a member as an owner.
    const teamsMissing = membership.error?.code === "42P01" || membership.error?.code === "PGRST205";
    if (membership.error && !teamsMissing) {
      return { refusal: { status: 503, code: "subscription_check_unavailable", message: "Could not read the store membership" } };
    }
    if (!membership.error && membership.data) {
      role = membership.data.role === "manager" ? "manager" : "cashier";
      ownerId = membership.data.owner_id;
    }
    if (!roles.includes(role)) {
      return { refusal: { status: 403, code: "role_not_allowed", message: "Your role in this store cannot do this" } };
    }
    if (!requireActive) return { ownerId, role };
    const { data, error } = await service
      .from("user_subscriptions")
      .select("subscription_status, trial_start_date, expiry_date")
      .eq("user_id", ownerId)
      .maybeSingle();
    if (error) {
      return { refusal: { status: 503, code: "subscription_check_unavailable", message: "Could not read the subscription" } };
    }
    const access = subscriptionWindow({
      status: data?.subscription_status || "trial",
      trialStart: data?.trial_start_date || (ownerId === user.id ? user.created_at : undefined),
      expiry: data?.expiry_date,
    });
    if (access.kind === "expired") {
      return { refusal: { status: 402, code: "subscription_required", message: "An active subscription is required" } };
    }
    return { ownerId, role };
  }

  /** Token counts as Gemini reports them, per store per day. A failure here never blocks the answer. */
  async function recordAssistantUsage(ownerId: string, usage: any) {
    const service = getSupabaseServiceClient();
    if (!service || !usage) return;
    const count = (value: unknown) => (Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0);
    const { error } = await service.rpc("record_ai_usage", {
      p_owner: ownerId,
      p_prompt: count(usage.promptTokenCount),
      p_output: count(usage.candidatesTokenCount),
      p_thoughts: count(usage.thoughtsTokenCount),
      p_cached: count(usage.cachedContentTokenCount),
    });
    if (error) console.warn("[AI usage] not recorded:", error.message);
  }

  /** Returns a claimed question when Gemini failed before answering. Empty answers stay counted: their tokens were spent. */
  async function releaseAssistantClaim(ownerId: string) {
    const service = getSupabaseServiceClient();
    if (!service) return;
    const { error } = await service.rpc("release_ai_request", { p_owner: ownerId });
    if (error) console.warn("[AI usage] question not returned:", error.message);
  }

  app.post("/api/chat", async (req, res) => {
    const genAI = getAI();
    if (!genAI) {
      return res.status(503).json({ code: "ai_not_configured", message: "The AI assistant is not configured on this server" });
    }
    const authUser = await getRequestUser(req);
    if (!authUser) {
      return res.status(401).json({ code: "sign_in_required", message: "Sign in to use the AI assistant" });
    }
    if (!rateLimit(`chat:${authUser.id}`, 20, 60_000)) {
      return res.status(429).json({ code: "rate_limited", message: "Too many requests, please wait a minute" });
    }
    const access = await checkAssistantAccess(authUser);
    if ("refusal" in access) {
      return res.status(access.refusal.status).json({ code: access.refusal.code, message: access.refusal.message });
    }

    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    if (!message || message.length > ASSISTANT_LIMITS.messageChars) {
      return res.status(400).json({ code: "invalid_message", message: "Message is empty or too long" });
    }

    const claimed = !isVerifiedAdmin(authUser);
    if (claimed) {
      const service = getSupabaseServiceClient();
      const claim = service
        ? await service.rpc("claim_ai_request", { p_owner: access.ownerId, p_limit: AI_DAILY_QUESTIONS_PER_STORE })
        : null;
      if (!claim || claim.error) {
        return res.status(503).json({ code: "usage_check_unavailable", message: "The daily allowance could not be checked" });
      }
      if (claim.data !== true) {
        return res.status(429).json({ code: "daily_limit", message: "This store has used today's assistant questions", limit: AI_DAILY_QUESTIONS_PER_STORE });
      }
    }

    const context = sanitizeContext(req.body?.context);
    const verbosity = req.body?.verbosity === "concise" ? "concise" : "detailed";
    const language = req.body?.language === "en" ? "en" : "ar";
    const turns = sanitizeHistory(req.body?.history, message);

    try {
      const response = await genAI.models.generateContent({
        model: GEMINI_MODEL,
        contents: turns.map((t) => ({ role: t.role === "assistant" ? "model" : "user", parts: [{ text: t.content }] })),
        config: {
          systemInstruction: buildSystemInstruction({ context, verbosity, language }),
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              text: { type: Type.STRING, description: "The reply shown to the user." },
              action: {
                type: Type.OBJECT,
                description: "Only when the user explicitly asked to add a product, delete a product, or add a customer.",
                properties: {
                  type: { type: Type.STRING, enum: ["add_product", "delete_product", "add_customer"] },
                  product: {
                    type: Type.OBJECT,
                    properties: {
                      name: { type: Type.STRING },
                      sku: { type: Type.STRING },
                      quantity: { type: Type.NUMBER },
                      unitCost: { type: Type.NUMBER },
                      sellingPrice: { type: Type.NUMBER },
                    },
                  },
                  productRef: { type: Type.NUMBER, description: "The ref number from PRODUCTS." },
                  customer: {
                    type: Type.OBJECT,
                    properties: {
                      name: { type: Type.STRING },
                      phone: { type: Type.STRING },
                      currency: { type: Type.STRING },
                    },
                  },
                },
                required: ["type"],
              },
            },
            required: ["text"],
          },
        },
      });

      void recordAssistantUsage(access.ownerId, response.usageMetadata);

      let parsed: any = null;
      try {
        parsed = JSON.parse(response.text || "");
      } catch {
        parsed = null;
      }
      const text = typeof parsed?.text === "string" ? parsed.text.trim() : "";
      if (!text) {
        return res.status(502).json({ code: "ai_empty", message: "The AI returned no usable answer" });
      }
      return res.json({ text, action: sanitizeAssistantAction(parsed?.action, context), model: GEMINI_MODEL });
    } catch (error: any) {
      console.warn("[AI chat] Gemini request failed:", error?.message || error);
      if (claimed) await releaseAssistantClaim(access.ownerId);
      return res.status(502).json({ code: "ai_failed", message: "The AI service did not respond" });
    }
  });

  // ---------------------------------------------------------------------------
  // National e-invoicing: Jordan JoFotara + Saudi ZATCA Phase 1 (TLV QR).
  // JoFotara credentials stay sealed with EINVOICE_ENCRYPTION_KEY; ZATCA Phase 1 stores
  // public seller identity only. The server always builds from the stored invoice.
  // ---------------------------------------------------------------------------
  const einvoiceKey = () => parseSecretKey(process.env.EINVOICE_ENCRYPTION_KEY);
  const tableMissing = (error: any) => error?.code === "42P01" || error?.code === "PGRST205";
  const refuse = (res: any, refusal: AssistantRefusal) =>
    res.status(refusal.status).json({ code: refusal.code, message: refusal.message });

  async function readEinvoiceConfig(ownerId: string, role: string) {
    const service = getSupabaseServiceClient();
    if (!service) return { available: false as const, configured: false as const, role, provider: null as null };
    const { data, error } = await service
      .from("einvoice_settings")
      .select("provider, tin, seller_name, income_source, family, zero_rate_category, client_id, cr_number, updated_at")
      .eq("owner_id", ownerId)
      .maybeSingle();
    if (error) {
      if (tableMissing(error)) return { available: false as const, configured: false as const, role, provider: null as null };
      return { error: "read_failed" as const };
    }
    const provider = data?.provider === "zatca" || data?.provider === "jofotara" ? data.provider : null;
    // ZATCA Phase 1 needs the table + service role only; JoFotara also needs the encryption key to link.
    const available = true;
    const settings = data && role !== "cashier"
      ? {
          provider: provider || "jofotara",
          tin: data.tin,
          sellerName: data.seller_name,
          incomeSource: data.income_source || "",
          family: data.family || "income",
          zeroRateCategory: data.zero_rate_category,
          crNumber: data.cr_number || "",
          clientIdHint: data.client_id ? `••••${String(data.client_id).slice(-4)}` : "",
          updatedAt: data.updated_at,
        }
      : undefined;
    return { available, configured: !!data, role, provider, settings };
  }

  app.get("/api/einvoice", async (req, res) => {
    const authUser = await getRequestUser(req);
    if (!authUser) return res.status(401).json({ code: "sign_in_required", message: "Sign in first" });
    const access = await checkStoreAccess(authUser, ["owner", "manager", "cashier"], false);
    if ("refusal" in access) return refuse(res, access.refusal);
    const cfg = await readEinvoiceConfig(access.ownerId, access.role);
    if ("error" in cfg) return res.status(503).json({ code: "einvoice_unavailable", message: "Could not read the e-invoicing settings" });
    return res.json(cfg);
  });

  app.get("/api/einvoice/jofotara", async (req, res) => {
    const authUser = await getRequestUser(req);
    if (!authUser) return res.status(401).json({ code: "sign_in_required", message: "Sign in first" });
    const access = await checkStoreAccess(authUser, ["owner", "manager", "cashier"], false);
    if ("refusal" in access) return refuse(res, access.refusal);
    const service = getSupabaseServiceClient();
    if (!service || !einvoiceKey()) return res.json({ available: false, configured: false, role: access.role, provider: null });
    const cfg = await readEinvoiceConfig(access.ownerId, access.role);
    if ("error" in cfg) return res.status(503).json({ code: "einvoice_unavailable", message: "Could not read the e-invoicing settings" });
    // Legacy clients expect JoFotara-shaped settings only when that provider is linked.
    if (cfg.configured && cfg.provider && cfg.provider !== "jofotara") {
      return res.json({ available: true, configured: false, role: access.role, provider: cfg.provider });
    }
    return res.json(cfg);
  });

  app.post("/api/einvoice/jofotara/settings", async (req, res) => {
    const authUser = await getRequestUser(req);
    if (!authUser) return res.status(401).json({ code: "sign_in_required", message: "Sign in first" });
    if (!rateLimit(`einv-settings:${authUser.id}`, 10, 60_000)) {
      return res.status(429).json({ code: "rate_limited", message: "Too many requests, please wait a minute" });
    }
    const access = await checkStoreAccess(authUser, ["owner"], true);
    if ("refusal" in access) return refuse(res, access.refusal);
    const service = getSupabaseServiceClient();
    const key = einvoiceKey();
    if (!service || !key) return res.status(503).json({ code: "einvoice_unavailable", message: "E-invoicing is not configured on this server" });

    const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");
    const body = req.body || {};
    const input = {
      tin: text(body.tin, 20),
      sellerName: text(body.sellerName, 200),
      incomeSource: text(body.incomeSource, 25),
      family: body.family === "general_sales" ? "general_sales" : body.family === "income" ? "income" : "",
      zeroRateCategory: body.zeroRateCategory === "Z" || body.zeroRateCategory === "O" ? body.zeroRateCategory : null,
      clientId: text(body.clientId, 200),
      secretKey: text(body.secretKey, 500),
    };
    const { data: existing, error: readError } = await service
      .from("einvoice_settings")
      .select("client_id, secret_sealed")
      .eq("owner_id", access.ownerId)
      .maybeSingle();
    if (readError) return res.status(503).json({ code: "einvoice_unavailable", message: "Could not read the e-invoicing settings" });

    // Empty Client-Id / Secret-Key keep what is stored.
    const fields: string[] = [];
    if (!isJoFotaraTin(input.tin)) fields.push("tin");
    if (!input.sellerName) fields.push("sellerName");
    if (!isJoFotaraIncomeSource(input.incomeSource)) fields.push("incomeSource");
    if (!input.family) fields.push("family");
    if (!input.clientId && !existing) fields.push("clientId");
    if (!input.secretKey && !existing) fields.push("secretKey");
    if (fields.length) return res.status(400).json({ code: "invalid_settings", message: "Some fields are invalid", fields });

    const { error } = await service.from("einvoice_settings").upsert({
      owner_id: access.ownerId,
      provider: "jofotara",
      tin: input.tin,
      seller_name: input.sellerName,
      income_source: input.incomeSource,
      family: input.family,
      zero_rate_category: input.zeroRateCategory,
      client_id: input.clientId || existing!.client_id,
      secret_sealed: input.secretKey ? sealSecret(input.secretKey, key) : existing!.secret_sealed,
      updated_by: authUser.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: "owner_id" });
    if (error) {
      console.error("[e-invoice settings]", error.message);
      return res.status(503).json({ code: "einvoice_unavailable", message: "Could not save the e-invoicing settings" });
    }
    return res.json({ ok: true });
  });

  app.post("/api/einvoice/jofotara/disconnect", async (req, res) => {
    const authUser = await getRequestUser(req);
    if (!authUser) return res.status(401).json({ code: "sign_in_required", message: "Sign in first" });
    const access = await checkStoreAccess(authUser, ["owner"], false);
    if ("refusal" in access) return refuse(res, access.refusal);
    const service = getSupabaseServiceClient();
    if (!service) return res.status(503).json({ code: "einvoice_unavailable", message: "E-invoicing is not configured on this server" });
    const { error } = await service.from("einvoice_settings").delete().eq("owner_id", access.ownerId);
    if (error) return res.status(503).json({ code: "einvoice_unavailable", message: "Could not remove the e-invoicing settings" });
    return res.json({ ok: true });
  });

  app.post("/api/einvoice/jofotara/submit", async (req, res) => {
    const authUser = await getRequestUser(req);
    if (!authUser) return res.status(401).json({ code: "sign_in_required", message: "Sign in first" });
    if (!rateLimit(`einv-submit:${authUser.id}`, 30, 60_000)) {
      return res.status(429).json({ code: "rate_limited", message: "Too many requests, please wait a minute" });
    }
    const access = await checkStoreAccess(authUser, ["owner", "manager"], true);
    if ("refusal" in access) return refuse(res, access.refusal);
    const service = getSupabaseServiceClient();
    const key = einvoiceKey();
    if (!service || !key) return res.status(503).json({ code: "einvoice_unavailable", message: "E-invoicing is not configured on this server" });
    const invoiceId = typeof req.body?.invoiceId === "string" ? req.body.invoiceId.trim().slice(0, 200) : "";
    if (!invoiceId) return res.status(400).json({ code: "invoice_required", message: "invoiceId is required" });

    const { data: config, error: configError } = await service
      .from("einvoice_settings")
      .select("tin, seller_name, income_source, family, zero_rate_category, client_id, secret_sealed")
      .eq("owner_id", access.ownerId)
      .maybeSingle();
    if (configError && !tableMissing(configError)) {
      return res.status(503).json({ code: "einvoice_unavailable", message: "Could not read the e-invoicing settings" });
    }
    if (!config) return res.status(409).json({ code: "not_configured", message: "Link the store to JoFotara in Settings first" });
    const secret = openSecret(config.secret_sealed, key);
    if (!secret) return res.status(503).json({ code: "secret_unreadable", message: "The stored Secret-Key cannot be read; enter it again in Settings" });

    const { data: stored, error: invoiceError } = await service
      .from("merchant_documents")
      .select("data")
      .eq("user_id", access.ownerId)
      .eq("collection", "invoices")
      .eq("doc_id", invoiceId)
      .maybeSingle();
    if (invoiceError) return res.status(503).json({ code: "einvoice_unavailable", message: "Could not read the invoice" });
    if (!stored?.data) return res.status(404).json({ code: "invoice_not_found", message: "Invoice not found (sync it first)" });
    const invoice = stored.data as Invoice;

    let phone: string | undefined;
    if (invoice.customerId) {
      const { data: customer } = await service
        .from("merchant_documents")
        .select("data")
        .eq("user_id", access.ownerId)
        .eq("collection", "customers")
        .eq("doc_id", String(invoice.customerId))
        .maybeSingle();
      phone = typeof customer?.data?.phone === "string" ? customer.data.phone : undefined;
    }
    const seller: JoFotaraSeller = {
      tin: config.tin,
      name: config.seller_name,
      incomeSource: config.income_source,
      family: config.family,
      zeroRateCategory: config.zero_rate_category,
    };
    // A credit note references the original sale exactly as JoFotara accepted it.
    let original: { number: string; uuid: string; total: number } | undefined;
    if (invoice.type === "return") {
      const originalId = typeof invoice.returnOf === "string" ? invoice.returnOf : "";
      const { data: sent, error: sentError } = originalId
        ? await service
            .from("einvoice_submissions")
            .select("invoice_number, uuid, status, payable")
            .eq("owner_id", access.ownerId)
            .eq("invoice_id", originalId)
            .maybeSingle()
        : { data: null, error: null };
      if (sentError) return res.status(503).json({ code: "einvoice_unavailable", message: "Could not read the original invoice status" });
      if (!sent || sent.status !== "accepted" || !sent.uuid || !(Number(sent.payable) > 0)) {
        return res.status(409).json({ code: "original_not_accepted", message: "Send the original invoice to JoFotara first" });
      }
      original = { number: String(sent.invoice_number || ""), uuid: String(sent.uuid), total: Number(sent.payable) };
    }
    // Check the invoice before a counter number is reserved for it.
    const precheck = joFotaraFromInvoice(invoice, { seller, uuid: "00000000-0000-4000-8000-000000000000", icv: 1, buyer: { phone }, original });
    if (precheck.ok === false) {
      return res.status(422).json({ code: "invoice_invalid", message: "The invoice cannot be sent as it is", issues: precheck.issues });
    }

    const claim = await service.rpc("einvoice_claim", {
      p_owner: access.ownerId,
      p_invoice: invoiceId,
      p_number: invoice.invoiceNumber,
      p_kind: invoice.type === "return" ? "credit" : "invoice",
      p_actor: authUser.id,
    });
    if (claim.error) {
      const text = claim.error.message || "";
      if (text.includes("EINVOICE_ALREADY_ACCEPTED")) return res.status(409).json({ code: "already_accepted", message: "This invoice was already accepted" });
      if (text.includes("EINVOICE_IN_PROGRESS")) return res.status(409).json({ code: "in_progress", message: "This invoice is being sent right now" });
      console.error("[e-invoice claim]", text);
      return res.status(503).json({ code: "einvoice_unavailable", message: "Could not reserve the invoice counter" });
    }
    const reserved = Array.isArray(claim.data) ? claim.data[0] : claim.data;
    const uuid = String(reserved?.claim_uuid || "");
    const icv = Number(reserved?.claim_icv);

    const prepared = joFotaraFromInvoice(invoice, { seller, uuid, icv, buyer: { phone }, original });
    const built = prepared.ok ? buildJoFotaraXml(prepared.doc) : null;
    if (!built || built.ok === false) {
      await service.rpc("einvoice_record", {
        p_owner: access.ownerId, p_invoice: invoiceId, p_status: "failed", p_type_code: null, p_payable: null,
        p_xml: null, p_response: null, p_qr: null, p_einv_num: null, p_error: "The file could not be built",
      });
      return res.status(500).json({ code: "build_failed", message: "The e-invoice file could not be built" });
    }

    let httpStatus = 0;
    let body: any = null;
    let networkError = "";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(JOFOTARA_ENDPOINT, {
        method: "POST",
        headers: { "Client-Id": config.client_id, "Secret-Key": secret, "Content-Type": "application/json" },
        body: joFotaraRequestBody(built.xml),
        signal: controller.signal,
      });
      httpStatus = response.status;
      const raw = await response.text();
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        body = { raw: raw.slice(0, 4000) };
      }
    } catch (error: any) {
      networkError = error?.name === "AbortError" ? "No answer from JoFotara within 30 seconds" : "JoFotara could not be reached";
    } finally {
      clearTimeout(timer);
    }

    const result = readJoFotaraResponse(httpStatus, body);
    const messages = networkError ? [networkError] : result.messages;
    if (!networkError && result.outcome !== "accepted" && !messages.length) messages.push(`HTTP ${httpStatus}`);
    const recorded = await service.rpc("einvoice_record", {
      p_owner: access.ownerId,
      p_invoice: invoiceId,
      p_status: result.outcome,
      p_type_code: built.typeCode,
      p_payable: Number(built.totals.payable),
      p_xml: built.xml,
      p_response: body,
      p_qr: result.qr,
      p_einv_num: result.einvNum,
      p_error: messages.join(" | "),
    });
    if (recorded.error) {
      // The row stays 'sending'; a resend after two minutes reuses the same UUID, so nothing is declared twice.
      console.error("[e-invoice record]", recorded.error.message);
    }
    return res.json({
      outcome: result.outcome,
      status: result.status,
      qr: result.qr,
      einvNum: result.einvNum,
      messages,
      icv,
      uuid,
      saved: !recorded.error,
    });
  });

  // ---------------------------------------------------------------------------
  // ZATCA Phase 1 — Saudi simplified tax QR (TLV). No CSID / clearance yet.
  // ---------------------------------------------------------------------------
  app.post("/api/einvoice/zatca/settings", async (req, res) => {
    const authUser = await getRequestUser(req);
    if (!authUser) return res.status(401).json({ code: "sign_in_required", message: "Sign in first" });
    if (!rateLimit(`einv-zatca-settings:${authUser.id}`, 10, 60_000)) {
      return res.status(429).json({ code: "rate_limited", message: "Too many requests, please wait a minute" });
    }
    const access = await checkStoreAccess(authUser, ["owner"], true);
    if ("refusal" in access) return refuse(res, access.refusal);
    const service = getSupabaseServiceClient();
    if (!service) return res.status(503).json({ code: "einvoice_unavailable", message: "E-invoicing is not configured on this server" });

    const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");
    const body = req.body || {};
    const tin = text(body.tin, 20).replace(/\D/g, "");
    const sellerName = text(body.sellerName, 200);
    const crNumber = text(body.crNumber, 20).replace(/\D/g, "");
    const fields: string[] = [];
    if (!isZatcaVatNumber(tin)) fields.push("tin");
    if (!sellerName) fields.push("sellerName");
    if (crNumber && !/^\d{5,20}$/.test(crNumber)) fields.push("crNumber");
    if (fields.length) return res.status(400).json({ code: "invalid_settings", message: "Some fields are invalid", fields });

    const { error } = await service.from("einvoice_settings").upsert({
      owner_id: access.ownerId,
      provider: "zatca",
      tin,
      seller_name: sellerName,
      cr_number: crNumber || null,
      income_source: null,
      family: null,
      zero_rate_category: null,
      client_id: null,
      secret_sealed: null,
      provider_config: {},
      updated_by: authUser.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: "owner_id" });
    if (error) {
      console.error("[e-invoice zatca settings]", error.message);
      return res.status(503).json({ code: "einvoice_unavailable", message: "Could not save the e-invoicing settings" });
    }
    return res.json({ ok: true });
  });

  app.post("/api/einvoice/zatca/disconnect", async (req, res) => {
    const authUser = await getRequestUser(req);
    if (!authUser) return res.status(401).json({ code: "sign_in_required", message: "Sign in first" });
    const access = await checkStoreAccess(authUser, ["owner"], false);
    if ("refusal" in access) return refuse(res, access.refusal);
    const service = getSupabaseServiceClient();
    if (!service) return res.status(503).json({ code: "einvoice_unavailable", message: "E-invoicing is not configured on this server" });
    const { error } = await service.from("einvoice_settings").delete().eq("owner_id", access.ownerId).eq("provider", "zatca");
    if (error) return res.status(503).json({ code: "einvoice_unavailable", message: "Could not remove the e-invoicing settings" });
    return res.json({ ok: true });
  });

  app.post("/api/einvoice/zatca/qr", async (req, res) => {
    const authUser = await getRequestUser(req);
    if (!authUser) return res.status(401).json({ code: "sign_in_required", message: "Sign in first" });
    if (!rateLimit(`einv-zatca-qr:${authUser.id}`, 30, 60_000)) {
      return res.status(429).json({ code: "rate_limited", message: "Too many requests, please wait a minute" });
    }
    const access = await checkStoreAccess(authUser, ["owner", "manager"], true);
    if ("refusal" in access) return refuse(res, access.refusal);
    const service = getSupabaseServiceClient();
    if (!service) return res.status(503).json({ code: "einvoice_unavailable", message: "E-invoicing is not configured on this server" });
    const invoiceId = typeof req.body?.invoiceId === "string" ? req.body.invoiceId.trim().slice(0, 200) : "";
    if (!invoiceId) return res.status(400).json({ code: "invoice_required", message: "invoiceId is required" });

    const { data: config, error: configError } = await service
      .from("einvoice_settings")
      .select("provider, tin, seller_name")
      .eq("owner_id", access.ownerId)
      .maybeSingle();
    if (configError && !tableMissing(configError)) {
      return res.status(503).json({ code: "einvoice_unavailable", message: "Could not read the e-invoicing settings" });
    }
    if (!config || config.provider !== "zatca") {
      return res.status(409).json({ code: "not_configured", message: "Link the store to ZATCA Phase 1 in Settings first" });
    }

    const { data: stored, error: invoiceError } = await service
      .from("merchant_documents")
      .select("data")
      .eq("user_id", access.ownerId)
      .eq("collection", "invoices")
      .eq("doc_id", invoiceId)
      .maybeSingle();
    if (invoiceError) return res.status(503).json({ code: "einvoice_unavailable", message: "Could not read the invoice" });
    if (!stored?.data) return res.status(404).json({ code: "invoice_not_found", message: "Invoice not found (sync it first)" });
    const invoice = stored.data as Invoice;

    if (invoice.type !== "sale" && invoice.type !== "return") {
      return res.status(422).json({ code: "invoice_invalid", message: "Only sales and sales returns can get a ZATCA QR" });
    }
    if (invoice.currency !== "SAR") {
      return res.status(422).json({
        code: "currency_not_sar",
        message: "ZATCA Phase 1 only accepts invoices in Saudi riyals (SAR)",
      });
    }

    const total = formatZatcaAmount(Number(invoice.totalAmount));
    const vat = formatZatcaAmount(Number(invoice.taxAmount) || 0);
    if (!total || !vat) {
      return res.status(422).json({ code: "invoice_invalid", message: "Invoice totals are invalid" });
    }
    const issued = Number(invoice.date);
    const timestamp = Number.isFinite(issued) && issued > 0
      ? new Date(issued).toISOString().replace(/\.\d{3}Z$/, "Z")
      : new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

    const encoded = encodeZatcaTlv({
      sellerName: config.seller_name,
      vatNumber: config.tin,
      timestamp,
      invoiceTotal: total,
      vatTotal: vat,
    });
    if (encoded.ok === false) {
      return res.status(422).json({ code: "invoice_invalid", message: "Could not build the tax QR", issues: encoded.issues });
    }

    const claim = await service.rpc("einvoice_claim", {
      p_owner: access.ownerId,
      p_invoice: invoiceId,
      p_number: invoice.invoiceNumber,
      p_kind: invoice.type === "return" ? "credit" : "invoice",
      p_actor: authUser.id,
    });
    if (claim.error) {
      const text = claim.error.message || "";
      if (text.includes("EINVOICE_ALREADY_ACCEPTED")) {
        // Idempotent: return the stored QR when already recorded.
        const { data: existing } = await service
          .from("einvoice_submissions")
          .select("qr, uuid, icv, einv_num, status")
          .eq("owner_id", access.ownerId)
          .eq("invoice_id", invoiceId)
          .maybeSingle();
        if (existing?.status === "accepted" && existing.qr) {
          return res.json({
            outcome: "accepted",
            qr: existing.qr,
            einvNum: existing.einv_num || "",
            messages: [],
            icv: Number(existing.icv) || 0,
            uuid: existing.uuid,
            saved: true,
          });
        }
        return res.status(409).json({ code: "already_accepted", message: "This invoice already has a tax QR" });
      }
      if (text.includes("EINVOICE_IN_PROGRESS")) return res.status(409).json({ code: "in_progress", message: "This invoice is being processed right now" });
      console.error("[e-invoice zatca claim]", text);
      return res.status(503).json({ code: "einvoice_unavailable", message: "Could not reserve the invoice counter" });
    }
    const reserved = Array.isArray(claim.data) ? claim.data[0] : claim.data;
    const uuid = String(reserved?.claim_uuid || "");
    const icv = Number(reserved?.claim_icv);

    const recorded = await service.rpc("einvoice_record", {
      p_owner: access.ownerId,
      p_invoice: invoiceId,
      p_status: "accepted",
      p_type_code: "zatca_phase1",
      p_payable: Number(invoice.totalAmount),
      p_xml: null,
      p_response: { phase: 1, provider: "zatca", timestamp, total, vat },
      p_qr: encoded.qr,
      p_einv_num: invoice.invoiceNumber,
      p_error: "",
    });
    if (recorded.error) {
      console.error("[e-invoice zatca record]", recorded.error.message);
      return res.status(503).json({ code: "einvoice_unavailable", message: "Could not save the tax QR" });
    }
    return res.json({
      outcome: "accepted",
      qr: encoded.qr,
      einvNum: invoice.invoiceNumber,
      messages: [],
      icv,
      uuid,
      saved: true,
    });
  });

  // Vite middleware for development. On Vercel the CDN serves `dist/`; this process is API-only.
  const onVercel = !!process.env.VERCEL;
  if (!isProduction) {
    console.log("Starting in development mode with Vite middleware...");
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);

    // Fallback search for index.html in dev mode (HTML/Navigation ONLY)
    app.use('*', async (req, res, next) => {
      const url = req.originalUrl;
      
      // Let API requests and file assets bypass html fallback and receive a proper 404
      if (url.startsWith('/api/')) {
        return res.status(404).json({ error: "API endpoint not found", path: url });
      }

      const hasExtension = path.extname(url.split('?')[0]) !== '';

      if (hasExtension) {
        return next();
      }

      try {
        let template = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf-8');
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (e) {
        vite.ssrFixStacktrace(e as Error);
        next(e);
      }
    });
  } else if (!onVercel) {
    const distPath = path.join(process.cwd(), 'dist');
    console.log(`Starting in production mode. Serving static files from: ${distPath}`);
    
    // Explicitly serve static files
    app.use(express.static(distPath, {
      index: false,
      setHeaders(res, filePath) {
        // Hashed bundles never change; index.html must always be fresh so it points at existing bundles.
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    }));
    
    // Serve index.html for all other routes (SPA)
    app.get('*', (req, res) => {
      const url = req.originalUrl;

      // Handle unmapped api routes correctly with JSON and static assets with 404
      if (url.startsWith('/api/')) {
        return res.status(404).json({ error: "API endpoint not found", path: url });
      }

      const hasExtension = path.extname(url.split('?')[0]) !== '';

      if (hasExtension) {
        return res.status(404).send("Not Found");
      }

      // Try resolving via absolute process directory first (most bulletproof configuration)
      res.setHeader("Cache-Control", "no-cache");
      const processPath = path.resolve(process.cwd(), 'dist/index.html');
      if (fs.existsSync(processPath)) {
        res.sendFile(processPath, { cacheControl: false });
      } else {
        // Fallback to __dirname resolved index.html
        res.sendFile(path.resolve(__dirname, '../dist/index.html'), { cacheControl: false });
      }
    });
  }

  // Global error handler for all API routes to ensure they ALWAYS return JSON instead of HTML
  app.use("/api/*", (err: any, req: any, res: any, next: any) => {
    console.error(`[API Error Middleware] Global handler caught error for ${req.method} ${req.originalUrl}:`, err);
    
    // De-structure error name and message
    const errorName = err.name || "InternalServerError";
    const errorMessage = err.message || "An unexpected error occurred while communicating with the server.";
    const statusCode = err.status || err.statusCode || 500;

    res.status(statusCode).json({
      error: isProduction ? "ServerError" : errorName,
      message: isProduction && statusCode >= 500 ? "An unexpected server error occurred." : errorMessage,
      details: isProduction ? undefined : err.stack,
    });
  });

  // Vercel serverless: export the Express app; do not bind a port.
  if (onVercel) return app;

  const server = app.listen(Number(PORT), "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`[Server] Port ${PORT} is already in use. Stop the other process or set PORT to a free port.`);
      process.exit(1);
    }
    throw err;
  });
  return app;
}

process.on("unhandledRejection", (reason) => {
  console.error("[Server] Unhandled promise rejection:", reason);
});

const booted = startServer();
export default booted;

if (!process.env.VERCEL) {
  void booted;
}
