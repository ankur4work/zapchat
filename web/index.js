// @ts-check
import { join } from "path";
import { readFileSync } from "fs";
import express from "express";
import serveStatic from "serve-static";

import shopify from "./shopify.js";
import cancelSubscription from "./cancel-subscription.js";
import GDPRWebhookHandlers from "./gdpr.js";
import dotenv from "dotenv";

import { connectToMongoDB } from "./mongodb.js";

dotenv.config();

/* ------------------------------------------------ */
/*                    CONFIG                         */
/* ------------------------------------------------ */

const PORT = parseInt(process.env.BACKEND_PORT || process.env.PORT || "3000", 10);

const STATIC_PATH =
  process.env.NODE_ENV === "production"
    ? `${process.cwd()}/frontend/dist`
    : `${process.cwd()}/frontend/`;

const PREMIUM_PLAN = "Premium";

const APP_NAMESPACE = "custom";
const SHOP_METAFIELD_KEY = "zapchat-whatsapp-button";
const APP_INSTALL_METAFIELD_KEY = "zapchat-whatsapp-button-premium";

const IS_TEST = false;

const APP_NAME = "zapchat-whatsapp-button";

const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  INTERNAL_SERVER_ERROR: 500,
};

/* ------------------------------------------------ */
/*                EXPRESS APP INIT                   */
/* ------------------------------------------------ */

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Force SameSite=None;Secure on all cookies so OAuth state survives
// cross-origin redirects in the Shopify admin iframe (Chrome blocks SameSite=Lax)
app.use((req, res, next) => {
  const _setHeader = res.setHeader.bind(res);
  res.setHeader = (name, value) => {
    if (name.toLowerCase() === "set-cookie") {
      const cookies = (Array.isArray(value) ? value : [value]).map((c) => {
        let out = c.replace(/;\s*SameSite=\w+/gi, "");
        out += "; SameSite=None";
        if (!/;\s*Secure/i.test(out)) out += "; Secure";
        return out;
      });
      return _setHeader(name, cookies);
    }
    return _setHeader(name, value);
  };
  next();
});

/* ------------------------------------------------ */
/*             SHOPIFY AUTH & WEBHOOKS               */
/* ------------------------------------------------ */

const APP_HANDLE = process.env.SHOPIFY_APP_HANDLE || "staging-76";
const EMBED_BLOCK_FILE = "whatsapp-chat-button";
const EMBED_BLOCK_TYPE = `shopify://apps/${APP_HANDLE}/blocks/${EMBED_BLOCK_FILE}`;
const SHOPIFY_API_VERSION = "2026-04";

async function activateEmbedBlock(req, res, next) {
  try {
    const session = res.locals.shopify?.session;
    if (!session?.accessToken) { next(); return; }

    const headers = { "X-Shopify-Access-Token": session.accessToken };
    const base = `https://${session.shop}/admin/api/${SHOPIFY_API_VERSION}`;

    const themesRes = await fetch(`${base}/themes.json?role=main`, { headers });
    const { themes } = await themesRes.json();
    const themeId = themes?.[0]?.id;
    if (!themeId) { next(); return; }

    const assetRes = await fetch(
      `${base}/themes/${themeId}/assets.json?asset[key]=config/settings_data.json`,
      { headers }
    );
    if (!assetRes.ok) { next(); return; }
    const { asset } = await assetRes.json();
    const settings = JSON.parse(asset?.value || "{}");

    const alreadyActive = Object.values(settings.current?.blocks || {})
      .some((b) => b.type === EMBED_BLOCK_TYPE);
    if (alreadyActive) { next(); return; }

    if (!settings.current) settings.current = {};
    if (!settings.current.blocks) settings.current.blocks = {};
    const blockKey = `${EMBED_BLOCK_TYPE}/${Math.random().toString(36).slice(2, 10)}`;
    settings.current.blocks[blockKey] = {
      type: EMBED_BLOCK_TYPE,
      settings: { phone_number: "", message: "" },
      disabled: false,
    };

    await fetch(`${base}/themes/${themeId}/assets.json`, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        asset: { key: "config/settings_data.json", value: JSON.stringify(settings, null, 2) },
      }),
    });

    console.log(`[ZapChat] App embed activated for ${session.shop}`);
  } catch (err) {
    console.error("[ZapChat] Embed activation failed (non-fatal):", err.message);
  }
  next();
}

