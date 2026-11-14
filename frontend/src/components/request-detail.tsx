"use client";
import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDown,
  CircleCheck,
  Clock3,
  FileCheck2,
  Info,
  LoaderCircle,
  MapPin,
  RefreshCw,
  ShieldCheck,
  ShoppingBasket,
  Sparkles,
  X,
} from "lucide-react";
import {
  api,
  post,
  type Offer,
  type Purchase,
  type Session,
} from "@/lib/api";
import { cn, dateLabel, money, number, timeLabel } from "@/lib/utils";
import { Button } from "./ui/button";
import { ConfirmDialog } from "./ui/confirm-dialog";
import {
  Disclosure,
  ErrorNotice,
  Loading,
  ReceiptView,
  StatusBadge,
} from "./gateway";

const active = [
  "received",
  "interpreting",
  "matching",
  "checking_policy",
  "ready_to_commit",
];

export function RequestDetail({
  id,
  aimo,
  approval,
  session,
}: {
  id: string;
  aimo: boolean;
  approval: boolean;
  session: Session;
}) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["request", id],
    queryFn: () => api<Purchase>(`/requests/${id}`),
    refetchInterval: (query) =>
      active.includes(query.state.data?.status || "")
        ? 1000
        : ["approval_pending", "changed"].includes(
              query.state.data?.status || "",
            )
          ? 3000
          : false,
  });
  const setRequest = (data: Purchase) => {
    client.setQueryData(["request", id], data);
    client.invalidateQueries({ queryKey: ["purchases"] });
    client.invalidateQueries({ queryKey: ["orders"] });
  };
  const decide = useMutation({
    mutationFn: (action: "approve" | "reject") =>
      post<Purchase>(`/approvals/${id}/decision`, {
        decision: action,
        fingerprint: query.data?.preview?.fingerprint,
      }),
    onSuccess: setRequest,
    onError: () => {
      client.invalidateQueries({ queryKey: ["request", id] });
    },
  });
  const retry = useMutation({
    mutationFn: () => post<Purchase>(`/requests/${id}/retry`),
    onSuccess: setRequest,
  });
  const selectOffer = useMutation({
    mutationFn: ({ index, offer }: { index: number; offer: Offer }) =>
      post<Purchase>(`/requests/${id}/select`, {
        revision: query.data!.revision,
        offer_ids: query.data!.preview!.items.map((o, i) =>
          i === index ? offer.id : o.id,
        ),
      }),
    onSuccess: setRequest,
  });
  const [editing, setEditing] = useState(false);
  const [editedText, setEditedText] = useState("");
  const [editedDate, setEditedDate] = useState("");
  const chooseProduct = useMutation({
    mutationFn: (choiceIndex: number) => post<Purchase>(`/requests/${id}/choose-product`, {
      revision: query.data!.revision,
      line_index: query.data!.choice_line_index,
      choice_index: choiceIndex,
    }),
    onSuccess: setRequest,
  });
  const clarify = useMutation({
    mutationFn: () =>
      post<Purchase>(`/requests/${id}/clarify`, {
        text: editedText,
        needed_by: editedDate,
        location: query.data!.input.location,
      }),
    onSuccess: (data) => {
      setRequest(data);
      setEditing(false);
    },
  });
  if (query.isPending) return <Loading label="Loading your basket…" />;
  if (!query.data)
    return <ErrorNotice error={query.error} onRetry={() => query.refetch()} />;
  const request = query.data,
    preview = request.preview;
  const pending = ["approval_pending", "changed"].includes(request.status);
  const needsHelp = ["needs_information", "failed", "expired"].includes(
    request.status,
  );
  const base = aimo ? "/aimo" : "/customer";
  const beginEditing = () => {
    setEditedText(request.input.text || request.items.map((i) => `${i.quantity} ${i.unit} of ${i.description}`).join(" and "));
    setEditedDate(request.input.needed_by ?? "");
    setEditing(true);
  };
  return (
    <>
      <Link
        href={base}
        className="mb-6 inline-flex min-h-8 items-center gap-2 text-xs text-muted-foreground hover:text-primary"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        {aimo ? "All requests" : "Back to purchasing"}
      </Link>
      {request.receipt && !aimo ? (
        <>
          <ReceiptView
            receipt={request.receipt}
            aimo={false}
            showDecisionLink={false}
          />
          <div className="mx-auto mt-7 max-w-3xl">
            <Disclosure title="View the decision trail">
              <Timeline request={request} technical={false} />
            </Disclosure>
          </div>
        </>
      ) : (
        <>
          <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="eyebrow mb-3">
                {aimo
                  ? "Request detail"
                  : pending
                    ? "Customer decision"
                    : "Your purchase"}
              </p>
              <h1 className="page-title">
                {pending
                  ? "Your approval. Before we order."
                  : request.status === "committed"
                    ? "An order with a clear record."
                    : needsHelp
                      ? "Let’s get this basket ready."
                      : request.status === "rejected"
                        ? "Purchase stopped."
                        : "A complete basket. In progress."}
              </h1>
              <p className="mt-3 text-xs text-muted-foreground">
                Hotel Helsinki <span className="px-2 text-slate-300">/</span>{" "}
                {request.id} <span className="px-2 text-slate-300">/</span>{" "}
                {request.agent_mode}
              </p>
            </div>
            <StatusBadge status={request.status} />
          </div>
          {!approval && !needsHelp && request.status !== "rejected" && (
            <Progress status={request.status} />
          )}
          <ErrorNotice
            error={
              decide.error || retry.error || selectOffer.error || clarify.error || chooseProduct.error
            }
          />
          <div aria-live="polite" aria-atomic="true" className="sr-only">
            {request.message}
          </div>
          {pending && (
            <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-5">
              <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-900">
                <ShieldCheck className="size-4" aria-hidden />
              </span>
              <div>
                <h2 className="text-sm font-semibold text-amber-950">
                  {request.status === "changed"
                    ? "The basket changed. A fresh review is needed."
                    : "This basket needs your approval."}
                </h2>
                <p className="mt-1.5 text-sm leading-6 text-amber-900">
                  {request.message}
                </p>
                {request.status === "changed" &&
                  request.decision?.reasons.map((reason) => (
                    <p key={reason} className="mt-1 text-xs text-amber-900">
                      {reason}
                    </p>
                  ))}
              </div>
            </div>
          )}
          {needsHelp && (
            <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-5">
              <div className="flex items-start gap-3">
                <AlertCircle
                  className="mt-0.5 size-5 shrink-0 text-amber-800"
                  aria-hidden
                />
                <div>
                  <h2 className="text-sm font-semibold text-amber-950">
                    {request.status === "expired"
                      ? "This basket needs a refresh"
                      : "Your basket needs attention"}
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-amber-900">
                    {request.message}
                  </p>
                  <p className="mt-1 text-xs text-amber-900">
                    No partial order has been placed.
                  </p>
                  {!!request.product_choices?.length && !aimo && <p className="mt-2 text-xs text-amber-900">Choose the product type below. Your quantity and requirements stay the same.</p>}
                  {!aimo && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button
                        onClick={() => retry.mutate()}
                        disabled={retry.isPending}
                        size="sm"
                      >
                        {retry.isPending ? (
                          <LoaderCircle className="animate-spin" />
                        ) : (
                          <RefreshCw />
                        )}
                        Refresh and retry
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={beginEditing}
                      >
                        Update request
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
          {request.status === "rejected" && (
            <div className="mb-6 rounded-xl border border-border bg-white p-5">
              <h2 className="text-sm font-semibold">
                Rejected — no order placed.
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {request.message}
              </p>
              {!aimo && (
                <Button asChild className="mt-4" size="sm">
                  <Link href="/customer">
                    Make another purchase
                    <ArrowRight />
                  </Link>
                </Button>
              )}
            </div>
          )}
          {editing && !aimo && (
            <form
              className="panel mb-6 p-6"
              onSubmit={(e) => {
                e.preventDefault();
                clarify.mutate();
              }}
            >
              <h2 className="mb-5 text-base font-semibold">
                Update your request
              </h2>
              <label className="block text-xs font-medium">Your request<textarea className="mt-2 min-h-28 w-full" value={editedText} onChange={(e) => setEditedText(e.target.value)} required maxLength={3000} /></label>
              <label className="mt-5 block text-xs font-medium">
                Delivery date
                <input className="mt-2 block w-full !text-xs" type="date" value={editedDate} min={new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Helsinki" }).format(new Date())} onChange={(e) => setEditedDate(e.target.value)} required />
              </label>
              <p className="mt-3 text-xs text-muted-foreground">Rechecking can place the complete order automatically if it meets your rules.</p>
              <div className="mt-5 flex gap-2">
                <Button
                  type="submit"
                  disabled={clarify.isPending || !editedText.trim()}
                >
                  {clarify.isPending
                    ? "Rechecking…"
                    : "Update and recheck basket"}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setEditing(false)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          )}
          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
            <div className="min-w-0 space-y-6">
              {preview ? (
                <Basket
                  request={request}
                  onSelect={
                    !aimo && pending
                      ? (index, offer) => selectOffer.mutate({ index, offer })
                      : undefined
                  }
                  selecting={selectOffer.isPending}
                />
              ) : (
                <div className="panel p-6">
                  <div className="mb-5 flex items-center gap-2 text-sm font-semibold">
                    <ShoppingBasket
                      className="size-4 text-primary"
                      aria-hidden
                    />
                    Your requested basket
                  </div>
                  {request.items.length ? (
                    request.items.map((item, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between gap-3 border-t border-border py-4"
                      >
                        <div>
                          <p className="text-sm font-medium">
                            {item.description}
                          </p>
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            {item.requirements
                              ?.map((r) => r.replaceAll("_", "-"))
                              .join(" · ")}
                          </p>
                        </div>
                        <span className="text-sm font-semibold tabular whitespace-nowrap">
                          {number(item.quantity)} {item.unit}
                        </span>
                      </div>
                    ))
                  ) : (
                    <p className="whitespace-pre-wrap text-sm leading-7 text-muted-foreground">
                      {request.input.text || "Reading your request…"}
                    </p>
                  )}
                  {active.includes(request.status) && (
                    <div className="mt-4 flex items-center gap-2 rounded-lg bg-background px-3 py-3 text-xs text-muted-foreground">
                      <LoaderCircle
                        className="size-4 animate-spin text-primary"
                        aria-hidden
                      />
                      {request.message}
                    </div>
                  )}
                </div>
              )}
              {!aimo && request.status === "needs_information" && !!request.product_choices?.length && (
                <div className="panel p-6">
                  <h2 className="mb-4 text-sm font-semibold">Which kind of {request.items[request.choice_line_index ?? 0]?.description} would you like?</h2>
                  <div className="flex flex-wrap gap-2">
                    {request.product_choices.map((choice, index) => (
                      <Button key={index} variant="secondary" disabled={chooseProduct.isPending} onClick={() => chooseProduct.mutate(index)}>{choice.label}<ArrowRight /></Button>
                    ))}
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">We’ll check the catalog products in your selection. If the basket meets your rules, it may be ordered automatically.</p>
                </div>
              )}
              {!preview && !request.product_choices?.length &&
                request.alternatives.map((options, index) => !aimo && options.some((offer) => offer.eligible) ? null : (
                  <div className="panel p-6" key={index}>
                    <h2 className="mb-4 text-sm font-semibold">
                      {aimo ? `Options for ${request.items[index]?.description}` : `Choose what to do for ${request.items[index]?.description}`}
                    </h2>
                    {!aimo ? (
                      <>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button variant="secondary" size="sm" onClick={beginEditing}>Update request</Button>
                        </div>
                        <p className="mt-3 text-xs text-muted-foreground">Choosing an option rechecks the basket and may place an order automatically if it meets your rules.</p>
                      </>
                    ) : <>
                    {options.length > 0 && <p className="mb-4 text-xs text-muted-foreground">These are the products checked and the reasons any cannot be ordered. Ineligible products cannot be selected.</p>}
                    {!options.length ? (
                      <p className="text-sm text-muted-foreground">
                        No relevant catalog matches. Try a clearer product name.
                      </p>
                    ) : (
                      options.slice(0, 5).map((offer) => (
                        <div
                          key={offer.id}
                          className="border-t border-border py-4"
                        >
                          <p className="text-sm font-medium">{offer.name}</p>
                          {offer.eligible ? (
                            <p className="mt-2 text-xs text-emerald-800">
                              Eligible · {money(offer.total)}
                            </p>
                          ) : (
                            <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-6 text-muted-foreground">
                              {offer.reasons.map((r) => (
                                <li key={r}>{r}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ))
                    )}
                    </>}
                  </div>
                ))}
              {aimo && (
                <div className="panel p-6">
                  <div className="mb-6 flex items-center justify-between">
                    <h2 className="text-sm font-semibold">
                      Execution timeline
                    </h2>
                    <span className="text-[10px] text-muted-foreground">
                      {request.events.length} events
                    </span>
                  </div>
                  <Timeline request={request} technical />
                </div>
              )}
            </div>
            <aside className="space-y-5 xl:sticky xl:top-6">
              {preview && (
                <div className="panel p-6">
                  <p className="text-[11px] font-medium text-muted-foreground">
                    Product total, including tax
                  </p>
                  <p className="mt-2 text-[34px] font-semibold tracking-[-.045em] tabular">
                    {money(preview.total)}
                  </p>
                  <p className="mt-1 text-[10px] leading-5 text-muted-foreground">
                    {preview.charges_note}
                  </p>
                  <div className="mt-5 space-y-4 border-t border-border pt-5">
                    <div className="flex items-start gap-2.5">
                      <MapPin
                        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                      <div>
                        <p className="text-[11px] text-muted-foreground">
                          Deliver to
                        </p>
                        <p className="mt-1 text-xs font-medium">
                          {preview.location}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2.5">
                      <CalendarDays
                        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                      <div>
                        <p className="text-[11px] text-muted-foreground">
                          Delivery date
                        </p>
                        <p className="mt-1 text-xs font-medium">
                          {dateLabel(preview.needed_by)}
                        </p>
                      </div>
                    </div>
                  </div>
                  {pending &&
                    !aimo &&
                    (approval ? (
                      <div className="mt-6 border-t border-border pt-5">
                        <p className="mb-4 text-[11px] leading-5 text-muted-foreground">
                          You are acting as the demo customer approver. Approval
                          places this exact basket after a final check.
                        </p>
                        <Button
                          className="w-full"
                          onClick={() => decide.mutate("approve")}
                          disabled={decide.isPending}
                        >
                          {decide.isPending ? (
                            <LoaderCircle className="animate-spin" />
                          ) : (
                            <ShieldCheck />
                          )}
                          {decide.isPending
                            ? "Rechecking order…"
                            : "Approve and place order"}
                        </Button>
                        <ConfirmDialog
                          trigger={
                            <Button
                              className="mt-2 w-full"
                              variant="ghost"
                              disabled={decide.isPending}
                            >
                              Reject basket
                            </Button>
                          }
                          title="Reject this basket?"
                          description="The purchasing agent will stop this request. None of the basket’s products will be ordered."
                          action="Reject basket"
                          onConfirm={() => decide.mutate("reject")}
                        />
                        <p className="mt-4 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                          <Clock3 className="size-3" aria-hidden />
                          Review expires at {timeLabel(preview.expires_at)}{" "}
                          Helsinki time
                        </p>
                      </div>
                    ) : (
                      <div className="mt-6 border-t border-border pt-5">
                        <p className="mb-4 text-xs leading-6 text-muted-foreground">
                          Your agent has paused. No products have been ordered.
                        </p>
                        <Button asChild className="w-full">
                          <Link href={`/customer/approvals/${id}`}>
                            Review and approve
                            <ArrowRight />
                          </Link>
                        </Button>
                      </div>
                    ))}
                  {pending && aimo && (
                    <div className="mt-5 rounded-lg bg-amber-50 p-3 text-xs leading-6 text-amber-900">
                      Waiting for the customer. Aimo operators cannot approve
                      this exception.
                      <Button
                        asChild
                        variant="secondary"
                        size="sm"
                        className="mt-3 w-full"
                      >
                        <Link href={`/customer/approvals/${id}`}>
                          Open customer view
                          <ArrowRight />
                        </Link>
                      </Button>
                    </div>
                  )}
                  {request.receipt && (
                    <Button asChild className="mt-5 w-full">
                      <Link href={`/aimo/orders/${request.receipt.id}`}>
                        Open demo receipt
                        <FileCheck2 />
                      </Link>
                    </Button>
                  )}
                </div>
              )}
              <div className="rounded-xl border border-border p-5">
                <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold">
                  <ShieldCheck className="size-4 text-primary" aria-hidden />
                  Authority stays with you
                </h2>
                <p className="text-[11px] leading-6 text-muted-foreground">
                  The agent selects products. Deterministic rules check
                  authority. Only the order service records the basket.
                </p>
              </div>
              {!aimo && (
                <Disclosure title="Decision trail">
                  <Timeline request={request} technical={false} />
                </Disclosure>
              )}
            </aside>
          </div>
        </>
      )}
    </>
  );
}

function Progress({ status }: { status: string }) {
  const steps = [
    "Understanding",
    "Finding products",
    "Checking rules",
    status === "committed"
      ? "Ordered"
      : ["approval_pending", "changed"].includes(status)
        ? "Your decision"
        : "Order",
  ];
  const current = ["received", "interpreting"].includes(status)
    ? 0
    : status === "matching"
      ? 1
      : status === "checking_policy"
        ? 2
        : 3;
  return (
    <ol
      aria-label="Purchasing progress"
      className="mb-7 grid grid-cols-4 gap-2 rounded-xl border border-border bg-white px-4 py-5 sm:px-6"
    >
      {steps.map((step, i) => (
        <li key={step} className="step-line relative min-w-0">
          <div className="relative z-10 flex items-center">
            <span
              className={cn(
                "flex size-8 items-center justify-center rounded-full border text-[11px] font-semibold",
                i < current || status === "committed"
                  ? "border-[#d1dde3] bg-[#f2f7f8] text-primary"
                  : i === current
                    ? "border-primary bg-primary text-white"
                    : "border-border bg-white text-muted-foreground",
              )}
            >
              {i < current || status === "committed" ? (
                <Check className="size-3.5" aria-hidden />
              ) : (
                i + 1
              )}
            </span>
          </div>
          <p
            className={cn(
              "mt-2 pr-1 text-[9px] font-medium sm:text-[11px]",
              i <= current ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {step}
          </p>
        </li>
      ))}
    </ol>
  );
}

function Basket({
  request,
  onSelect,
  selecting,
}: {
  request: Purchase;
  onSelect?: (index: number, offer: Offer) => void;
  selecting: boolean;
}) {
  const preview = request.preview!;
  return (
    <div className="panel overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <ShoppingBasket className="size-4 text-primary" aria-hidden />
          Selected basket
        </h2>
        <span className="text-[11px] text-muted-foreground">
          {preview.items.length} product needs
        </span>
      </div>
      {preview.items.map((item, index) => (
        <article
          key={`${index}-${item.product_id}`}
          className="border-b border-border px-6 pt-6 last:border-b-0"
        >
          <div className="mb-2 text-[10px] uppercase tracking-[.08em] text-muted-foreground">
            {item.requested.description}
          </div>
          <div className="flex items-start justify-between gap-5">
            <h3 className="max-w-md text-[15px] font-semibold leading-6">
              {item.name}
            </h3>
            <p className="whitespace-nowrap text-sm font-semibold tabular">
              {money(item.total)}
            </p>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {number(item.canonical_quantity)} {item.unit}{" "}
            <span className="px-1.5 text-slate-300">·</span>{" "}
            {number(item.sales_quantity)} sales units at{" "}
            {money(item.unit_price)}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {Object.keys(item.requirement_evidence)
              .filter((attr) =>
                item.requested.requirements?.includes(
                  attr as "lactose_free" | "gluten_free" | "vegan",
                ),
              )
              .map((attr) => (
                <span
                  key={attr}
                  className="inline-flex items-center gap-1 rounded bg-emerald-50 px-2 py-1 text-[10px] font-medium text-emerald-800"
                >
                  <Check className="size-3" aria-hidden />
                  {attr.replaceAll("_", "-")}
                </span>
              ))}
            <span className="inline-flex items-center gap-1 rounded bg-[#f2f7f8] px-2 py-1 text-[10px] font-medium text-primary">
              <Check className="size-3" aria-hidden />
              Delivery checked
            </span>
          </div>
          <p className="my-4 text-[11px] leading-6 text-muted-foreground">
            Lowest eligible total for this product need. Requirements, quantity
            and delivery verified against catalog and API evidence.
          </p>
          <Disclosure title="Compare alternatives">
            <div className="space-y-3">
              {request.alternatives[index]?.map((offer) => (
                <div
                  key={offer.id}
                  className={cn(
                    "rounded-lg border p-3",
                    offer.id === item.id
                      ? "border-[#b2ccd4] bg-[#f2f7f8]"
                      : "border-border",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-xs font-medium leading-5">
                      {offer.name}
                    </p>
                    <p className="text-xs font-semibold whitespace-nowrap">
                      {offer.total !== "0.00"
                        ? money(offer.total)
                        : "Price unavailable"}
                    </p>
                  </div>
                  {offer.id === item.id ? (
                    <p className="mt-2 flex items-center gap-1 text-[10px] font-medium text-primary">
                      <Check className="size-3" aria-hidden />
                      Selected
                    </p>
                  ) : offer.eligible ? (
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <p className="text-[10px] text-muted-foreground">
                        Eligible alternative
                      </p>
                      {onSelect && (
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={selecting}
                          onClick={() => onSelect(index, offer)}
                        >
                          Select this product
                        </Button>
                      )}
                    </div>
                  ) : (
                    <ul className="mt-2 list-disc space-y-1 pl-4 text-[11px] leading-5 text-muted-foreground">
                      {offer.reasons.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </Disclosure>
          <Disclosure title="Product evidence and pack calculation">
            <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-3 text-[11px]">
              <dt className="text-muted-foreground">Product ID</dt>
              <dd>{item.product_id}</dd>
              <dt className="text-muted-foreground">Pack calculation</dt>
              <dd>{item.conversion}</dd>
              <dt className="text-muted-foreground">Sales unit</dt>
              <dd>{item.sales_unit} (catalog code)</dd>
              <dt className="text-muted-foreground">Source</dt>
              <dd>{item.source}</dd>
              <dt className="text-muted-foreground">Checked</dt>
              <dd>
                {dateLabel(item.checked_at)} at {timeLabel(item.checked_at)}{" "}
                Helsinki time
              </dd>
              {Object.entries(item.requirement_evidence).map(([key, value]) => (
                <div key={key} className="contents">
                  <dt className="text-muted-foreground">
                    {key.replaceAll("_", "-")}
                  </dt>
                  <dd>{value}</dd>
                </div>
              ))}
              <dt className="text-muted-foreground">Delivery history</dt>
              <dd>
                {item.reliability == null
                  ? "Not supplied"
                  : `${(item.reliability * 100).toFixed(1)}% historically delivered; not a future guarantee`}
              </dd>
              <dt className="text-muted-foreground">Carbon estimate</dt>
              <dd>
                {item.carbon == null
                  ? "Not supplied"
                  : `${item.carbon} kg CO₂-eq/kg — product-group average`}
              </dd>
            </dl>
          </Disclosure>
        </article>
      ))}
    </div>
  );
}

function Timeline({
  request,
  technical,
}: {
  request: Purchase;
  technical: boolean;
}) {
  return (
    <ol className="space-y-0">
      {request.events.map((event, i) => (
        <li key={event.id} className="relative flex gap-3 pb-6 last:pb-0">
          {i !== request.events.length - 1 && (
            <span
              className="absolute left-[11px] top-6 bottom-0 w-px bg-border"
              aria-hidden
            />
          )}
          <span className="relative z-10 mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-white">
            <Check className="size-3 text-primary" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                {event.actor}
              </span>
              <time
                className="text-[10px] text-muted-foreground"
                dateTime={event.at}
              >
                {timeLabel(event.at)}
              </time>
            </div>
            <p className="mt-1 text-xs font-semibold leading-5">
              {event.title}
            </p>
            <p className="mt-1 text-[11px] leading-6 text-muted-foreground">
              {event.detail}
            </p>
            {technical && Object.keys(event.evidence || {}).length > 0 && (
              <details className="mt-2">
                <summary className="flex min-h-8 items-center gap-1 text-[10px] font-medium text-primary">
                  Inspect tool evidence
                  <ChevronDown className="size-3" aria-hidden />
                </summary>
                <pre className="mt-2 max-h-80 overflow-auto rounded-lg border border-border bg-background p-3 text-[10px] leading-5 whitespace-pre-wrap break-all">
                  {JSON.stringify(event.evidence, null, 2)}
                </pre>
              </details>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
