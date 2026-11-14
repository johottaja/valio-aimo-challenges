"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Building2,
  Check,
  ChevronDown,
  CircleCheck,
  ClipboardList,
  FileCheck2,
  FlaskConical,
  Layers3,
  LoaderCircle,
  PanelLeftClose,
  RotateCcw,
  ShieldCheck,
  ShoppingBasket,
  SlidersHorizontal,
  Sparkles,
  Store,
  UserRound,
  X,
} from "lucide-react";
import {
  api,
  post,
  type Session,
  type Purchase,
  type Receipt,
} from "@/lib/api";
import { cn, dateLabel, money, number, timeLabel } from "@/lib/utils";
import { Button } from "./ui/button";
import { ConfirmDialog } from "./ui/confirm-dialog";
import { PurchaseForm } from "./purchase-form";
import { RequestDetail } from "./request-detail";
import { Rules } from "./rules";

export function Brand() {
  return (
    <Link href="/" aria-label="Valio Aimo Trust Gateway home" className="inline-flex flex-col items-start gap-1.5">
      {/* Official Valio Aimo wordmark, published on valioaimo.fi. */}
      <img src="/valio-aimo-logo.svg" alt="Valio Aimo" className="h-auto w-[112px]" />
      <span className="text-[9px] font-bold uppercase tracking-[.16em] text-foreground">Trust Gateway</span>
    </Link>
  );
}

export function ErrorNotice({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) ref.current?.focus();
  }, [error]);
  if (!error) return null;
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="alert"
      className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
    >
      <p>
        {error instanceof Error
          ? error.message
          : "Something went wrong. Please try again."}
      </p>
      {onRetry && (
        <Button
          variant="secondary"
          size="sm"
          onClick={onRetry}
          className="mt-3"
        >
          Try again
        </Button>
      )}
    </div>
  );
}

export function Loading({
  label = "Loading your workspace…",
}: {
  label?: string;
}) {
  return (
    <div className="space-y-5 py-6" role="status" aria-label={label}>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" aria-hidden />
        {label}
      </div>
      <div className="skeleton h-8 w-2/3 max-w-md" />
      <div className="skeleton h-56 w-full" />
    </div>
  );
}

const statusLabels: Record<string, string> = {
  received: "Received",
  interpreting: "Understanding request",
  matching: "Finding products",
  checking_policy: "Checking rules",
  ready_to_commit: "Placing order",
  approval_pending: "Needs approval",
  committed: "Ordered",
  needs_information: "Needs attention",
  rejected: "Rejected",
  failed: "Stopped",
  expired: "Expired",
  changed: "Review updated basket",
};
export function StatusBadge({ status }: { status: string }) {
  const success = status === "committed",
    pending = ["approval_pending", "changed"].includes(status),
    failure = ["failed", "rejected"].includes(status);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap",
        success
          ? "bg-emerald-50 text-emerald-800"
          : pending
            ? "bg-amber-50 text-amber-800"
            : failure
              ? "bg-red-50 text-red-800"
              : "bg-slate-100 text-slate-700",
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          success
            ? "bg-emerald-600"
            : pending
              ? "bg-amber-600"
              : failure
                ? "bg-red-600"
                : "bg-slate-500",
        )}
        aria-hidden
      />
      {statusLabels[status] || status}
    </span>
  );
}

export function Disclosure({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <details className={cn("border-t border-border", className)}>
      <summary className="flex min-h-12 items-center justify-between gap-3 py-3 text-sm font-medium">
        {title}
        <ChevronDown
          className="disclosure-chevron size-4 shrink-0 text-muted-foreground transition-transform"
          aria-hidden
        />
      </summary>
      <div className="pb-5 text-sm leading-6">{children}</div>
    </details>
  );
}

