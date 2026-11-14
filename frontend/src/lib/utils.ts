import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
export const money = (amount: string | number) =>
  new Intl.NumberFormat("en-FI", { style: "currency", currency: "EUR" }).format(
    Number(amount),
  );
export const number = (amount: string | number) =>
  new Intl.NumberFormat("en-FI", { maximumFractionDigits: 3 }).format(
    Number(amount),
  );
export const dateLabel = (date: string) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Europe/Helsinki",
  }).format(new Date(date.length === 10 ? `${date}T12:00:00Z` : date));
export const timeLabel = (date: string) =>
  new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Helsinki",
  }).format(new Date(date));
