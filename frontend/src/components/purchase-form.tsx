"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  CalendarDays,
  Check,
  Info,
  LoaderCircle,
  MapPin,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import {
  api,
  post,
  type Policy,
  type Purchase,
  type PurchaseInput,
  type Session,
} from "@/lib/api";
import { money, number } from "@/lib/utils";
import { Button } from "./ui/button";
import { ErrorNotice } from "./gateway";

export function PurchaseForm({ session }: { session: Session }) {
  const router = useRouter(),
    client = useQueryClient();
  const [text, setText] = useState("");
  const [date, setDate] = useState(session.next_monday);
  const [location, setLocation] = useState(session.location);
  const submission = useRef<{ body: string; key: string } | null>(null);
  const policy = useQuery({
    queryKey: ["policy"],
    queryFn: () => api<Policy>("/policy"),
  });
  const requests = useQuery({
    queryKey: ["purchases"],
    queryFn: () => api<Purchase[]>("/requests"),
    refetchInterval: 5000,
  });
  const pending =
    requests.data?.filter((request) =>
      ["approval_pending", "changed"].includes(request.status),
    ) || [];
  const mutation = useMutation({
    mutationFn: (payload: PurchaseInput) => {
      const body = JSON.stringify(payload);
      if (submission.current?.body !== body)
        submission.current = { body, key: crypto.randomUUID() };
      return post<Purchase>("/requests", payload, submission.current!.key);
    },
    onSuccess: (request) => {
      client.setQueryData(["request", request.id], request);
      router.push(`/customer/requests/${request.id}`);
    },
  });
  const quantity = policy.data?.quantity_rules.find((r) => r.group === "milk");
  return (
    <>
      <div className="mb-8 flex items-end justify-between gap-5">
        <div>
          <p className="eyebrow mb-3">Your purchasing agent</p>
          <h1 className="page-title max-w-xl">What does your kitchen need?</h1>
          <p className="mt-3 max-w-lg text-sm leading-6 text-muted-foreground">
            One request. A complete basket. Your rules at every step.
          </p>
        </div>
        <div className="hidden items-center gap-2 rounded-full border border-border bg-white px-3 py-2 text-[10px] font-medium text-muted-foreground xl:flex">
          <span className="size-1.5 rounded-full bg-emerald-600" />
          Your own demo sandbox
        </div>
      </div>
      {pending.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-xs font-medium text-amber-900">
            {pending.length === 1
              ? "A basket is waiting for your approval."
              : `${pending.length} baskets are waiting for your approval.`}
          </p>
          <Link
            href={`/customer/approvals/${pending[0].id}`}
            className="inline-flex min-h-8 items-center gap-2 text-xs font-semibold text-amber-950"
          >
            Review basket
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>
      )}
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_260px]">
        <div>
          <form
            className="panel overflow-hidden"
            onSubmit={(e) => {
              e.preventDefault();
              mutation.mutate({
                text,
                needed_by: date,
                location,
              });
            }}
          >
            <div className="p-6">
              <div className="mb-5">
                <div className="flex items-center justify-between gap-3">
                  <label
                    htmlFor="purchase-request"
                    className="text-xs font-medium"
                  >
                    Your request
                  </label>
                </div>
                  <textarea
                    id="purchase-request"
                    className="mt-2 min-h-[104px] w-full !rounded-xl !border-border !bg-background/40 !p-4 !text-[15px] leading-7"
                    value={text}
                    onChange={(e) => {
                      setText(e.target.value);
                    }}
                    placeholder="e.g. Order 500 L of lactose-free milk and 10 kg of rolled oats…"
                    maxLength={3000}
                    required
                  />
                {!session.gemini_ready && (
                  <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-5 text-muted-foreground">
                    <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    The purchasing AI is not connected. Configure GEMINI_API_KEY on the server to submit requests.
                  </p>
                )}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label>
                  <span className="flex items-center gap-1.5 text-xs">
                    <MapPin className="size-3.5" aria-hidden />
                    Delivery location
                  </span>
                  <input
                    aria-label="Delivery location"
                    className="w-full !text-xs"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    required
                    maxLength={100}
                  />
                </label>
                <label>
                  <span className="flex items-center gap-1.5 text-xs">
                    <CalendarDays className="size-3.5" aria-hidden />
                    Delivery date
                  </span>
                  <input
                    aria-label="Delivery date"
                    className="w-full !text-xs"
                    type="date"
                    value={date}
                    min={new Intl.DateTimeFormat("sv-SE", {
                      timeZone: "Europe/Helsinki",
                    }).format(new Date())}
                    onChange={(e) => setDate(e.target.value)}
                    required
                  />
                </label>
              </div>
              {mutation.error && (
                <div className="mt-5">
                  <ErrorNotice error={mutation.error} />
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border bg-background/40 px-6 py-5">
              <p className="flex max-w-[290px] items-start gap-2 text-[11px] leading-5 text-muted-foreground">
                <ShieldCheck
                  className="mt-0.5 size-4 shrink-0 text-primary"
                  aria-hidden
                />
                Your agent can place this basket automatically when it meets
                your saved rules.
              </p>
              <Button
                type="submit"
                disabled={
                  mutation.isPending ||
                  !text.trim() || !session.gemini_ready
                }
              >
                {mutation.isPending ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Sparkles />
                )}
                {mutation.isPending
                  ? "Starting agent…"
                  : "Ask purchasing agent"}
                {!mutation.isPending && <ArrowRight />}
              </Button>
            </div>
          </form>
        </div>
        <aside className="space-y-5">
          <div className="panel p-5">
            <div className="mb-5 flex items-center gap-2">
              <ShieldCheck className="size-4 text-primary" aria-hidden />
              <h2 className="text-xs font-semibold">Your purchasing rules</h2>
            </div>
            <div className="space-y-4">
              <div>
                <p className="text-[11px] text-muted-foreground">
                  Automatic milk quantity
                </p>
                <p className="mt-1 text-lg font-semibold tabular">
                  {quantity
                    ? `${number(quantity.limit)} ${quantity.unit}`
                    : "No quantity limit"}
                  <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                    / delivery
                  </span>
                </p>
              </div>
              <div className="border-t border-border pt-4">
                <p className="text-[11px] text-muted-foreground">
                  Automatic spend
                </p>
                <p className="mt-1 text-lg font-semibold tabular">
                  {policy.data ? money(policy.data.spend_limit) : "…"}
                  <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                    / delivery
                  </span>
                </p>
              </div>
              <p className="flex items-start gap-2 border-t border-border pt-4 text-[11px] leading-5 text-muted-foreground">
                <Check
                  className="mt-0.5 size-3.5 shrink-0 text-emerald-700"
                  aria-hidden
                />
                {policy.data?.attribute_rules.length
                  ? "Required product attributes checked against catalog evidence."
                  : "Request-specific requirements are always checked."}
              </p>
            </div>
            <Link
              href="/customer/rules"
              className="mt-5 inline-flex min-h-8 items-center gap-1.5 text-[11px] font-semibold text-primary"
            >
              Manage rules
              <ArrowRight className="size-3" aria-hidden />
            </Link>
          </div>
          <div className="px-2 py-1">
            <h2 className="mb-4 text-xs font-semibold">How it works</h2>
            <ol className="space-y-5">
              {[
                ["You request", "Tell your agent what the kitchen needs."],
                [
                  "Agents compare",
                  "Products, prices, and delivery are checked.",
                ],
                [
                  "Rules decide",
                  "Routine orders go through. Exceptions come to you.",
                ],
              ].map(([title, detail], i) => (
                <li key={title} className="flex gap-3">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-border bg-white text-[9px] font-semibold">
                    {i + 1}
                  </span>
                  <div>
                    <p className="text-[11px] font-semibold">{title}</p>
                    <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                      {detail}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </aside>
      </div>
    </>
  );
}
