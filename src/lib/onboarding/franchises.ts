/**
 * Reads the FD numbers a new customer types, however they type them: one per line, or separated by commas, spaces or
 * semicolons; "FD42102", "fd 42102", "FD-42102" or just "42102". Pure code.
 */

export interface FdParseResult {
  /** Normalised ("FD42102"), without duplicates, in the order typed. */
  fdNumbers: string[];
  /** One plain-English line for each entry that is not an FD number. */
  errors: string[];
}

export const MAX_FRANCHISES_AT_SIGN_UP = 50;

export function parseFdNumbers(text: string): FdParseResult {
  // Keep "FD 42102" and "FD-42102" together as one entry before splitting on spaces.
  const joined = text.replace(/\bFD[\s_-]+(?=\d)/gi, "FD");
  const tokens = joined.split(/[\s,;]+/).filter((t) => t !== "");
  const fdNumbers: string[] = [];
  const errors: string[] = [];
  for (const token of tokens) {
    const t = token.toUpperCase().replace(/[_-]/g, "");
    const fd = /^\d{3,8}$/.test(t) ? `FD${t}` : t;
    if (!/^FD\d{3,8}$/.test(fd)) {
      errors.push(`"${token}" does not look like an FD number. It should be like FD42102.`);
      continue;
    }
    if (!fdNumbers.includes(fd)) fdNumbers.push(fd);
  }
  if (fdNumbers.length > MAX_FRANCHISES_AT_SIGN_UP) errors.push(`Please add ${MAX_FRANCHISES_AT_SIGN_UP} franchises or fewer now. You can add more later in Settings.`);
  return { fdNumbers: errors.length > 0 ? [] : fdNumbers, errors };
}

/**
 * Picks the FD numbers out of the text of a portal drop-down's options (for example "FD42102", "FD46578 - North depot",
 * or the "Select a route" placeholder, which is ignored). Normalised, without duplicates, in the order shown.
 */
export function extractFdNumbers(optionTexts: string[]): string[] {
  const found: string[] = [];
  for (const text of optionTexts) {
    for (const match of text.matchAll(/\bFD[\s_-]?(\d{3,8})\b/gi)) {
      const fd = `FD${match[1]}`;
      if (!found.includes(fd)) found.push(fd);
    }
  }
  return found;
}
