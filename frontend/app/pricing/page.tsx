"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import LaserFlow from "@/components/react-bits/LaserFlow";
import { api } from "@/lib/api";
import { useChatStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Check, ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";

type Plan = {
  id: string;
  name: string;
  price_usd: number;
  daily_messages: number;
  features: string[];
  stripe_enabled?: boolean;
};

export default function PricingPage() {
  const { loadAuth, user, t } = useChatStore();
  const proCardRef = useRef<HTMLDivElement>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [stripeEnabled, setStripeEnabled] = useState(false);
  const [demoEnabled, setDemoEnabled] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const [currentTier, setCurrentTier] = useState("free");

  useEffect(() => {
    loadAuth();
    api.getPlans().then((data: any) => {
      setPlans(data.plans || []);
      setStripeEnabled(!!data.stripe_enabled);
      setDemoEnabled(!!data.demo_enabled);
    }).catch((error: Error) => toast.error(error.message));
    api.getSubscription().then((s: any) => setCurrentTier(s.tier || "free")).catch(() => {});
  }, [loadAuth]);

  const checkout = async (planId: string) => {
    if (planId === "free") return;
    if (!user || user.is_guest) {
      toast.error(t("loginToSubscribe"));
      window.location.href = "/login";
      return;
    }
    setLoading(planId);
    try {
      if (stripeEnabled) {
        const { checkout_url } = await api.createCheckout(planId as "pro" | "premium");
        window.location.href = checkout_url;
      } else {
        await api.demoUpgrade(planId as "pro" | "premium");
        toast.success(t("demoUpgradeSuccess"));
        setCurrentTier(planId);
        await useChatStore.getState().loadUsage();
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Payment failed");
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="relative isolate min-h-[100dvh] overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden="true">
        <LaserFlow surfaceRef={proCardRef} beamPosition={0.5} color="#3847ff" intensity={1.5} flare={1.2} spread={1.5} fog={0.2} dust={1} dpr={1.25} />
      </div>
      <div className="mx-auto max-w-5xl px-4 py-10 pb-20">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-8"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("backToChat")}
        </Link>

        <div className="relative text-center mb-20 md:mb-32">
          <p className="font-display text-xs uppercase tracking-[0.2em] text-primary mb-2">
            NKMZ
          </p>
          <h1 className="font-display text-4xl font-semibold tracking-tight">
            {t("pricingTitle")}
          </h1>
          <p className="mt-3 text-muted-foreground max-w-lg mx-auto">
            {t("pricingSubtitle")}
          </p>
          {demoEnabled && (
            <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
              {t("demoBillingNote")}
            </p>
          )}
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {plans.map((plan) => {
            const isCurrent = currentTier === plan.id;
            const highlighted = plan.id === "pro";
            return (
              <div
                key={plan.id}
                ref={highlighted ? proCardRef : undefined}
                className={cn(
                  "relative rounded-3xl border p-6 flex flex-col",
                  highlighted
                    ? "border-primary/40 bg-gradient-to-b from-[#171720]/95 to-background/95 shadow-glow"
                    : "border-border/80 bg-card/80 backdrop-blur-md"
                )}
              >
                {highlighted && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-0.5 text-[11px] font-medium text-primary-foreground">
                    {t("popular")}
                  </span>
                )}
                <div className="flex items-center gap-2 mb-4">

                  <h2 className="font-display text-xl font-semibold">{plan.name}</h2>
                </div>
                <div className="mb-4">
                  <span className="text-4xl font-bold">
                    {plan.price_usd === 0 ? "0" : `$${plan.price_usd}`}
                  </span>
                  {plan.price_usd > 0 && (
                    <span className="text-muted-foreground text-sm"> / mo</span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground mb-4">
                  {plan.daily_messages} {t("messagesPerDay")}
                </p>
                <ul className="space-y-2 mb-8 flex-1">
                  {plan.features.map((f) => (
                    <li key={f} className="flex gap-2 text-sm">
                      <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Button
                  className="w-full rounded-xl"
                  variant={highlighted ? "default" : "outline"}
                  disabled={isCurrent || loading !== null || plan.id === "free" || (!stripeEnabled && !demoEnabled)}
                  onClick={() => checkout(plan.id)}
                >
                  {loading === plan.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : isCurrent ? (
                    t("currentPlan")
                  ) : plan.id === "free" ? (
                    t("freePlan")
                  ) : (
                    t("choosePlan")
                  )}
                </Button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

