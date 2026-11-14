"use client";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Info,
  LoaderCircle,
  Save,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { api, type Policy, type CatalogCategory } from "@/lib/api";
import { Button } from "./ui/button";
import { ErrorNotice, Loading } from "./gateway";

const attributes = {
  lactose_free: "lactose-free",
  gluten_free: "gluten-free",
  vegan: "vegan",
};
function ruleText(policy: Policy) {
  return (
    policy.rules_text ||
    [
      ...policy.quantity_rules.map(
        (r) =>
          `Buy up to ${r.limit} ${r.unit} of ${r.group} per ${r.scope || "delivery"} automatically; ask for approval above this limit.`,
      ),
      ...policy.attribute_rules.map(
        (r) => `${r.group} must be ${attributes[r.attribute]}.`,
      ),
      ...(policy.location_is_explicit
        ? [`Deliver only to ${policy.location}.`]
        : []),
    ].join("\n")
  );
}

export function Rules() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["policy"],
    queryFn: () => api<Policy>("/policy"),
  });
  const [text, setText] = useState("");
  const [spend, setSpend] = useState("");
  const [preview, setPreview] = useState<Policy>();
  const [saved, setSaved] = useState(false);
  const categories = useQuery({
    queryKey: ["catalog-categories"],
    queryFn: () => api<CatalogCategory[]>("/catalog/categories"),
    enabled: Boolean(preview),
  });
  useEffect(() => {
    if (query.data) {
      setText(ruleText(query.data));
      setSpend(String(query.data.spend_limit));
      setPreview(undefined);
    }
  }, [query.data]);
  const interpretation = useMutation({
    mutationFn: () =>
      text === ruleText(query.data!) &&
      spend !== String(query.data!.spend_limit)
        ? Promise.resolve({ ...query.data!, spend_limit: spend })
        : api<Policy>("/policy/interpret", {
            method: "POST",
            body: JSON.stringify({
              text,
              spend_limit: spend,
              version: query.data!.version,
            }),
          }),
    onSuccess: (data) => setPreview(data),
  });
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
  const busy = interpretation.isPending || mutation.isPending;
  const edit = () => {
    setPreview(undefined);
    setSaved(false);
    interpretation.reset();
    mutation.reset();
  };
  const coveredCodes = new Set([
    ...(preview?.quantity_rules.flatMap((rule) => rule.category_codes || []) ||
      []),
    ...(preview?.attribute_rules.flatMap((rule) => rule.category_codes || []) ||
      []),
  ]);
  const covered = categories.data?.filter((category) =>
    coveredCodes.has(category.code),
  );
  if (!query.data)
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
          Write your rules, review the interpretation and save. Your agent will
          follow the saved rules for every purchase.
        </p>
      </div>
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          setPreview(undefined);
          setSaved(false);
          mutation.reset();
          interpretation.mutate();
        }}
      >
        <div className="panel p-6 sm:p-7">
          <div className="mb-6 flex items-center gap-2">
            <ShieldCheck className="size-4 text-primary" aria-hidden />
            <h2 className="text-sm font-semibold">
              Automatic purchasing budget
            </h2>
            <span className="ml-auto rounded bg-muted px-2 py-1 text-[10px] text-muted-foreground">
              Version {query.data.version}
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
              required
              disabled={busy}
              value={spend}
              onChange={(event) => {
                edit();
                setSpend(event.target.value);
              }}
            />
          </label>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Includes related orders for the same location and delivery date.
            Purchases above this amount need your approval.
          </p>
        </div>
        <div className="panel p-6 sm:p-7">
          <h2 className="mb-2 text-sm font-semibold">
            Purchasing rules in your own words
          </h2>
          <p
            id="rules-help"
            className="mb-5 text-xs leading-6 text-muted-foreground"
          >
            Write in Finnish, English or your preferred language. Describe
            automatic quantity limits, dietary requirements and the delivery
            location. Product groups are identified from the full catalog.
          </p>
          <label className="block">
            <span>Your purchasing rules</span>
            <textarea
              aria-label="Purchasing rules"
              aria-describedby="rules-help"
              className="min-h-52 w-full resize-y"
              rows={7}
              required
              maxLength={5000}
              disabled={busy}
              value={text}
              placeholder="Buy up to 100 kg of cheese per delivery without approval. All cheese must be lactose-free. Deliver only to hotel-helsinki."
              onChange={(event) => {
                edit();
                setText(event.target.value);
              }}
            />
          </label>
          <p className="mt-3 text-xs leading-6 text-muted-foreground">
            Supported dietary requirements: lactose-free, gluten-free and vegan.
            Keep monetary limits in the budget field. Rules omitted from this
            text are removed when you save.
          </p>
          <Button
            className="mt-5"
            type="submit"
            variant="secondary"
            disabled={busy || !text.trim()}
          >
            {interpretation.isPending ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <Sparkles />
            )}
            {interpretation.isPending ? "Interpreting rules…" : "Review rules"}
          </Button>
        </div>
        <ErrorNotice error={interpretation.error || mutation.error} />
        {preview && (
          <div className="panel p-6 sm:p-7" aria-live="polite">
            <h2 className="mb-2 text-sm font-semibold">
              Rules interpreted from your text
            </h2>
            <p className="mb-4 text-xs leading-6 text-muted-foreground">
              Check the interpretation and the products it covers. Nothing
              changes until you save.
            </p>
            <ul className="list-disc space-y-2 pl-5 text-sm leading-6">
              {preview.quantity_rules.map((rule, index) => (
                <li key={`quantity-${index}`}>
                  Up to {rule.limit} {rule.unit} of {rule.group} in total per{" "}
                  {rule.scope || "delivery"}; approval required above this
                  limit.
                </li>
              ))}
              {preview.attribute_rules.map((rule, index) => (
                <li key={`attribute-${index}`}>
                  {rule.group}: {attributes[rule.attribute]} required. Missing
                  evidence blocks ordering.
                </li>
              ))}
              {preview.location_is_explicit && (
                <li>Deliver only to {preview.location}.</li>
              )}
            </ul>
            {preview.quantity_rules.length === 0 &&
              preview.attribute_rules.length === 0 &&
              !preview.location_is_explicit && (
                <p className="text-sm text-muted-foreground">
                  No product or delivery rules were found in this text.
                </p>
              )}
            {coveredCodes.size > 0 && (
              <details className="mt-5 rounded-lg bg-muted p-4 text-xs leading-6">
                <summary className="cursor-pointer font-medium">
                  Products covered by these rules
                </summary>
                <ErrorNotice error={categories.error} />
                {categories.isPending && <p>Loading product examples…</p>}
                {covered?.map((category) => (
                  <p className="mt-2" key={category.code}>
                    <span className="font-medium">{category.code}</span> —{" "}
                    {category.examples.join("; ")} ({category.product_count}{" "}
                    products)
                  </p>
                ))}
              </details>
            )}
            <div className="mt-6 flex justify-end">
              <Button
                type="button"
                disabled={busy}
                onClick={() => mutation.mutate(preview)}
              >
                {mutation.isPending ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Save />
                )}
                {mutation.isPending ? "Saving…" : "Save purchasing rules"}
              </Button>
            </div>
          </div>
        )}
        <div className="flex items-start gap-2 rounded-xl border border-blue-100 bg-blue-50/50 p-4 text-xs leading-6 text-muted-foreground">
          <Info className="mt-1 size-4 shrink-0 text-primary" aria-hidden />
          <p>
            Orders above automatic limits need your approval. Dietary
            requirements need explicit product evidence. Saving rules
            invalidates outstanding previews. Completed demo orders stay in your
            delivery totals.
          </p>
        </div>
        {saved && (
          <span
            role="status"
            className="flex items-center gap-1.5 text-xs text-emerald-800"
          >
            <Check className="size-4" aria-hidden />
            Rules saved
          </span>
        )}
      </form>
    </div>
  );
}
