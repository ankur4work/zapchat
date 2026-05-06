import { ApiVersion, Session } from "@shopify/shopify-api";
import { shopifyApp } from "@shopify/shopify-app-express";
import { restResources } from "@shopify/shopify-api/rest/admin/2026-01";
import { MongoClient } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

function buildMongoSessionStorage(mongoUrl, dbName) {
  const client = new MongoClient(mongoUrl);
  let db;

  async function col() {
    if (!db) {
      await client.connect();
      db = client.db(dbName);
      console.log("[SessionDB] Connected to MongoDB");
    }
    return db.collection("shopify_sessions");
  }

  return {
    async storeSession(session) {
      try {
        const c = await col();
        const doc = Object.fromEntries(session.toPropertyArray());
        doc._id = session.id;
        await c.replaceOne({ _id: session.id }, doc, { upsert: true });
        console.log("[SessionDB] Stored:", session.id, "shop:", session.shop, "scopes:", session.scope);
        return true;
      } catch (err) {
        console.error("[SessionDB] storeSession FAILED:", err.message);
        return false;
      }
    },
    async loadSession(id) {
      try {
        const c = await col();
        const doc = await c.findOne({ _id: id });
        if (!doc) { console.log("[SessionDB] loadSession not found:", id); return undefined; }
        const { _id, ...props } = doc;
        const session = Session.fromPropertyArray(Object.entries(props));
        console.log("[SessionDB] Loaded:", id, "shop:", session.shop, "hasToken:", !!session.accessToken);
        return session;
      } catch (err) {
        console.error("[SessionDB] loadSession FAILED:", id, err.message);
        return undefined;
      }
    },
    async deleteSession(id) {
      try {
        const c = await col();
        await c.deleteOne({ _id: id });
        return true;
      } catch (err) {
        console.error("[SessionDB] deleteSession FAILED:", err.message);
        return false;
      }
    },
    async deleteSessions(ids) {
      try {
        const c = await col();
        await c.deleteMany({ _id: { $in: ids } });
        return true;
      } catch (err) {
        console.error("[SessionDB] deleteSessions FAILED:", err.message);
        return false;
      }
    },
    async findSessionsByShop(shop) {
      try {
        const c = await col();
        const docs = await c.find({ shop }).toArray();
        console.log("[SessionDB] findSessionsByShop:", shop, "count:", docs.length);
        return docs.map(({ _id, ...props }) => Session.fromPropertyArray(Object.entries(props)));
      } catch (err) {
        console.error("[SessionDB] findSessionsByShop FAILED:", err.message);
        return [];
      }
    },
  };
}

function getSessionStorage() {
  const mongoUrl = process.env.MONGODB_URL;

  if (mongoUrl && process.env.NODE_ENV === "production") {
    console.log("Using custom MongoDB session storage");
    return buildMongoSessionStorage(mongoUrl, process.env.MONGODB_DB_NAME || "zapchat_app");
  }

  console.log("Using in-memory session storage (dev mode)");
  const sessions = new Map();
  return {
    async storeSession(session) { sessions.set(session.id, session); return true; },
    async loadSession(id) { return sessions.get(id); },
    async deleteSession(id) { sessions.delete(id); return true; },
    async deleteSessions(ids) { ids.forEach((id) => sessions.delete(id)); return true; },
    async findSessionsByShop(shop) { return [...sessions.values()].filter((s) => s.shop === shop); },
  };
}

const shopify = shopifyApp({
  api: {
    apiVersion: ApiVersion.April26,
    restResources,
    apiKey: process.env.SHOPIFY_API_KEY,
    apiSecretKey: process.env.SHOPIFY_API_SECRET,
    hostName: process.env.HOST.replace(/https?:\/\//, ""),
    scopes: ["read_themes", "read_products"],
    billing: {
      Premium: {
        amount: 100.0,
        currencyCode: "USD",
        interval: "EVERY_30_DAYS",
      },
    },
  },
  auth: {
    path: "/api/auth",
    callbackPath: "/api/auth/callback",
  },
  webhooks: {
    path: "/api/webhooks",
  },
  sessionStorage: getSessionStorage(),
  useOnlineTokens: true,
});

// Skip webhook registration
shopify.api.webhooks.register = async () => ({});

export default shopify;
