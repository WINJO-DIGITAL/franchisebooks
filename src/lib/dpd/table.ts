/**
 * Reshapes an on-page table (a grid of cell text) so the existing import
 * pipeline can read it. Pure: no browser, no network. See tableTransformSchema.
 */

import { fillTemplate, type TableTransform, type TemplateValues } from "./portal-map";

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The header row is the first row with at least three cells; a title row above it is left alone. */
function headerIndex(rows: string[][]): number {
  return rows.findIndex((row) => row.length >= 3);
}

export function transformTable(rows: string[][], transform: TableTransform | undefined, values: TemplateValues): string[][] {
  const index = headerIndex(rows);
  if (index < 0) throw new Error("The table has no heading row.");
  const before = rows.slice(0, index);
  const originalHeader = rows[index]!;

  // 1. Headings.
  let header = [...originalHeader];
  if (transform?.headers) {
    if (transform.headers.length !== originalHeader.length) {
      throw new Error(`The table has ${originalHeader.length} columns but the portal map names ${transform.headers.length}.`);
    }
    header = [...transform.headers];
  } else if (transform?.rename) {
    const entries = Object.entries(transform.rename);
    header = originalHeader.map((cell) => entries.find(([from]) => same(from, cell))?.[1] ?? cell);
  }

  // 2. Data rows: drop repeated heading rows (from joining several tables), rows of a different width, and unwanted rows.
  const dropPatterns = (transform?.dropRows ?? []).map((pattern) => new RegExp(pattern, "i"));
  let data = rows.slice(index + 1).filter((row) => {
    if (row.length !== header.length) return false;
    if (row.every((cell, i) => same(cell, originalHeader[i] ?? ""))) return false;
    const first = row.find((cell) => cell.trim() !== "") ?? "";
    return !dropPatterns.some((pattern) => pattern.test(first.trim()));
  });

  const column = (name: string): number => {
    const found = header.findIndex((cell) => same(cell, name));
    if (found < 0) throw new Error(`The portal map refers to a column “${name}” that is not in the table (columns: ${header.join(", ")}).`);
    return found;
  };

  // 3. Clean cells.
  for (const rule of transform?.clean ?? []) {
    const at = column(rule.column);
    const pattern = new RegExp(rule.pattern, "i");
    data = data.map((row) => row.map((cell, i) => (i === at ? cell.replace(pattern, rule.replace).trim() : cell)));
  }

  // 4. Split a column in two (group 1 → new column at the end, group 2 stays in place).
  for (const rule of transform?.split ?? []) {
    const at = column(rule.column);
    const pattern = new RegExp(rule.pattern);
    header[at] = rule.into[1];
    header.push(rule.into[0]);
    data = data.map((row) => {
      const match = pattern.exec(row[at] ?? "");
      const next = [...row, match ? (match[1] ?? "").trim() : ""];
      if (match) next[at] = (match[2] ?? "").trim();
      return next;
    });
  }

  // 5. Constant columns. If the table already has the column (for example a charge with its own date), a row's own
  // value is kept and the constant only fills a blank cell.
  for (const rule of transform?.add ?? []) {
    const value = fillTemplate(rule.value, values);
    const existing = header.findIndex((cell) => same(cell, rule.header));
    if (existing >= 0) {
      data = data.map((row) => row.map((cell, i) => (i === existing && cell.trim() === "" ? value : cell)));
      continue;
    }
    header.push(rule.header);
    data = data.map((row) => [...row, value]);
  }

  return [...before, header, ...data];
}