export function Gateway({ route }: { route: string[] }) {
  const router = useRouter(),
    client = useQueryClient();
  const session = useQuery({
    queryKey: ["session"],
    queryFn: () => api<Session>("/session"),
    retry: 1,
  });
  const role = route[0] === "aimo" ? "aimo" : "customer";
  const switching = useRef(false);
  const roleMutation = useMutation({
    mutationFn: (next: "customer" | "aimo") =>
      post<Session>("/session/role", { role: next }),
    onSuccess: (data) => {
      client.setQueryData(["session"], data);
      client.invalidateQueries({ queryKey: ["purchases"] });
    },
    onSettled: () => {
      switching.current = false;
    },
  });
  useEffect(() => {
    if (
      route.length &&
      session.data &&
      session.data.role !== role &&
      !switching.current
    ) {
      switching.current = true;
      roleMutation.mutate(role);
    }
  }, [role, session.data?.role, route.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const reset = useMutation({
    mutationFn: () => post<Session>("/session/reset"),
    onSuccess: (data) => {
      client.clear();
      client.setQueryData(["session"], data);
      router.push(data.role === "aimo" ? "/aimo" : "/customer");
    },
  });
  const selectWorkspace = async (next: "customer" | "aimo") => {
    await roleMutation.mutateAsync(next);
    router.push(next === "customer" ? "/customer" : "/aimo");
  };
  if (!route.length)
    return (
      <Landing
        session={session.data}
        loading={session.isPending || roleMutation.isPending}
        error={session.error || roleMutation.error}
        onSelect={selectWorkspace}
      />
    );
  const aimo = role === "aimo";
  const nav = aimo
    ? [
        { title: "Requests", href: "/aimo", icon: Layers3 },
        { title: "Demo orders", href: "/aimo/orders", icon: FileCheck2 },
      ]
    : [
        { title: "Purchase", href: "/customer", icon: ShoppingBasket },
        { title: "Orders", href: "/customer/orders", icon: ClipboardList },
        { title: "Rules", href: "/customer/rules", icon: SlidersHorizontal },
      ];
  const section = route[1] || "";
  const navActive = (href: string) =>
    href.endsWith("rules")
      ? section === "rules"
      : href.endsWith("orders")
        ? section === "orders"
        : !["rules", "orders"].includes(section);
  let content;
  if (!session.data || session.data.role !== role)
    content = (
      <>
        <ErrorNotice
          error={session.error || roleMutation.error}
          onRetry={() => session.refetch()}
        />
        <Loading />
      </>
    );
  else if (route[0] !== "customer" && route[0] !== "aimo")
    content = (
      <Empty
        title="This page could not be found"
        text="Return to your workspace to continue."
        href="/"
        action="Choose a workspace"
      />
    );
  else if (section === "rules" && !aimo) content = <Rules />;
  else if (section === "orders")
    content = route[2] ? (
      <OrderPage id={route[2]} aimo={aimo} />
    ) : (
      <OrderList aimo={aimo} />
    );
  else if (["requests", "approvals"].includes(section) && route[2])
    content = (
      <RequestDetail
        id={route[2]}
        aimo={aimo}
        approval={section === "approvals"}
        session={session.data}
      />
    );
  else if (aimo) content = <RequestList />;
  else content = <PurchaseForm session={session.data} />;
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <div className="min-h-screen lg:pl-[224px]">
        <aside className="fixed inset-y-0 left-0 z-20 hidden w-[224px] flex-col border-r border-border bg-white lg:flex">
          <div className="px-7 pt-8 pb-11">
            <Brand />
          </div>
          <div className="px-7 pb-3 text-[10px] font-semibold uppercase tracking-[.13em] text-muted-foreground">
            {aimo ? "Aimo operations" : "Customer workspace"}
          </div>
          <nav aria-label="Main navigation" className="space-y-1 px-4">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={navActive(item.href) ? "page" : undefined}
                className={cn(
                  "flex min-h-11 items-center gap-3 rounded-lg px-3 text-[13px] font-medium transition-colors",
                  navActive(item.href)
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <item.icon className="size-[18px]" aria-hidden />
                {item.title}
                {navActive(item.href) && (
                  <span className="ml-auto size-1.5 rounded-full bg-primary" />
                )}
              </Link>
            ))}
          </nav>
          <div className="mt-auto px-5 pb-6">
            <div className="mb-5 border-l-[3px] border-accent bg-background p-3.5">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold">
                <ShieldCheck className="size-4 text-primary" aria-hidden />
                Customer control
              </div>
              <p className="text-[11px] leading-[1.7] text-muted-foreground">
                Agents recommend.
                <br />
                Rules authorize.
                <br />
                You approve exceptions.
              </p>
            </div>
            <div className="flex items-center gap-2.5 border-t border-border pt-4">
              <span className="flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <UserRound className="size-4" aria-hidden />
              </span>
              <div>
                <p className="text-xs font-semibold">
                  {aimo ? "Aimo operator" : "Hotel Helsinki"}
                </p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  Demo identity · Isolated sandbox
                </p>
              </div>
            </div>
          </div>
        </aside>
        <header className="flex min-h-[76px] flex-wrap items-center justify-between gap-3 border-b border-border bg-white/90 px-5 py-4 sm:px-8 lg:px-10">
          <div className="lg:hidden">
            <Brand />
          </div>
          <div className="hidden items-center gap-2 text-xs text-muted-foreground lg:flex">
            <span>{aimo ? "Aimo workspace" : "Customer workspace"}</span>
            <span className="px-1 text-slate-300">/</span>
            <span className="font-medium text-foreground">
              {aimo ? "Operations" : "Hotel Helsinki"}
            </span>
          </div>
          <Link
            href="/"
            className="ml-auto inline-flex min-h-10 items-center gap-2 text-xs font-medium text-muted-foreground hover:text-primary"
          >
            <Store className="size-3.5" aria-hidden />
            Switch workspace
            <ArrowUpRight className="size-3.5" aria-hidden />
          </Link>
        </header>
        <nav
          className="flex gap-1 border-b border-border bg-white px-4 py-2 lg:hidden"
          aria-label="Mobile navigation"
        >
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={navActive(item.href) ? "page" : undefined}
              className={cn(
                "inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-xs font-medium",
                navActive(item.href)
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground",
              )}
            >
              <item.icon className="size-4" aria-hidden />
              {item.title}
            </Link>
          ))}
        </nav>
        <main
          id="main"
          className="mx-auto max-w-[1392px] px-5 py-8 sm:px-8 lg:px-10 lg:py-10"
        >
          {session.data?.data_mode === "fixture" && (
            <div className="mb-6 flex items-start gap-2 rounded-lg border border-amber-200/70 bg-amber-50/70 px-3 py-2 text-[11px] leading-5 text-amber-900">
              <FlaskConical className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>
                <strong>Simulated prices & stock.</strong> Products come from
                the challenge catalog. Orders stay in the demo ledger.
              </span>
            </div>
          )}
          {session.data?.data_mode === "replay" && (
            <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Recorded challenge responses. Price and stock are historical.
            </div>
          )}
          <ErrorNotice error={reset.error} />
          {content}
          <footer className="mt-12 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-5 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <FlaskConical className="size-3" aria-hidden />
              Synthetic challenge data · Demo orders only
            </span>
            <ConfirmDialog
              trigger={
                <button
                  className="inline-flex min-h-8 items-center gap-1.5 text-[10px] hover:text-primary"
                  disabled={reset.isPending}
                >
                  <RotateCcw className="size-3" aria-hidden />
                  Start fresh demo
                </button>
              }
              title="Start a fresh demo?"
              description="This clears your sandbox’s requests, demo orders, and rule changes. Other testers keep their own workspaces."
              action="Start fresh demo"
              onConfirm={() => reset.mutate()}
            />
          </footer>
        </main>
      </div>
    </>
  );
}

