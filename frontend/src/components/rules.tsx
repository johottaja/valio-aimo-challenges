"use client";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Info,
  LoaderCircle,
  MapPin,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { api, type Policy } from "@/lib/api";
import { Button } from "./ui/button";
import { ErrorNotice, Loading } from "./gateway";

export function Rules() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["policy"],
    queryFn: () => api<Policy>("/policy"),
  });
  const [draft, setDraft] = useState<Policy>();
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (query.data) setDraft(query.data);
  }, [query.data]);
  const mutation = useMutation({
    mutationFn: (policy: Policy) =>
      api<Policy>("/policy", { method: "PUT", body: JSON.stringify(policy) }),
    onSuccess: (data) => {
      client.setQueryData(["policy"], data);
      client.invalidateQueries({ queryKey: ["session"] });
      client.invalidateQueries({ queryKey: ["purchases"] });
      client.invalidateQueries({ queryKey: ["request"] });
      setSaved(true);
    },
  });
  const edit = (value: Partial<Policy>) => {
    setDraft((current) => (current ? { ...current, ...value } : current));
    setSaved(false);
  };
  if (!draft)
    return (
      <>
        <ErrorNotice error={query.error} />
        <Loading label="Loading purchasing rules…" />
      </>
    );
  return (
    <div className="max-w-4xl">
      <div className="mb-8">
        <p className="eyebrow mb-3">Customer control</p>
        <h1 className="page-title">Your rules. Your authority.</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Decide what your agent can purchase on its own, and what comes back to
          you.
        </p>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate(draft);
        }}
        className="space-y-5"
      >
        <div className="panel p-6 sm:p-7">
          <div className="mb-6 flex items-center gap-2">
            <ShieldCheck className="size-4 text-primary" aria-hidden />
            <h2 className="text-sm font-semibold">
              Automatic purchasing limits
            </h2>
            <span className="ml-auto rounded bg-muted px-2 py-1 text-[10px] text-muted-foreground">
              Version {draft.version}
            </span>
          </div>
          <label className="block max-w-xs">
            <span>Spend limit per delivery (€)</span>
            <input
              aria-label="Spend limit per delivery"
              className="w-full"
              type="number"
              min="0.01"
              step="0.01"
              value={draft.spend_limit}
              onChange={(e) => edit({ spend_limit: e.target.value })}
              required
            />
          </label>
          <p className="mt-2 text-[11px] text-muted-foreground">
            The total includes related orders for the same location and delivery
            date.
          </p>
          <div className="mt-6 border-t border-border pt-5">
            <h3 className="mb-3 text-xs font-semibold">Quantity limits</h3>
            <div className="space-y-3">
              {draft.quantity_rules.map((rule, i) => (
                <div
                  key={i}
                  className="grid grid-cols-[1fr_1fr_70px_36px] items-end gap-2 max-sm:grid-cols-[1fr_1fr_36px]"
                >
                  <label className="max-sm:col-span-3">
                    <span>Product group</span>
                    <select
                      aria-label={`Quantity product group ${i + 1}`}
                      className="w-full"
                      value={rule.group}
                      onChange={(e) =>
                        edit({
                          quantity_rules: draft.quantity_rules.map(
                            (r, index) =>
                              i === index ? { ...r, group: e.target.value } : r,
                          ),
                        })
                      }
                    >
                      <option value="milk">Milk</option>
                      <option value="oats">Oats</option>
                    </select>
                  </label>
                  <label>
                    <span>Automatic limit</span>
                    <input
                      aria-label={`Automatic quantity limit ${i + 1}`}
                      className="w-full"
                      type="number"
                      min="0.001"
                              step="0.001"
                      required
                      value={rule.limit}
                      onChange={(e) =>
                        edit({
                          quantity_rules: draft.quantity_rules.map(
                            (r, index) =>
                              i === index ? { ...r, limit: e.target.value } : r,
                          ),
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>Unit</span>
                    <select
                      aria-label={`Quantity rule unit ${i + 1}`}
                      className="w-full"
                      value={rule.unit}
                      onChange={(e) =>
                        edit({
                          quantity_rules: draft.quantity_rules.map(
                            (r, index) =>
                              i === index
                                ? {
                                    ...r,
                                    unit: e.target.value as typeof r.unit,
                                  }
                                : r,
                          ),
                        })
                      }
                    >
                      <option>L</option>
                      <option>kg</option>
                      <option>pcs</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    className="flex min-h-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-red-50 hover:text-red-700"
                    aria-label={`Remove quantity rule ${i + 1}`}
                    onClick={() =>
                      edit({
                        quantity_rules: draft.quantity_rules.filter(
                          (_, index) => i !== index,
                        ),
                      })
                    }
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                </div>
              ))}
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="mt-4"
              disabled={draft.quantity_rules.length >= 10}
              onClick={() =>
                edit({
                  quantity_rules: [
                    ...draft.quantity_rules,
                    { group: "oats", limit: "100", unit: "kg" },
                  ],
                })
              }
            >
              <Plus />
              Add quantity limit
            </Button>
          </div>
        </div>
        <div className="panel p-6 sm:p-7">
          <h2 className="mb-5 text-sm font-semibold">Product requirements</h2>
          <p className="mb-5 text-xs leading-6 text-muted-foreground">
            Required attributes must have explicit catalog evidence. Missing
            evidence cannot be approved away.
          </p>
          <div className="space-y-3">
            {draft.attribute_rules.map((rule, i) => (
              <div
                key={i}
                className="grid grid-cols-[1fr_1fr_36px] items-end gap-2"
              >
                <label>
                  <span>Product group</span>
                  <select
                    aria-label={`Attribute product group ${i + 1}`}
                    className="w-full"
                    value={rule.group}
                    onChange={(e) =>
                      edit({
                        attribute_rules: draft.attribute_rules.map(
                          (r, index) =>
                            i === index ? { ...r, group: e.target.value } : r,
                        ),
                      })
                    }
                  >
                    <option value="milk">Milk</option>
                    <option value="oats">Oats</option>
                  </select>
                </label>
                <label>
                  <span>Required attribute</span>
                  <select
                    aria-label={`Required attribute ${i + 1}`}
                    className="w-full"
                    value={rule.attribute}
                    onChange={(e) =>
                      edit({
                        attribute_rules: draft.attribute_rules.map(
                          (r, index) =>
                            i === index
                              ? {
                                  ...r,
                                  attribute: e.target
                                    .value as typeof r.attribute,
                                }
                              : r,
                        ),
                      })
                    }
                  >
                    <option value="lactose_free">Lactose-free</option>
                    <option value="gluten_free">Gluten-free</option>
                    <option value="vegan">Vegan</option>
                  </select>
                </label>
                <button
                  type="button"
                  className="flex min-h-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-red-50 hover:text-red-700"
                  aria-label={`Remove attribute rule ${i + 1}`}
                  onClick={() =>
                    edit({
                      attribute_rules: draft.attribute_rules.filter(
                        (_, index) => i !== index,
                      ),
                    })
                  }
                >
                  <Trash2 className="size-4" aria-hidden />
                </button>
              </div>
            ))}
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="mt-4"
            disabled={draft.attribute_rules.length >= 10}
            onClick={() =>
              edit({
                attribute_rules: [
                  ...draft.attribute_rules,
                  { group: "oats", attribute: "gluten_free" },
                ],
              })
            }
          >
            <Plus />
            Add requirement
          </Button>
        </div>
        <div className="panel p-6 sm:p-7">
          <div className="mb-5 flex items-center gap-2">
            <MapPin className="size-4 text-primary" aria-hidden />
            <h2 className="text-sm font-semibold">Allowed delivery location</h2>
          </div>
          <label className="block max-w-sm">
            <span>Delivery location</span>
            <input
              className="w-full"
              aria-label="Allowed delivery location"
              required
              pattern="[a-zA-Z0-9][a-zA-Z0-9 _-]*"
              maxLength={100}
              value={draft.location}
              onChange={(e) => edit({ location: e.target.value })}
            />
          </label>
        </div>
        <div className="flex items-start gap-2 rounded-xl border border-[#d1dde3] bg-[#f2f7f8] p-4 text-xs leading-6 text-muted-foreground">
          <Info className="mt-1 size-4 shrink-0 text-primary" aria-hidden />
          <p>
            Orders above automatic limits need your approval. Saving rules
            invalidates outstanding previews. Completed demo orders stay in your
            delivery totals.
          </p>
        </div>
        <ErrorNotice error={mutation.error} />
        <div className="flex items-center justify-end gap-4">
          {saved && (
            <span
              role="status"
              className="flex items-center gap-1.5 text-xs text-emerald-800"
            >
              <Check className="size-4" aria-hidden />
              Rules saved
            </span>
          )}
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <Save />
            )}
            {mutation.isPending ? "Saving…" : "Save purchasing rules"}
          </Button>
        </div>
      </form>
    </div>
  );
}
