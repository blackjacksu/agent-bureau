export type Stock = "in_stock" | "low_stock" | "out_of_stock" | "unknown";

export const DEFAULT_STOCK_PHRASES: { re: RegExp; stock: Stock }[] = [
  { re: /out of stock|sold out|currently unavailable|no longer available/i, stock: "out_of_stock" },
  { re: /only\s+\d+\s+left|low stock|hurry,?\s+only|just\s+\d+\s+left/i, stock: "low_stock" },
  { re: /in stock|available now|add to (?:cart|basket)/i, stock: "in_stock" },
];

export function stockFromAvailability(availability: string | null | undefined): Stock {
  if (!availability) return "unknown";
  if (/OutOfStock|SoldOut/i.test(availability)) return "out_of_stock";
  if (/LimitedAvailability/i.test(availability)) return "low_stock";
  if (/InStock/i.test(availability)) return "in_stock";
  return "unknown";
}

export function extractStock(html: string, extraPhrases: { phrase: string; stock: Stock }[] = []): Stock {
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ");
  for (const p of extraPhrases) if (new RegExp(p.phrase, "i").test(text)) return p.stock;
  for (const { re, stock } of DEFAULT_STOCK_PHRASES) if (re.test(text)) return stock;
  return "unknown";
}
