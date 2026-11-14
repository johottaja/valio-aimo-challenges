"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDown,
  CircleCheck,
  Info,
  LoaderCircle,
  MapPin,
  Plus,
  ShieldCheck,
  ShoppingBasket,
  SlidersHorizontal,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  api,
  post,
  type BasketLine,
  type Policy,
  type Purchase,
  type PurchaseInput,
  type Session,
} from "@/lib/api";
import { cn, money, number } from "@/lib/utils";
import { Button } from "./ui/button";
import { ErrorNotice } from "./gateway";

const examples = {
  routine: {
    label: "Routine purchase",
    text: "Order 500 L of lactose-free milk and 10 kg of rolled oats for our kitchen.",
    amount: "500 L milk + 10 kg oats",
    note: "See an order placed within your rules.",
    number: "01",
  },
  approval: {
    label: "Purchase requiring approval",
    text: "Order 1,500 L of lactose-free milk and 10 kg of rolled oats for our kitchen.",
    amount: "1,500 L milk + 10 kg oats",
    note: "See customer approval in action.",
    number: "02",
  },
};

export function BasketEditor({
  items,
  onChange,
}: {
  items: BasketLine[];
  onChange: (items: BasketLine[]) => void;
}) {
  const update = (index: number, patch: Partial<BasketLine>) =>
    onChange(
      items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  return (
    <div className="space-y-4">
      {items.map((item, i) => (
        <div
          key={i}
          className="rounded-lg border border-border bg-background p-4"
        >
          <div className="grid grid-cols-[1fr_90px_70px_32px] items-end gap-2 max-sm:grid-cols-[1fr_72px_32px]">
            <label className="max-sm:col-span-3">
              <span>Product need {i + 1}</span>
              <input
                className="w-full"
                aria-label={`Product need ${i + 1}`}
                value={item.description}
                onChange={(e) => update(i, { description: e.target.value })}
                placeholder="e.g. lactose-free milk"
                maxLength={200}
                required
              />
            </label>
            <label>
              <span>Quantity</span>
              <input
                aria-label={`Quantity ${i + 1}`}
                className="w-full"
                type="number"
                min="0.0001"
                max="1000000"
                step="0.0001"
                value={item.quantity}
                onChange={(e) => update(i, { quantity: e.target.value })}
                required
              />
            </label>
            <label>
              <span>Unit</span>
              <select
                aria-label={`Unit ${i + 1}`}
                className="w-full"
                value={item.unit}
                onChange={(e) =>
                  update(i, { unit: e.target.value as BasketLine["unit"] })
                }
              >
                <option>L</option>
                <option>kg</option>
                <option>pcs</option>
              </select>
            </label>
            <button
              type="button"
              aria-label={`Remove product need ${i + 1}`}
              className="flex min-h-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-red-50 hover:text-red-700"
              onClick={() => onChange(items.filter((_, index) => i !== index))}
            >
              <Trash2 className="size-4" aria-hidden />
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-4">
            {(["lactose_free", "gluten_free", "vegan"] as const).map((attr) => (
              <label
                key={attr}
                className="flex min-h-8 items-center gap-2 !text-xs !font-normal"
              >
                <input
                  type="checkbox"
                  checked={item.requirements?.includes(attr) || false}
                  onChange={(e) =>
                    update(i, {
                      requirements: e.target.checked
                        ? [...(item.requirements || []), attr]
                        : item.requirements?.filter((a) => a !== attr),
                    })
                  }
                />
                {attr.replaceAll("_", "-")}
              </label>
            ))}
          </div>
        </div>
      ))}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={items.length >= 10}
        onClick={() =>
          onChange([
            ...items,
            { description: "", quantity: 1, unit: "kg", requirements: [] },
          ])
        }
      >
        <Plus />
        Add product need
      </Button>
      <p className="text-[11px] leading-5 text-muted-foreground">
        Up to 10 product needs. The whole basket must be eligible before
        anything is ordered.
      </p>
    </div>
  );
}

export function PurchaseForm({ session }: { session: Session }) {
  const router = useRouter(),
    client = useQueryClient();
  const [text, setText] = useState("");
  const [preset, setPreset] = useState<"routine" | "approval" | undefined>();
  const [date, setDate] = useState(session.next_monday);
  const [structured, setStructured] = useState(false);
  const [items, setItems] = useState<BasketLine[]>([
    {
      description: "lactose-free milk",
      quantity: 500,
      unit: "L",
      requirements: ["lactose_free"],
    },
    { description: "rolled oats", quantity: 10, unit: "kg", requirements: [] },
  ]);
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
  const choose = (type: "routine" | "approval") => {
    setText(examples[type].text);
    setPreset(type);
    setStructured(false);
  };
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
          <div
            className="mb-4 grid gap-3 sm:grid-cols-2"
            aria-label="Demo scenarios"
          >
            {Object.entries(examples).map(([key, example]) => (
              <button
                key={key}
                type="button"
                onClick={() => choose(key as "routine" | "approval")}
                aria-pressed={preset === key}
                className={cn(
                  "panel flex items-start gap-3 p-4 text-left transition-colors hover:border-primary",
                  preset === key && "!border-primary bg-blue-50/40",
                )}
              >
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium">
                  {example.number}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-semibold">
                    {example.label}
                  </span>
                  <span className="mt-1 block text-[10px] leading-5 text-muted-foreground">
                    {example.amount}
                  </span>
                </span>
                {preset === key ? (
                  <CircleCheck
                    className="mt-1 size-4 shrink-0 text-primary"
                    aria-hidden
                  />
                ) : (
                  <ArrowRight
                    className="mt-1 size-4 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                )}
              </button>
            ))}
          </div>
          <form
            className="panel overflow-hidden"
            onSubmit={(e) => {
              e.preventDefault();
              mutation.mutate({
                text,
                preset: structured ? undefined : preset,
                items: structured ? items : [],
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
                  <button
                    type="button"
                    className="min-h-8 text-[11px] font-medium text-primary hover:underline"
                    onClick={() => setStructured(!structured)}
                  >
                    {structured
                      ? "Use a written request"
                      : "Enter basket lines"}
                  </button>
                </div>
                {structured ? (
                  <div className="mt-3">
                    <BasketEditor items={items} onChange={setItems} />
                  </div>
                ) : (
                  <textarea
                    id="purchase-request"
                    className="mt-2 min-h-[104px] w-full !rounded-xl !border-border !bg-background/40 !p-4 !text-[15px] leading-7"
                    value={text}
                    onChange={(e) => {
                      setText(e.target.value);
                      setPreset(undefined);
                    }}
                    placeholder="e.g. Order 500 L of lactose-free milk and 10 kg of rolled oats…"
                    maxLength={3000}
                    required
                  />
                )}
                {!structured && !session.gemini_ready && (
                  <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-5 text-muted-foreground">
                    <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    Choose an example or enter basket lines. Custom written
                    requests need a connected AI.
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
                  (!structured && !text.trim()) ||
                  (structured && !items.length)
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