function Landing({
  session,
  loading,
  error,
  onSelect,
}: {
  session?: Session;
  loading: boolean;
  error: unknown;
  onSelect: (role: "customer" | "aimo") => Promise<void>;
}) {
  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 border-b border-border px-6 py-6 sm:px-10">
        <Brand />
        <span className="text-right text-[11px] font-medium leading-5 text-muted-foreground">Junction 2026 <span className="px-1">/</span> Valio Aimo challenge</span>
      </header>
      <main className="mx-auto max-w-6xl px-6 pb-16 sm:px-10">
        <div className="grid gap-8 border-b border-border py-14 sm:py-20 md:grid-cols-[1fr_240px] md:items-end">
          <div>
            <p className="eyebrow mb-5">Purchasing, with oversight</p>
            <h1 className="max-w-[720px] text-[40px] font-semibold leading-[1.08] tracking-[-.045em] sm:text-[60px]">The next order.<br /><span className="text-muted-foreground">In trusted hands.</span></h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-muted-foreground">Let your purchasing agent find the right products. Keep your rules, your approvals, and a clear record of every decision.</p>
          </div>
          <p className="border-l-[3px] border-accent pl-4 text-xs leading-6 text-muted-foreground">Agents recommend.<br />Rules authorize.<br />You approve exceptions.</p>
        </div>
        <div className="mt-10 flex flex-wrap items-end justify-between gap-3">
          <div><p className="eyebrow mb-2">Get started</p><h2 className="text-xl font-semibold tracking-tight">Choose a workspace</h2></div>
          <p className="text-xs text-muted-foreground">No signup required</p>
        </div>
        <div className="mt-4"><ErrorNotice error={error} /></div>
        <div className="grid border-t-2 border-primary md:grid-cols-2">
          {[
            { role: "customer" as const, number: "01", label: "For the kitchen", title: "Customer workspace", text: "Tell your agent what you need. Review a basket when it needs your approval.", action: "Enter as customer" },
            { role: "aimo" as const, number: "02", label: "For operations", title: "Aimo workspace", text: "Follow each request, inspect the evidence, and see how customer rules were enforced.", action: "Enter as Aimo operator" },
          ].map((item) => (
            <button key={item.role} onClick={() => { void onSelect(item.role); }} disabled={loading || !session} className="group flex min-h-[220px] flex-col border-b border-border py-6 text-left transition-colors hover:bg-white/60 disabled:cursor-wait disabled:opacity-60 md:px-7 md:first:border-r md:first:pl-0 md:last:pr-0">
              <div className="flex w-full items-center justify-between text-[11px] font-semibold uppercase tracking-[.1em] text-muted-foreground"><span>{item.label}</span><span className="tabular">{item.number}</span></div>
              <h3 className="mt-7 text-xl font-semibold tracking-tight">{item.title}</h3>
              <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">{item.text}</p>
              <span className="mt-auto flex items-center gap-2 pt-6 text-xs font-semibold text-primary">{loading ? "Preparing workspace…" : item.action}<ArrowRight className="size-4 transition-transform group-hover:translate-x-1" aria-hidden /></span>
            </button>
          ))}
        </div>
        <div className="mt-8 flex flex-wrap items-start justify-between gap-4 text-xs leading-5 text-muted-foreground">
          <p>Try a routine basket, then a larger purchase to see the approval flow.</p>
          <p className="flex items-center gap-2"><FlaskConical className="size-4" aria-hidden /> Synthetic data · Demo orders</p>
        </div>
      </main>
    </div>
  );
}

