// @ts-check
import React, { useEffect, useState } from "react";
import {
  Page,
  Layout,
  Card,
  Button,
  Banner,
  Stack,
  SkeletonBodyText,
  Badge,
} from "@shopify/polaris";
import { useAuthenticatedFetch } from "../hooks";
import { useAppBridge } from "@shopify/app-bridge-react";
import { Redirect } from "@shopify/app-bridge/actions";

export default function Pricing() {
  const app = useAppBridge();
  const fetchAuth = useAuthenticatedFetch();
  const redirect = Redirect.create(app);

  const [plan, setPlan] = useState(null);
  const [actionLoading, setActionLoading] = useState(null);
  const [banner, setBanner] = useState(null);

  const PRICE = "100";
  const isCurrent = (p) => plan === p;

  const loadPlan = async () => {
    try {
      const res = await fetchAuth("/api/hasActiveSubscription");
      if (res.status === 401) {
        const d = await res.json().catch(() => ({}));
        if (d.requiresReauth) { redirect.dispatch(Redirect.Action.REMOTE, { url: d.authUrl, newContext: false }); return; }
      }
      const data = await res.json();
      setPlan(data?.tier === "premium" ? "premium" : "free");
    } catch {
      setPlan("free");
    }
  };

  useEffect(() => { loadPlan(); }, []);

  const changePlan = async (target) => {
    if (target === plan) return;
    setBanner(null);
    try {
      setActionLoading(target);
      if (target === "free") {
        const r = await fetchAuth("/api/cancelSubscription");
        if (r.status === 401) {
          const d = await r.json();
          if (d.requiresReauth) { redirect.dispatch(Redirect.Action.REMOTE, { url: d.authUrl, newContext: false }); return; }
        }
        if (!r.ok) throw new Error("Failed to cancel subscription");
        setPlan("free");
        setBanner({ status: "success", msg: "Downgraded to Free plan" });
        return;
      }
      const res = await fetchAuth(`/api/createSubscription?plan=premium`);
      if (res.status === 401) {
        const d = await res.json();
        if (d.requiresReauth) { redirect.dispatch(Redirect.Action.REMOTE, { url: d.authUrl, newContext: false }); return; }
      }
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = await res.json();
      if (data.confirmationUrl) {
        redirect.dispatch(Redirect.Action.REMOTE, data.confirmationUrl);
      } else if (data.isActiveSubscription) {
        await loadPlan();
        setBanner({ status: "success", msg: "Already subscribed to Premium" });
      }
    } catch (err) {
      setBanner({ status: "critical", msg: err.message || "Something went wrong. Please try again." });
    } finally {
      setActionLoading(null);
    }
  };

  const R = ({ on, children }) => (
    <div style={{ fontSize: 13, color: on ? "#374151" : "#D1D5DB", padding: "4px 0", display: "flex", alignItems: "center" }}>
      <span style={{ color: on ? "#22C55E" : "#D1D5DB", marginRight: 8, fontSize: 14 }}>{on ? "\u2713" : "\u2715"}</span>
      {children}
    </div>
  );

  if (plan === null) {
    return (
      <Page title="Pricing">
        <Layout>
          {[1, 2].map((i) => (
            <Layout.Section oneHalf key={i}>
              <Card sectioned><SkeletonBodyText lines={5} /></Card>
            </Layout.Section>
          ))}
        </Layout>
      </Page>
    );
  }

  return (
    <Page title="Pricing">

      {banner && (
        <div style={{ marginBottom: 16 }}>
          <Banner status={banner.status} onDismiss={() => setBanner(null)}>{banner.msg}</Banner>
        </div>
      )}

      <Layout>

        <Layout.Section oneHalf>
          <Card sectioned>
            <Stack alignment="center" distribution="equalSpacing">
              <span style={{ fontSize: 16, fontWeight: 700, color: "#1E1B4B" }}>Free</span>
              {isCurrent("free") && <Badge status="info">Current</Badge>}
            </Stack>
            <div style={{ fontSize: 32, fontWeight: 800, color: "#1E1B4B", margin: "6px 0 4px" }}>$0</div>
            <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 12 }}>Homepage only</div>

            <R on>WhatsApp button on homepage</R>
            <R on>1 icon style</R>
            <R on>Default color & shape</R>
            <R>Show on product & collection pages</R>
            <R>Page visibility control</R>
            <R>Custom color, shape & position</R>

            <div style={{ marginTop: 14 }}>
              <Button fullWidth disabled={isCurrent("free")} loading={actionLoading === "free"} onClick={() => changePlan("free")}>
                {isCurrent("free") ? "Current plan" : "Downgrade"}
              </Button>
            </div>
          </Card>
        </Layout.Section>

        <Layout.Section oneHalf>
          <Card sectioned>
            <Stack alignment="center" distribution="equalSpacing">
              <span style={{ fontSize: 16, fontWeight: 700, color: "#1E1B4B" }}>Premium</span>
              {isCurrent("premium") ? (
                <Badge status="success">Current</Badge>
              ) : (
                <span style={{ fontSize: 10, fontWeight: 700, color: "#6366F1", background: "#EEF2FF", padding: "2px 8px", borderRadius: 999 }}>RECOMMENDED</span>
              )}
            </Stack>
            <div style={{ fontSize: 32, fontWeight: 800, color: "#1E1B4B", margin: "6px 0 4px" }}>${PRICE}<span style={{ fontSize: 13, fontWeight: 400, color: "#6B7280" }}>/mo</span></div>
            <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 12 }}>Full customization & all pages</div>

            <R on>WhatsApp button on <b>all pages</b></R>
            <R on>3 icon styles</R>
            <R on>Custom color, shape & position</R>
            <R on>Show on product & collection pages</R>
            <R on>Page visibility control</R>
            <R on>Custom default message</R>

            <div style={{ marginTop: 14 }}>
              <Button fullWidth primary disabled={isCurrent("premium")} loading={actionLoading === "premium"} onClick={() => changePlan("premium")}>
                {isCurrent("premium") ? "Current plan" : `Upgrade \u2013 $${PRICE}/mo`}
              </Button>
            </div>
          </Card>
        </Layout.Section>

      </Layout>
    </Page>
  );
}