// Temp: clears stale sessions so fresh OAuth can run
app.get("/api/clear-sessions", async (req, res) => {
  try {
    const collection = await connectToMongoDB();
    const result = await collection.deleteMany({});
    res.json({ deleted: result.deletedCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get(shopify.config.auth.path, shopify.auth.begin());

app.get(
  shopify.config.auth.callbackPath,
  shopify.auth.callback(),
  activateEmbedBlock,
  shopify.redirectToShopifyOrAppRoot()
);

app.post(
  shopify.config.webhooks.path,
  shopify.processWebhooks({ webhookHandlers: GDPRWebhookHandlers })
);

/* ------------------------------------------------ */
/*                   UTILITIES                       */
/* ------------------------------------------------ */

const getSession = (res) => res.locals.shopify.session;

const createGraphQLClient = (session) =>
  new shopify.api.clients.Graphql({ session });

const handleError = (res, code, message) => {
  console.error(message);
  res.status(code).send({ error: message });
};

/* ------------------------------------------------ */
/*                BILLING SERVICE                    */
/* ------------------------------------------------ */

// Direct GraphQL helper — bypasses the library
async function shopifyGraphQL(session, query, variables = {}) {
  const res = await fetch(
    `https://${session.shop}/admin/api/2026-04/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": session.accessToken,
      },
      body: JSON.stringify({ query, variables }),
    }
  );
  const json = await res.json();
  if (!res.ok) throw new Error(`GraphQL ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

const BillingService = {
  async check(session) {
    const { data } = await shopifyGraphQL(session, `{
      currentAppInstallation {
        activeSubscriptions {
          name
          status
        }
      }
    }`);
    const subs = data?.currentAppInstallation?.activeSubscriptions || [];
    return subs.some(s => s.status === "ACTIVE" && s.name === PREMIUM_PLAN);
  },

  async request(session) {
    const { data } = await shopifyGraphQL(session, `
      mutation appSubscriptionCreate($name: String!, $returnUrl: URL!, $test: Boolean, $lineItems: [AppSubscriptionLineItemInput!]!) {
        appSubscriptionCreate(name: $name, returnUrl: $returnUrl, test: $test, lineItems: $lineItems) {
          appSubscription { id }
          confirmationUrl
          userErrors { field message }
        }
      }
    `, {
      name: PREMIUM_PLAN,
      returnUrl: `https://${session.shop}/admin/apps/${process.env.SHOPIFY_API_KEY}`,
      test: IS_TEST,
      lineItems: [{
        plan: {
          appRecurringPricingDetails: {
            price: { amount: 100.0, currencyCode: "USD" },
            interval: "EVERY_30_DAYS",
          },
        },
      }],
    });
    const result = data?.appSubscriptionCreate;
    if (result?.userErrors?.length) {
      throw new Error(result.userErrors.map(e => e.message).join(", "));
    }
    return result?.confirmationUrl;
  },

  async cancel(session) {
    return await cancelSubscription(session);
  },
};

/* ------------------------------------------------ */
/*             SUBSCRIPTION SERVICE                  */
/* ------------------------------------------------ */

const SubscriptionService = {
  async getPlanTier(session) {
    try {
      const active = await BillingService.check(session);
      return active ? "premium" : "free";
    } catch (err) {
      console.error("Subscription check failed:", err);
      return "free";
    }
  },
};

/* ------------------------------------------------ */
/*                METAFIELD SERVICE                  */
/* ------------------------------------------------ */

const MetafieldService = {
  async getShopGid(session) {
    const { data } = await shopifyGraphQL(session, `{ shop { id } }`);
    const shopId = data?.shop?.id;
    if (!shopId) throw new Error("Shop ID not found");
    return shopId;
  },

  async updateShopMetafield(session, tier) {
    const ownerId = await this.getShopGid(session);
    await shopifyGraphQL(session, CREATE_APP_DATA_METAFIELD, {
      metafieldsSetInput: [{
        ownerId,
        namespace: APP_NAMESPACE,
        key: SHOP_METAFIELD_KEY,
        type: "single_line_text_field",
        value: tier === "premium" ? "premium" : "free",
      }],
    });
  },

  async ensureAppMetafield(session) {
    const { data } = await shopifyGraphQL(session, CURRENT_APP_INSTALLATION, {
      namespace: APP_NAMESPACE,
      key: APP_INSTALL_METAFIELD_KEY,
    });
    const ownerId = data?.currentAppInstallation?.id;
    const existing = data?.currentAppInstallation?.metafield;
    if (!existing && ownerId) {
      await shopifyGraphQL(session, CREATE_APP_DATA_METAFIELD, {
        metafieldsSetInput: [{
          namespace: APP_NAMESPACE,
          key: APP_INSTALL_METAFIELD_KEY,
          type: "boolean",
          value: "true",
          ownerId,
        }],
      });
    }
  },

  async deleteAppMetafield(session) {
    const { data } = await shopifyGraphQL(session, CURRENT_APP_INSTALLATION, {
      namespace: APP_NAMESPACE,
      key: APP_INSTALL_METAFIELD_KEY,
    });
    const ownerId = data?.currentAppInstallation?.id;
    const existing = data?.currentAppInstallation?.metafield;
    if (ownerId && existing) {
      await shopifyGraphQL(session, APP_OWNED_METAFIELD_DELETE, {
        ownerId,
        namespace: APP_NAMESPACE,
        key: APP_INSTALL_METAFIELD_KEY,
      });
    }
  },
};

/* ------------------------------------------------ */
/*           PUBLIC SUBSCRIPTION CHECK               */
/* ------------------------------------------------ */

app.get("/api/scroll-to-top/hasSubscription", async (req, res) => {
  try {
    const { shop } = req.query;

    if (!shop) {
      return handleError(res, HTTP_STATUS.BAD_REQUEST, "Missing shop parameter");
    }

    const collection = await connectToMongoDB();
    const session = await collection.findOne({ shop });

    if (!session) {
      return handleError(res, HTTP_STATUS.UNAUTHORIZED, "Session not found");
    }

    const tier = await SubscriptionService.getPlanTier(session);

    await MetafieldService.updateShopMetafield(session, tier);

    res.status(HTTP_STATUS.OK).send({
      hasActiveSubscription: tier !== "free",
      tier,
    });
  } catch (err) {
    handleError(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, err.message);
  }
});

/* ------------------------------------------------ */
/*            PROTECTED ROUTES (AUTH)                */
/* ------------------------------------------------ */

app.use("/api", async (req, res, next) => {
  try {
    const sessionId = await shopify.api.session.getCurrentId({
      isOnline: false,
      rawRequest: req,
      rawResponse: res,
    });
    if (!sessionId) {
      const shop = req.query.shop;
      if (shop) return res.redirect(`/api/auth?shop=${shop}`);
      return res.status(401).json({ error: "No session" });
    }
    const session = await shopify.config.sessionStorage.loadSession(sessionId);
    if (!session?.accessToken) {
      const shop = sessionId.replace("offline_", "");
      return res.redirect(`/api/auth?shop=${shop}`);
    }
    // Test token validity with a lightweight request
    const testRes = await fetch(`https://${session.shop}/admin/api/2026-04/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": session.accessToken },
      body: JSON.stringify({ query: "{ shop { name } }" }),
    });
    if (testRes.status === 403) {
      console.log("[Auth] Stale token detected, clearing session:", sessionId);
      await shopify.config.sessionStorage.deleteSession(sessionId);
      const shop = sessionId.replace("offline_", "");
      const authUrl = `/api/auth?shop=${shop}`;
      // Requests with Authorization header are AJAX (app-bridge) — return JSON, not redirect
      const isAjax = !!req.headers["authorization"];
      if (isAjax) return res.status(401).json({ requiresReauth: true, authUrl });
      return res.redirect(authUrl);
    }
    res.locals.shopify = { session };
    next();
  } catch (err) {
    console.error("[Auth] Error:", err.message);
    const shop = req.query.shop;
    if (shop) return res.redirect(`/api/auth?shop=${shop}`);
    res.status(401).json({ error: "Authentication failed" });
  }
});

/* ------------------------------------------------ */
/*           CREATE SUBSCRIPTION ROUTE               */
/* ------------------------------------------------ */

app.get("/api/createSubscription", async (req, res) => {
  try {
    const session = getSession(res);

    // Check if already subscribed
    let active = false;
    try {
      active = await BillingService.check(session);
    } catch (e) {
      console.warn("Billing check failed, assuming no subscription:", e.message);
    }

    if (active) {
      try { await MetafieldService.updateShopMetafield(session, "premium"); } catch (e) {}
      return res.send({ isActiveSubscription: true, plan: PREMIUM_PLAN });
    }

    // Request new subscription
    const confirmationUrl = await BillingService.request(session);
    console.log("Billing confirmation URL:", confirmationUrl);

    res.send({
      isActiveSubscription: false,
      plan: PREMIUM_PLAN,
      confirmationUrl,
    });
  } catch (err) {
    console.error("Create subscription error:", err.message);
    handleError(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, err.message);
  }
});

/* ------------------------------------------------ */
/*             CANCEL SUBSCRIPTION ROUTE             */
/* ------------------------------------------------ */

app.get("/api/cancelSubscription", async (req, res) => {
  try {
    const session = getSession(res);

    const active = await BillingService.check(session);

    if (!active) {
      return res.send({ status: "No subscription found" });
    }

    const status = await BillingService.cancel(session);

    await MetafieldService.deleteAppMetafield(session);
    await MetafieldService.updateShopMetafield(session, "free");

    res.send({
      status,
      cancelledPlan: PREMIUM_PLAN,
    });
  } catch (err) {
    handleError(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, err.message);
  }
});

/* ------------------------------------------------ */
/*           CHECK ACTIVE SUBSCRIPTION               */
/* ------------------------------------------------ */

app.get("/api/hasActiveSubscription", async (req, res) => {
  try {
    const session = getSession(res);
    const tier = await SubscriptionService.getPlanTier(session);

    // Try to update metafields but don't fail if it errors
    try {
      if (tier === "premium") {
        await MetafieldService.ensureAppMetafield(session);
      }
      await MetafieldService.updateShopMetafield(session, tier);
    } catch (e) {
      console.warn("Metafield update skipped:", e.message);
    }

    res.send({
      hasActiveSubscription: tier === "premium",
      tier,
    });
  } catch (err) {
    // Return free plan as safe default instead of crashing
    res.send({ hasActiveSubscription: false, tier: "free" });
  }
});

/* ------------------------------------------------ */
/*                 SHOP INFO ROUTE                   */
/* ------------------------------------------------ */

app.get("/api/getshop", (req, res) => {
  const session = getSession(res);
  res.json({ shop: session?.shop || null });
});

// Debug: check what the token actually has
app.get("/api/debug-session", async (req, res) => {
  const session = getSession(res);
  const token = session?.accessToken || "none";
  const maskedToken = token.length > 8 ? token.slice(0, 4) + "..." + token.slice(-4) : token;

  // Try a direct fetch to Shopify GraphQL
  let apiResult = "not tested";
  try {
    const response = await fetch(
      `https://${session.shop}/admin/api/2026-04/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": session.accessToken,
        },
        body: JSON.stringify({ query: "{ shop { name } }" }),
      }
    );
    apiResult = { status: response.status, body: await response.text() };
  } catch (e) {
    apiResult = { error: e.message };
  }

  res.json({
    shop: session?.shop,
    scope: session?.scope,
    token: maskedToken,
    isOnline: session?.isOnline,
    apiResult,
  });
});

/* ------------------------------------------------ */
/*              FRONTEND SERVING                     */
/* ------------------------------------------------ */

app.use(shopify.cspHeaders());

app.use(serveStatic(STATIC_PATH, { index: false }));

app.use("/", shopify.ensureInstalledOnShop(), async (_req, res) => {
  res
    .status(200)
    .set("Content-Type", "text/html")
    .send(readFileSync(join(STATIC_PATH, "index.html")));
});

app.listen(PORT, () =>
  console.log(`🚀 Server running on http://localhost:${PORT}`)
);

/* ------------------------------------------------ */
/*                   GRAPHQL                         */
/* ------------------------------------------------ */

const CURRENT_APP_INSTALLATION = `
query appSubscription($namespace: String!, $key: String!) {
  currentAppInstallation {
    id
    metafield(namespace: $namespace, key: $key) {
      namespace
      key
      value
      id
    }
  }
}
`;

const CREATE_APP_DATA_METAFIELD = `
mutation CreateAppDataMetafield($metafieldsSetInput: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafieldsSetInput) {
    metafields { id namespace key }
    userErrors { field message }
  }
}
`;

const APP_OWNED_METAFIELD_DELETE = `
mutation appOwnedMetafieldDelete($ownerId: ID!, $namespace: String!, $key: String!) {
  appOwnedMetafieldDelete(ownerId: $ownerId, namespace: $namespace, key: $key) {
    deletedId
    userErrors { field message }
  }
}
`;