export function Empty({
  title,
  text,
  href,
  action,
  icon: Icon = ShoppingBasket,
}: {
  title: string;
  text: string;
  href: string;
  action: string;
  icon?: typeof ShoppingBasket;
}) {
  return (
    <div className="panel flex min-h-[340px] flex-col items-center justify-center p-8 text-center">
      <span className="mb-5 flex size-14 items-center justify-center rounded-2xl bg-muted">
        <Icon className="size-6 text-muted-foreground" aria-hidden />
      </span>
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
        {text}
      </p>
      <Button asChild className="mt-6">
        <Link href={href}>
          {action}
          <ArrowRight />
        </Link>
      </Button>
    </div>
  );
}

function RequestList() {
  const query = useQuery({
    queryKey: ["purchases"],
    queryFn: () => api<Purchase[]>("/requests"),
    refetchInterval: 3000,
  });
  return (
    <>
      <div className="mb-8">
        <p className="eyebrow mb-3">Aimo operations</p>
        <h1 className="page-title">Every request. A clear record.</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Follow the basket from request to customer decision.
        </p>
      </div>
      <ErrorNotice error={query.error} onRetry={() => query.refetch()} />
      {query.isPending ? (
        <Loading />
      ) : !query.data?.length ? (
        <Empty
          title="Your first request starts in the kitchen"
          text="Submit a purchase in the Customer workspace, then come back to inspect the complete decision trail."
          href="/customer"
          action="Open Customer workspace"
          icon={Layers3}
        />
      ) : (
        <div className="panel overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <h2 className="text-sm font-semibold">Requests in this sandbox</h2>
            <span className="text-xs text-muted-foreground">
              {query.data.length} requests
            </span>
          </div>
          {query.data.map((request) => (
            <Link
              className="flex flex-wrap items-center gap-4 border-b border-border px-5 py-5 last:border-b-0 hover:bg-background"
              href={`/aimo/requests/${request.id}`}
              key={request.id}
            >
              <span className="flex size-10 items-center justify-center rounded-xl bg-muted">
                <ShoppingBasket
                  className="size-4 text-muted-foreground"
                  aria-hidden
                />
              </span>
              <div className="min-w-0 flex-1 basis-36">
                <p className="text-sm font-semibold">
                  {request.items.length
                    ? request.items.map((i) => i.description).join(" + ")
                    : "New purchasing request"}
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Hotel Helsinki · {request.id} ·{" "}
                  {timeLabel(request.created_at)}
                </p>
              </div>
              <div className="ml-auto text-sm font-semibold tabular">
                {request.preview ? money(request.preview.total) : "—"}
              </div>
              <StatusBadge status={request.status} />
              <ArrowRight
                className="size-4 text-muted-foreground"
                aria-hidden
              />
            </Link>
          ))}
        </div>
      )}
      <p className="mt-5 text-xs leading-6 text-muted-foreground">
        Customer approvals belong to the Customer workspace. This operator view
        can inspect decisions, but cannot approve exceptions.
      </p>
    </>
  );
}

