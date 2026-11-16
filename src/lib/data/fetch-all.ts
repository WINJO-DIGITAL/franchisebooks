/**
 * The Data API returns at most 1,000 rows per request. Financial totals must
 * never be computed from a silently truncated result, so every multi-row read
 * that feeds a calculation goes through this helper, which pages until done.
 */

const PAGE_SIZE = 1000;

interface Pageable<T> {
  range(from: number, to: number): PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
}

export async function fetchAll<T>(build: () => Pageable<T>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build().range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`Database read failed: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return rows;
}

/** Throws on a database error so a failed read can never be mistaken for "no data". */
export function must<T>(result: { data: T | null; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data as T;
}
