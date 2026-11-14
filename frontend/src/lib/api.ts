import type { components } from "./api-schema";

export type Session = components["schemas"]["SessionView"];
export type Policy = Required<components["schemas"]["Policy-Output"]>;
export type Purchase = components["schemas"]["RequestView"];
export type Offer = components["schemas"]["Offer"];
export type Receipt = components["schemas"]["OrderReceipt"];
export type BasketLine = components["schemas"]["BasketLine-Input"];
export type Preview = components["schemas"]["BasketPreview"];
export type PurchaseInput = components["schemas"]["PurchaseRequest-Input"];

export class ApiError extends Error {
  constructor(
    message: string,
    public code: string,
    public field?: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
    credentials: "same-origin",
    cache: "no-store",
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new ApiError(
      "The gateway is unavailable. Check the API service and try again.",
      "gateway_unavailable",
    );
  }
  if (!response.ok)
    throw new ApiError(
      result.message || "Something went wrong. Please try again.",
      result.code,
      result.field,
    );
  return result;
}
export function post<T>(path: string, body?: unknown, key?: string) {
  return api<T>(path, {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: key ? { "Idempotency-Key": key } : {},
  });
}
