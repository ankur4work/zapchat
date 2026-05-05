// @ts-check
import React, { useState, useMemo } from "react";
import {
  Card,
  Page,
  Layout,
  Button,
  SkeletonBodyText,
  Banner,
  Stack,
} from "@shopify/polaris";
import { useAppQuery, useAuthenticatedFetch } from "../hooks";
import { useAppBridge } from "@shopify/app-bridge-react";
import { Redirect } from "@shopify/app-bridge/actions";
import { useNavigate } from "react-router-dom";

export default function HomePage() {
  const [activateError, setActivateError] = useState(null);
  const navigate = useNavigate();

  const app = useAppBridge();
  const fetch = useAuthenticatedFetch();

  const {
    data: subscriptionData,
    isLoading,
    isFetching,
  } = useAppQuery({ url: "/api/hasActiveSubscription" });

  const currentPlan = useMemo(() => {
    if (!subscriptionData) return "free";
    return subscriptionData.tier === "premium" ? "premium" : "free";
  }, [subscriptionData]);

  const isPlanLoading = isLoading || isFetching;

  const openThemeEditor = async () => {
    setActivateError(null);
    try {
      const response = await fetch("/api/getshop");
      const data = await response.json();
      const redirect = Redirect.create(app);
      redirect.dispatch(Redirect.Action.REMOTE, {
        url: `https://${data.shop}/admin/themes/current/editor?context=apps`,
        newContext: true,
      });
    } catch {
      setActivateError("Failed to open theme editor.");
    }
  };

  const steps = [
    "Open Theme Editor from above.",
    "Add block \u2192 Apps \u2192 ZapChat.",
    "Enter your WhatsApp number.",
    "Customize style & position.",
    "Save \u2014 you\u2019re live!",
  ];

  return (
    <Page>
      <Layout>

        {/* HERO */}
        <Layout.Section>
          <div style={{
            background: "linear-gradient(135deg, #6366F1, #8B5CF6)",
            borderRadius: 8,
            padding: "20px 22px",
            color: "#fff",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <svg viewBox="0 0 32 32" width="22" height="22">
                <path fill="#fff" d="M19.11 17.21c-.27-.14-1.58-.78-1.82-.87-.24-.09-.41-.14-.59.14-.17.27-.68.87-.83 1.05-.15.17-.3.2-.56.07-.27-.14-1.13-.42-2.15-1.33-.79-.7-1.33-1.56-1.48-1.82-.15-.27-.02-.41.11-.55.12-.12.27-.3.41-.45.14-.15.18-.27.27-.45.09-.17.05-.33-.02-.47-.07-.14-.59-1.42-.81-1.95-.21-.5-.42-.43-.59-.44h-.5c-.17 0-.45.06-.68.33-.24.27-.89.87-.89 2.11 0 1.24.91 2.44 1.03 2.61.12.17 1.78 2.71 4.31 3.8.6.26 1.07.41 1.44.53.61.19 1.17.16 1.61.1.49-.07 1.58-.65 1.8-1.28.22-.63.22-1.17.15-1.28-.07-.11-.24-.17-.5-.3z"/>
                <path fill="#fff" d="M16 3C9.38 3 4 8.38 4 15c0 2.1.55 4.08 1.5 5.79L4 29l8.4-1.47A11.94 11.94 0 0016 27c6.62 0 12-5.38 12-12S22.62 3 16 3z"/>
              </svg>
              <span style={{ fontSize: 18, fontWeight: 700 }}>ZapChat</span>
            </div>
            <p style={{ fontSize: 13, lineHeight: 1.5, margin: 0, opacity: 0.9 }}>
              Add a floating WhatsApp button to your store. Let customers contact you instantly.
            </p>
            <div style={{ marginTop: 14 }}>
              <Button onClick={openThemeEditor} size="slim">Open Theme Editor</Button>
            </div>
          </div>
        </Layout.Section>

        {/* PLAN + SETUP — same structure for equal height */}
        <Layout.Section oneHalf>
          <Card sectioned>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#1E1B4B", marginBottom: 12 }}>Your Plan</div>
            {isPlanLoading ? (
              <SkeletonBodyText lines={3} />
            ) : (
              <Stack vertical spacing="tight">
                <div style={{
                  display: "inline-block",
                  padding: "4px 12px",
                  borderRadius: 4,
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#fff",
                  background: currentPlan === "premium"
                    ? "linear-gradient(90deg, #6366F1, #8B5CF6)"
                    : "#9CA3AF",
                }}>
                  {currentPlan === "premium" ? "Premium" : "Free"}
                </div>
                <div style={{ fontSize: 13, color: "#6B7280" }}>
                  {currentPlan === "premium"
                    ? "All pages \u2022 Full customization"
                    : "Homepage only \u2022 Basic features"}
                </div>
                {currentPlan === "free" && (
                  <Button size="slim" onClick={() => navigate("/pricing")}>Upgrade</Button>
                )}
              </Stack>
            )}
          </Card>
        </Layout.Section>

        <Layout.Section oneHalf>
          <Card sectioned>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#1E1B4B", marginBottom: 12 }}>Quick Setup</div>
            <Stack vertical spacing="tight">
              {steps.map((step, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{
                    width: 18, height: 18, borderRadius: "50%",
                    background: "#6366F1", color: "#fff",
                    fontSize: 10, fontWeight: 700,
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    flexShrink: 0,
                  }}>{i + 1}</span>
                  <span style={{ fontSize: 13, color: "#374151" }}>{step}</span>
                </div>
              ))}
            </Stack>
          </Card>
        </Layout.Section>

        {/* HOW IT WORKS */}
        <Layout.Section>
          <Card sectioned>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#1E1B4B", marginBottom: 14 }}>How It Works</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
              {[
                { title: "Install", desc: "Add the ZapChat block to your theme via the Shopify theme editor." },
                { title: "Configure", desc: "Set your WhatsApp number, choose icon style, color, and position." },
                { title: "Go Live", desc: "Customers see the floating button and can message you with one tap." },
              ].map((item, i) => (
                <div key={i}>
                  <div style={{
                    width: 26, height: 26, borderRadius: "50%",
                    background: "#EEF2FF", color: "#6366F1",
                    fontSize: 13, fontWeight: 700,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    marginBottom: 6,
                  }}>{i + 1}</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#1E1B4B", marginBottom: 3 }}>{item.title}</div>
                  <div style={{ fontSize: 12, color: "#6B7280", lineHeight: 1.5 }}>{item.desc}</div>
                </div>
              ))}
            </div>
          </Card>
        </Layout.Section>

        {/* TIPS */}
        <Layout.Section>
          <Card sectioned>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#1E1B4B", marginBottom: 10 }}>Tips</div>
            <Stack vertical spacing="tight">
              {[
                "Use your country code with the phone number (e.g. 91 for India, 1 for US).",
                "Set a default message to help customers start the conversation.",
                "Circle shape works best \u2014 clean and recognizable.",
                "Place on the right side to avoid overlapping other widgets.",
                "Upgrade to Premium to show on product and collection pages.",
              ].map((tip, i) => (
                <div key={i} style={{ display: "flex", gap: 8, fontSize: 13, color: "#374151" }}>
                  <span style={{ color: "#6366F1", flexShrink: 0 }}>&bull;</span>
                  {tip}
                </div>
              ))}
            </Stack>
          </Card>
        </Layout.Section>

        {activateError && (
          <Layout.Section>
            <Banner status="critical" onDismiss={() => setActivateError(null)}>
              {activateError}
            </Banner>
          </Layout.Section>
        )}

      </Layout>
    </Page>
  );
}