function OrderList({ aimo }: { aimo: boolean }) {
  const query = useQuery({
    queryKey: ["orders"],
    queryFn: () => api<Receipt[]>("/orders"),
    refetchInterval: 5000,
  });
  const base = aimo ? "/aimo" : "/customer";
  return (
    <>
      <div className="mb-8">
        <p className="eyebrow mb-3">
          {aimo ? "Demo ledger" : "Purchasing history"}
        </p>
        <h1 className="page-title">{aimo ? "Demo orders" : "Your orders"}</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Placed baskets, their receipts, and the authority behind them.
        </p>
      </div>
      <ErrorNotice error={query.error} />
      {query.isPending ? (
        <Loading />
      ) : !query.data?.length ? (
        <Empty
          title="No orders placed yet"
          text="Your completed baskets will appear here with a receipt and a clear decision record."
          href={aimo ? "/aimo" : "/customer"}
          action={aimo ? "View requests" : "Make a purchase"}
          icon={ClipboardList}
        />
      ) : (
        <div className="panel">
          {query.data.map((order) => (
            <Link
              href={`${base}/orders/${order.id}`}
              key={order.id}
              className="flex flex-wrap items-center gap-4 border-b border-border p-5 last:border-b-0 hover:bg-background"
            >
              <span className="flex size-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
                <FileCheck2 className="size-5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{order.id}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {order.preview.items.length} items ·{" "}
                  {dateLabel(order.placed_at)} · {order.authorization}
                </p>
              </div>
              <span className="text-sm font-semibold tabular">
                {money(order.preview.total)}
              </span>
              <ArrowRight
                className="size-4 text-muted-foreground"
                aria-hidden
              />
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

function OrderPage({ id, aimo }: { id: string; aimo: boolean }) {
  const query = useQuery({
    queryKey: ["order", id],
    queryFn: () => api<Receipt>(`/orders/${id}`),
  });
  const base = aimo ? "/aimo" : "/customer";
  return (
    <>
      <Link
        href={`${base}/orders`}
        className="mb-6 inline-flex items-center gap-2 text-xs text-muted-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        All orders
      </Link>
      <ErrorNotice error={query.error} />
      {query.isPending ? (
        <Loading />
      ) : (
        query.data && <ReceiptView receipt={query.data} aimo={aimo} />
      )}
    </>
  );
}

export function ReceiptView({
  receipt,
  aimo,
  showDecisionLink = true,
}: {
  receipt: Receipt;
  aimo: boolean;
  showDecisionLink?: boolean;
}) {
  return (
    <div className="mx-auto max-w-3xl">
      <div className="panel overflow-hidden">
        <div className="border-b border-border bg-emerald-50/50 p-7 sm:p-9">
          <div className="mb-5 flex size-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-800">
            <Check className="size-6" aria-hidden />
          </div>
          <p className="eyebrow !text-emerald-800">Purchase complete</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            Demo order placed.
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            {receipt.authorization}. Every basket line was recorded together.
          </p>
        </div>
        <div className="p-7 sm:p-9">
          <div className="mb-7 grid grid-cols-2 gap-6 text-xs">
            <div>
              <p className="text-muted-foreground">Order reference</p>
              <p className="mt-2 font-semibold">{receipt.id}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Delivery</p>
              <p className="mt-2 font-semibold">
                {dateLabel(receipt.preview.needed_by)}
              </p>
              <p className="mt-1 text-muted-foreground">
                {receipt.preview.location}
              </p>
            </div>
          </div>
          {receipt.preview.items.map((item, index) => (
            <div
              key={`${item.product_id}-${index}`}
              className="flex items-start justify-between gap-5 border-t border-border py-5"
            >
              <div>
                <p className="text-sm font-medium">{item.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {Number(item.canonical_quantity).toLocaleString("en-FI")}{" "}
                  {item.unit} · {number(item.sales_quantity)} sales units
                </p>
              </div>
              <p className="text-sm font-semibold tabular">
                {money(item.total)}
              </p>
            </div>
          ))}
          <div className="flex items-center justify-between border-t border-border pt-5">
            <span className="text-sm font-medium">
              Product total, including tax
            </span>
            <span className="text-2xl font-semibold tabular tracking-tight">
              {money(receipt.preview.total)}
            </span>
          </div>
          <p className="mt-3 text-[11px] leading-5 text-muted-foreground">
            {receipt.preview.charges_note}
          </p>
          <Disclosure title="Order and decision record" className="mt-6">
            <p>
              Placed {dateLabel(receipt.placed_at)} at{" "}
              {timeLabel(receipt.placed_at)} Helsinki time.
            </p>
            <p>
              Customer rules version {receipt.preview.policy_version}.{" "}
              {receipt.authorization}.
            </p>
            <p className="mt-2">
              This receipt records a simulated commitment in the demo ledger. No
              goods have been purchased.
            </p>
          </Disclosure>
        </div>
      </div>
      <div className="mt-6 flex flex-wrap justify-between gap-3">
        {showDecisionLink && (
          <Button asChild variant="secondary">
            <Link
              href={`/${aimo ? "aimo" : "customer"}/requests/${receipt.request_id}`}
            >
              View decision trail
              <ArrowRight />
            </Link>
          </Button>
        )}
        {!aimo && (
          <Button asChild>
            <Link href="/customer">
              Make another purchase
              <ArrowRight />
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}
