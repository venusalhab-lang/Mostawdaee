import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { GoogleAuth } from "google-auth-library";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Determine production mode robustly based on environment variable or the executed bundler file path
const isProduction = process.env.NODE_ENV === "production" || 
                     __filename.endsWith("server.js") || 
                     __filename.includes("dist") ||
                     !fs.existsSync(path.resolve(process.cwd(), 'src/main.tsx'));

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

let firebaseAdminReady = false;
function ensureFirebaseAdmin() {
  if (getApps().length > 0) {
    firebaseAdminReady = true;
    return true;
  }
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) return false;
  try {
    const credential = JSON.parse(raw);
    initializeApp({ credential: cert(credential) });
    firebaseAdminReady = true;
    return true;
  } catch (error) {
    console.error("[Firebase Admin] Invalid FIREBASE_SERVICE_ACCOUNT_JSON:", error);
    return false;
  }
}


const PLAY_PRODUCT_ID = "mostawdaee_premium_100";

type PlayVerification =
  | { ok: true; expiryDate: string }
  | { ok: false; status: number; message: string };

/**
 * Verifies a purchase token with the Google Play Developer API (never trust the client).
 * Fails closed: without credentials the subscription is NOT granted.
 */
async function verifyPlaySubscription(purchaseToken: string): Promise<PlayVerification> {
  const raw = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
  const packageName = process.env.GOOGLE_PLAY_PACKAGE_NAME || "com.mostawdaee.app";
  if (!raw) {
    return { ok: false, status: 503, message: "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is not configured on the server" };
  }

  let credentials: any;
  try {
    credentials = JSON.parse(raw);
  } catch {
    return { ok: false, status: 503, message: "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is not valid JSON" };
  }

  try {
    const auth = new GoogleAuth({ credentials, scopes: ["https://www.googleapis.com/auth/androidpublisher"] });
    const client = await auth.getClient();
    const accessToken = (await client.getAccessToken()).token;
    if (!accessToken) return { ok: false, status: 502, message: "Could not obtain a Google Play API token" };

    const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (response.status === 404 || response.status === 400) {
      return { ok: false, status: 400, message: "Purchase token was not found in Google Play" };
    }
    if (!response.ok) {
      return { ok: false, status: 502, message: `Google Play verification failed (${response.status})` };
    }

    const data: any = await response.json();
    const state = String(data?.subscriptionState || "");
    const activeStates = ["SUBSCRIPTION_STATE_ACTIVE", "SUBSCRIPTION_STATE_IN_GRACE_PERIOD"];
    if (!activeStates.includes(state)) {
      return { ok: false, status: 402, message: `Subscription is not active (${state || "unknown"})` };
    }

    const line = (data?.lineItems || []).find((item: any) => item?.productId === PLAY_PRODUCT_ID);
    if (!line) {
      return { ok: false, status: 400, message: "Purchase token does not belong to the premium product" };
    }

    const expiryMs = Date.parse(line.expiryTime || "");
    if (!Number.isFinite(expiryMs) || expiryMs <= Date.now()) {
      return { ok: false, status: 402, message: "Subscription has already expired" };
    }
    return { ok: true, expiryDate: new Date(expiryMs).toISOString() };
  } catch (error: any) {
    console.error("[Play verification]", error);
    return { ok: false, status: 502, message: error?.message || "Google Play verification error" };
  }
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

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;
  if (isProduction) app.set("trust proxy", 1); // real client IP behind a reverse proxy

  // Add robust but clean request logging (API and primary navigation only)
  app.use((req, res, next) => {
    const url = req.url;
    const isApi = url.startsWith('/api/');
    const isHtml = req.headers.accept && req.headers.accept.includes('text/html');
    const hasExtension = path.extname(url.split('?')[0]) !== '';

    if (isApi || (isHtml && !hasExtension && !url.includes('__vite') && !url.includes('hot'))) {
      console.log(`[Express Server] Incoming request: ${req.method} ${url}`);
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

  app.post("/api/firebase-session", async (req, res) => {
    try {
      if (!rateLimit(`session:${req.ip}`, 30, 60_000)) {
        return res.status(429).json({ message: "Too many requests" });
      }
      const user = await getRequestUser(req);
      if (!user) {
        return res.status(401).json({ message: "Invalid or missing Supabase session" });
      }

      if (!ensureFirebaseAdmin()) {
        return res.status(503).json({
          message: "FIREBASE_SERVICE_ACCOUNT_JSON is not configured on the server",
        });
      }

      const token = await getAuth().createCustomToken(user.id, {
        email: user.email || "",
        provider: "supabase",
      });
      return res.json({ token });
    } catch (error: any) {
      console.error("[Firebase session]", error);
      return res.status(500).json({ message: error?.message || "Failed to mint Firebase session" });
    }
  });

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

      if (productId !== "mostawdaee_premium_100" || platform !== "play") {
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
        return res.status(503).json({ message: "SUPABASE_SERVICE_ROLE_KEY is not configured" });
      }

      // 1. Verify the purchase with Google Play (fails closed)
      const verification = await verifyPlaySubscription(purchaseToken);
      if (verification.ok === false) {
        return res.status(verification.status).json({ message: verification.message });
      }

      // 2. A purchase token can only ever belong to ONE account (blocks sharing/replaying a valid token)
      const { data: existingPurchase, error: lookupError } = await service
        .from("play_purchases")
        .select("user_id")
        .eq("purchase_token", purchaseToken)
        .maybeSingle();
      if (lookupError) {
        return res.status(503).json({ message: `play_purchases table is not available: ${lookupError.message}` });
      }
      if (existingPurchase && existingPurchase.user_id !== user.id) {
        return res.status(409).json({ message: "This purchase is already linked to another account" });
      }
      if (!existingPurchase) {
        const { error: insertError } = await service.from("play_purchases").insert({
          purchase_token: purchaseToken,
          user_id: user.id,
          product_id: productId,
        });
        if (insertError) {
          return res.status(500).json({ message: insertError.message });
        }
      }

      const expiryDate = verification.expiryDate;
      const { error: subError } = await service.from("user_subscriptions").upsert({
        user_id: user.id,
        subscription_status: "active",
        expiry_date: expiryDate,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });

      if (subError) {
        return res.status(500).json({ message: subError.message });
      }

      await service.from("profiles").update({
        is_premium: true,
        user_role: "premium",
        role: "premium",
        subscription_status: "active",
        updated_at: new Date().toISOString(),
      }).eq("id", user.id);

      return res.json({ ok: true, expiry_date: expiryDate });
    } catch (error: any) {
      console.error("[Subscription activate]", error);
      return res.status(500).json({ message: error?.message || "Activation failed" });
    }
  });

  // Supabase Auth Callback Route
  // Serve the frontend React SPA (index.html) directly for `/auth/callback` on the server-side.
  // This guarantees that the Single Page Application's assets load correctly,
  // and enables the client-side Supabase SDK to parse both query string and hash parameters flawlessly.
  app.get(["/auth/callback", "/auth/callback/"], async (req, res, next) => {
    console.log(`[Express Server] /auth/callback triggered client-side fallback query:`, req.query);
    
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
  app.get("/api/exchange-rate/:base", async (req, res) => {
    const { base } = req.params;
    const baseUpper = (base || "USD").toUpperCase();
    
    // Built-in offline fallback dictionary
    const fallbackRates: Record<string, Record<string, number>> = {
      USD: { USD: 1, JOD: 0.709, ILS: 3.70, EGP: 47.50, EUR: 0.92, SAR: 3.75, AED: 3.67 },
      JOD: { JOD: 1, USD: 1.41, ILS: 5.22, EGP: 67.00, EUR: 1.30, SAR: 5.29, AED: 5.18 },
      ILS: { ILS: 1, USD: 0.27, JOD: 0.1916, EGP: 12.83, EUR: 0.25, SAR: 1.01, AED: 0.99 }
    };

    try {
      const response = await fetch(`https://open.er-api.com/v6/latest/${baseUpper}`);
      if (!response.ok) {
        throw new Error(`External service responded with status ${response.status}`);
      }
      const data = await response.json();
      res.json(data);
    } catch (error) {
      console.warn(`[Exchange Proxy] Failed to fetch external rates for ${baseUpper}, serving local fallbacks.`, error);
      
      const rates = fallbackRates[baseUpper] || fallbackRates["USD"];
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
      model: "gemini-3.5-flash",
      features: {
        chat: initialized,
        analysis: initialized
      }
    });
  });

  app.post("/api/chat", async (req, res, next) => {
    // The real Gemini key is paid: only signed-in users may use it, with a rate limit.
    // (The offline fallback below costs nothing, so guests can still use it.)
    if (getAI()) {
      const authUser = await getRequestUser(req);
      if (!authUser) {
        return res.status(401).json({ message: "Sign in to use the AI assistant" });
      }
      if (!rateLimit(`chat:${authUser.id}`, 30, 60_000)) {
        return res.status(429).json({ message: "Too many requests, please slow down" });
      }
    } else if (!rateLimit(`chat:${req.ip}`, 60, 60_000)) {
      return res.status(429).json({ message: "Too many requests, please slow down" });
    }
    const { message, history, context, verbosity, currency } = req.body;
    const currencyLabel = currency === 'JOD' ? 'الدينار الأردني (JOD)' : currency === 'USD' ? 'الدولار الأمريكي ($)' : 'الشيكل الإسرائيلي (₪)';
    const verbosityInstruction = verbosity === 'concise' 
      ? "يجب أن تكون إجاباتك قصيرة جداً ومباشرة. استخدم النقاط (bullet points) فقط. يمنع تماماً استخدام أي مقدمات أو خاتمة. قدم المعلومة فوراً وبأقل قدر ممكن من الكلمات والرموز المكررة."
      : "قدم شرحاً مهنياً دقيقاً وهادفاً لكل نقطة مع توضيح الأسباب والتحليل المالي المباشر بشكل مميز وسهل الفهم.";

    const genAI = getAI();
    if (!genAI) {
      // Simulate/fallback offline smart handler when API key is missing, without raising console warnings or throwing errors
      const lowercaseMsg = (message || "").toLowerCase();
      let fallbackText = "";
      let fallbackAction: any = undefined;

      if (lowercaseMsg.includes("أضف صنف") || lowercaseMsg.includes("اضف صنف") || lowercaseMsg.includes("أضف منتج") || lowercaseMsg.includes("اضف منتج") || lowercaseMsg.includes("add product") || lowercaseMsg.includes("create product")) {
        const prNameMatch = (message || "").match(/(?:منتج|صنف|باسم|اسم|بإسم)\s+([^\s،,]+)/) || (message || "").match(/(?:add|create)\s+([a-zA-Z0-9\s]+)/i);
        const prName = prNameMatch ? prNameMatch[1] : "صنف مسحوق";
        fallbackText = `**تم معالجة الطلب بنجاح! تم رصد رغبتك في إضافة صنف جديد باسم: "${prName}"**\n\n• **المحاكاة الذكية الذاتية:** تم صياغة هيكلية المنتج وإدراج الرمز الشريطي والبيانات الافتراضية المناسبة محلياً!\n\n• **تنويه مالك النظام:** للاستفادة الكاملة من محرك التحليلات الفوري للأصناف والتقارير عبر الذكاء الاصطناعي، يرجى ملء مفتاح \`GEMINI_API_KEY\` صالح من خلال الإعدادات (Settings > Secrets). تفعيل المفتاح يربطك بالخادم الحقيقي مباشرة.`;
        fallbackAction = {
          type: "add_product",
          product: {
            name: prName,
            sku: "AUTO-" + Math.floor(1000 + Math.random() * 9000),
            category: "افتراضي",
            brand: "عالمي",
            quantity: 15,
            unitCost: 10,
            sellingPrice: 18,
            lowStockThreshold: 3
          }
        };
      } else if (lowercaseMsg.includes("حذف صنف") || lowercaseMsg.includes("حذف منتج") || lowercaseMsg.includes("delete product") || lowercaseMsg.includes("remove product")) {
        fallbackText = `**تم تلقي مؤشر الرغبة في حذف صنف:**\n\n• **توصية لوجستية:** حماية لسلامة المستندات المالية والقيود المحاسبية التراكمية، يُنصح دائماً بالقيام بعمليات الحذف يدوياً عبر قائمة المنتجات المتاحة للتأكيد التام والتفحيص.`;
      } else if (lowercaseMsg.includes("فاتورة") || lowercaseMsg.includes("invoice") || lowercaseMsg.includes("تقرير مبيعات")) {
        fallbackText = `**توجيه نظام الفواتير الذكي:**\n\n• المساعد في وضع المحاكاة المحمية حالياً.\n\n• يمكنك إنشاء التقارير المالية والفواتير التفصيلية لكافة المبيعات والمشتريات بمرونة تامة عبر الضغط مباشرة على خيار (Invoice System) المتواجد بالقائمة الجانبية بنظام معالجة فائق السرعة.`;
      } else {
        const totalProducts = context?.products?.length || 0;
        const lowStockCount = context?.products?.filter((p: any) => p.quantity <= (p.lowStockThreshold || 3))?.length || 0;
        
        fallbackText = `**مرحباً بك في مستودعي الذكي!** 🤖✨\n\n• **حالة المستودع الحالية:** يحتوي نظامك المحاسبي واللوجستي على **${totalProducts}** منتج مقيد.\n\n• **رصد النقص:** يوجد **${lowStockCount}** منتج برصيد حرج منخفض يرجى إعادة طلبها لتجنب نفاد المخزون.\n\n• **ملاحظة فنية هامة:** مفتاح بوابة الذكاء الاصطناعي السحابية \`GEMINI_API_KEY\` مفقود أو غير فعال. كمالك للمستودع يمكنك تزويده في أي وقت عبر تبويب (Settings > Secrets) لتنشيط نماذج المحادثات الحقيقية المتقدمة وتحليل الفواتير فورياً.`;
      }

      return res.json({
        text: fallbackText,
        action: fallbackAction,
        isSimulated: true
      });
    }

    try {

      // Support multi-turn chat contents from history
      let contentsList: any[] = [];
      if (Array.isArray(history) && history.length > 0) {
        // Exclude initial assistant welcome message to prevent polluting context
        const filteredHistory = history.filter((h: any, idx: number) => {
          if (idx === 0 && h.role === "assistant") return false;
          return !!h.content;
        });

        contentsList = filteredHistory.map((h: any) => {
          return {
            role: h.role === "assistant" ? "model" : "user",
            parts: [{ text: h.content }]
          };
        });

        // Ensure the latest user message is appended if not already the last turn
        const lastTurn = filteredHistory[filteredHistory.length - 1];
        if (message && (!lastTurn || lastTurn.content !== message || lastTurn.role !== 'user')) {
          contentsList.push({
            role: "user",
            parts: [{ text: message }]
          });
        }
      } else {
        contentsList = [{ role: "user", parts: [{ text: message || "مرحبا" }] }];
      }

      console.log(`[Express Server] Calling Gemini API (gemini-3.5-flash) with ${contentsList.length} chat turns.`);

      const response = await genAI.models.generateContent({
        model: "gemini-3.5-flash",
        contents: contentsList,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              text: {
                type: Type.STRING,
                description: "Conversational textual reply in Arabic (or matching language) following the strict rules of spacing and formatting."
              },
              action: {
                type: Type.OBJECT,
                description: "Optional action if the user wants to add/update/delete records",
                properties: {
                  type: {
                    type: Type.STRING,
                    description: "The action to execute: 'add_product', 'delete_product', 'add_invoice', 'add_customer'"
                  },
                  product: {
                    type: Type.OBJECT,
                    properties: {
                      name: { type: Type.STRING },
                      sku: { type: Type.STRING },
                      category: { type: Type.STRING },
                      brand: { type: Type.STRING },
                      quantity: { type: Type.NUMBER },
                      unitCost: { type: Type.NUMBER },
                      sellingPrice: { type: Type.NUMBER },
                      lowStockThreshold: { type: Type.NUMBER }
                    },
                    required: ["name"]
                  },
                  productId: {
                    type: Type.STRING
                  },
                  invoice: {
                    type: Type.OBJECT,
                    properties: {
                      invoiceNumber: { type: Type.STRING },
                      subtotal: { type: Type.NUMBER },
                      taxAmount: { type: Type.NUMBER },
                      totalAmount: { type: Type.NUMBER },
                      type: { type: Type.STRING, description: "either 'sale' or 'purchase'" },
                      items: {
                        type: Type.ARRAY,
                        items: {
                          type: Type.OBJECT,
                          properties: {
                            productId: { type: Type.STRING },
                            description: { type: Type.STRING },
                            quantity: { type: Type.NUMBER },
                            unitPrice: { type: Type.NUMBER },
                            total: { type: Type.NUMBER }
                          },
                          required: ["productId", "description", "quantity", "unitPrice", "total"]
                        }
                      }
                    },
                    required: ["invoiceNumber", "totalAmount", "type", "items"]
                  },
                  customer: {
                    type: Type.OBJECT,
                    properties: {
                      name: { type: Type.STRING },
                      phone: { type: Type.STRING },
                      currency: { type: Type.STRING }
                    },
                    required: ["name"]
                  }
                },
                required: ["type"]
              }
            },
            required: ["text"]
          },
          systemInstruction: `أنت 'مساعد مستودعي الذكي' (Mostawdaee Smart Assistant). مستشار خبير في التكنولوجيا المالية ومستودعات التجارة الدولية واللوجستيات وحساب التكلفة الواصلة (Landed Cost).

          قواعد صارمة ومحددة للغاية للإجابات:
          1. ممنوع تماماً المقدمات والترحيب الباهت والتمهيد أو الخاتمة والتوديع. ابدأ فوراً بصلب الجواب.
          2. يجب تقديم إجابات ذكية وعملية وتكون قصيرة للغاية ومباشرة (Direct and Highly Concise).
          3. صِغ الرد بنقاط قصيرة جداً (Short Bullet Points)، مع ترك سطر فارغ بين كل نقطة وأخرى (Double Line Breaks '\\n\\n') لتحقيق وضوح بصري فائق ومريح للعين.
          4. احرص على استخدام الخط العريض للمصطلحات الجوهرية (مثال: **توصية:** أو **المخزون:**) ليسهل على العميل مسحها ببصرة واحدة.
          5. لغة الرد مطابقة للغة المستخدم؛ إن سألك بالعربية أجب بالفصحى الدقيقة، وإن سألك بالإنجليزية فقابلها بها بالكامل مع الحفاظ التام على شروط القصر والتنسيق النقطي الفسيح ومحاسبة العملة.
          6. إذا طلب منك المستخدم بشكل صريح إضافة صنف (منتج) جديد، أو حذف صنف، أو تسجيل فاتورة مبيعات/مشتريات جديدة أو إضافة عميل جديد، يجب عليك تضمين حقل الـ 'action' المناسب بالبيانات المستخرجة وتعيين 'type' ليكون أحد الأنواع التالية: 'add_product' أو 'delete_product' أو 'add_invoice' أو 'add_customer'.
             - لعمل إضافة منتج ('add_product'): استخرج الاسم (name)، والرمز (sku)، والتكلفة (unitCost)، وسعر البيع (sellingPrice)، والكمية (quantity). إذا لم يذكر رمز الصنف ابتكره من اسم الصنف بالإنجليزية أو رمز عشوائي.
             - لعمل حذف صنف ('delete_product'): ابحث عن الـ id الخاص بالصنف من المنتجات المتوفرة في السياق، وعيّنه في 'productId'.
             - لعمل فاتورة ('add_invoice'): عيّن 'invoiceNumber' عشوائي أو رقم الفاتورة المذكور، وحدد 'type' ليكون 'sale' (مبيعات) أو 'purchase' (مشتريات)، وحدد تفاصيل الأصناف في قائمة 'items'. قم بحساب قيم 'subtotal' و'totalAmount'.
             - لعمل إضافة عميل ('add_customer'): استخرج الاسم (name) ورقم الهاتف (phone) والعملة المفضلة (currency).
          
          الوضع والتعليمات التفصيلية:
          \${verbosityInstruction}
          
          سياق المخزون الحالي الفعلي للمستخدم بالتفصيل:
          \${JSON.stringify(context)}
          
          المستخدم يدير مستودعه في منطقة محاسبية تعتمد: \${currencyLabel}.`,
        },
      });

      let responseText = "";
      try {
        responseText = response.text || "";
      } catch (err) {
        console.warn("Could not retrieve '.text' from Gemini response directly:", err);
      }

      if (!responseText && response.candidates && response.candidates.length > 0) {
        const candidate = response.candidates[0];
        if (candidate.content && candidate.content.parts) {
          responseText = candidate.content.parts
            .map((part: any) => part.text || "")
            .join("");
        }
      }

      const finalListText = responseText || "{}";
      
      let parsedData: any = { text: "عذراً، لم أتمكن من الحصول على رد مفيد." };
      try {
        parsedData = JSON.parse(finalListText);
      } catch (err) {
        console.warn("Could not parse result as JSON directly, creating fallback shape:", err);
        parsedData = { text: finalListText };
      }

      res.json(parsedData);
    } catch (error: any) {
      console.warn("Gemini API Error in /api/chat route handler, initiating smart local fallback simulation:", error?.message || error);
      
      const lowercaseMsg = (message || "").toLowerCase();
      let fallbackText = "";
      let fallbackAction: any = undefined;

      // Clean check if the user is explicitly requesting to add a product
      if (lowercaseMsg.includes("أضف صنف") || lowercaseMsg.includes("اضف صنف") || lowercaseMsg.includes("أضف منتج") || lowercaseMsg.includes("اضف منتج") || lowercaseMsg.includes("add product") || lowercaseMsg.includes("create product")) {
        const prNameMatch = (message || "").match(/(?:منتج|صنف|باسم|اسم|بإسم)\s+([^\s،,]+)/) || (message || "").match(/(?:add|create)\s+([a-zA-Z0-9\s]+)/i);
        const prName = prNameMatch ? prNameMatch[1] : "صنف مسحوق";
        fallbackText = `**تم معالجة الطلب بنجاح! تم رصد رغبتك في إضافة صنف جديد باسم: "${prName}"**\n\n• **المحاكاة الذكية الذاتية:** تم صياغة هيكلية المنتج وإدراج الرمز الشريطي والبيانات الافتراضية المناسبة محلياً!\n\n• **تنويه مالك النظام:** للاستفادة الكاملة من محرك التحليلات الفوري للأصناف والتقارير عبر الذكاء الاصطناعي، يرجى ملء مفتاح \`GEMINI_API_KEY\` صالح من خلال الإعدادات (Settings > Secrets). تفعيل المفتاح يربطك بالخادم الحقيقي مباشرة.`;
        fallbackAction = {
          type: "add_product",
          product: {
            name: prName,
            sku: "AUTO-" + Math.floor(1000 + Math.random() * 9000),
            category: "افتراضي",
            brand: "عالمي",
            quantity: 15,
            unitCost: 10,
            sellingPrice: 18,
            lowStockThreshold: 3
          }
        };
      } else if (lowercaseMsg.includes("حذف صنف") || lowercaseMsg.includes("حذف منتج") || lowercaseMsg.includes("delete product") || lowercaseMsg.includes("remove product")) {
        fallbackText = `**تم تلقي مؤشر الرغبة في حذف صنف:**\n\n• **توصية لوجستية:** حماية لسلامة المستندات المالية والقيود المحاسبية التراكمية، يُنصح دائماً بالقيام بعمليات الحذف يدوياً عبر قائمة المنتجات المتاحة للتأكيد التام والتفحيص.`;
      } else if (lowercaseMsg.includes("فاتورة") || lowercaseMsg.includes("invoice") || lowercaseMsg.includes("تقرير مبيعات")) {
        fallbackText = `**توجيه نظام الفواتير الذكي:**\n\n• المساعد في وضع المحاكاة المحمية حالياً.\n\n• يمكنك إنشاء التقارير المالية والفواتير التفصيلية لكافة المبيعات والمشتريات بمرونة تامة عبر الضغط مباشرة على خيار (Invoice System) المتواجد بالقائمة الجانبية بنظام معالجة فائق السرعة.`;
      } else {
        const totalProducts = context?.products?.length || 0;
        const lowStockCount = context?.products?.filter((p: any) => p.quantity <= (p.lowStockThreshold || 3))?.length || 0;
        
        fallbackText = `**مرحباً بك في مستودعي الذكي!** 🤖✨\n\n• **حالة المستودع الحالية:** يحتوي نظامك المحاسبي واللوجستي على **${totalProducts}** منتج مقيد.\n\n• **رصد النقص:** يوجد **${lowStockCount}** منتج برصيد حرج منخفض يرجى إعادة طلبها لتجنب نفاد المخزون.\n\n• **ملاحظة فنية هامة:** مفتاح بوابة الذكاء الاصطناعي السحابية \`GEMINI_API_KEY\` مفقود أو غير فعال. كمالك للمستودع يمكنك تزويده في أي وقت عبر تبويب (Settings > Secrets) لتنشيط نماذج المحادثات الحقيقية المتقدمة وتحليل الفواتير فورياً.`;
      }

      res.json({
        text: fallbackText,
        action: fallbackAction,
        isSimulated: true
      });
    }
  });

  // Vite middleware for development
  if (!isProduction) {
    console.log("Starting in development mode with Vite middleware...");
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
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    console.log(`Starting in production mode. Serving static files from: ${distPath}`);
    
    // Explicitly serve static files
    app.use(express.static(distPath, { index: false }));
    
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
      const processPath = path.resolve(process.cwd(), 'dist/index.html');
      if (fs.existsSync(processPath)) {
        res.sendFile(processPath);
      } else {
        // Fallback to __dirname resolved index.html
        res.sendFile(path.resolve(__dirname, '../dist/index.html'));
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
      error: errorName,
      message: errorMessage,
      details: process.env.NODE_ENV !== "production" ? err.stack : undefined
    });
  });

  app.listen(Number(PORT), "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
