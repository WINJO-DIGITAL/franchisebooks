/** The letters on the badge: a short first word in capitals is the brand ("MJ Logistics" → "MJ"), else the first letters of the first two words. */
export function brandInitials(name?: string | null): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "MJ";
  const first = words[0]!;
  if (/^[A-Z]{2,3}$/.test(first)) return first;
  return words.slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
}
