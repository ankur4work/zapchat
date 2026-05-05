import { ApiVersion } from "@shopify/shopify-api";
import { shopifyApp } from "@shopify/shopify-app-express";
import { MongoDBSessionStorage } from "@shopify/shopify-app-session-storage-mongodb";
import { restResources } from "@shopify/shopify-api/rest/admin/2026-01";
import dotenv from "dotenv";

dotenv.config();

function getSessionStorage() {
  const mongoUrl = process.env.MONGODB_URL;

  if (mongoUrl && process.env.NODE_ENV === "production") {
    console.log("Using MongoDB session storage");
    return new MongoDBSessionStorage(
      mongoUrl,
      process.env.MONGODB_DB_NAME || "zapchat_app"
    );
  }

  console.log("Using in-memory session storage (dev mode)");
  const sessions = new Map();
  return {
    async storeSession(session) {
      sessions.set(session.id, session);
      return true;
    },
    async loadSession(id) {
      return sessions.get(id) || undefined;
    },
    async deleteSession(id) {
      sessions.delete(id);
      return true;
    },
    async deleteSessions(ids) {
      ids.forEach((id) => sessions.delete(id));
      return true;
    },
    async findSessionsByShop(shop) {
      return [...sessions.values()].filter((s) => s.shop === shop);
    },
  };
}

const shopify = shopifyApp({
  api: {
    apiVersion: ApiVersion.April26,
    restResources,
    apiKey: process.env.SHOPIFY_API_KEY,
    apiSecretKey: process.env.SHOPIFY_API_SECRET,
    hostName: process.env.HOST.replace(/https?:\/\//, ""),
    scopes: ["read_themes", "write_themes", "read_products"],
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
  useOnlineTokens: false,
});

// Skip webhook registration
shopify.api.webhooks.register = async () => ({});

export default shopify;
