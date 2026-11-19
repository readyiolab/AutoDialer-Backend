export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
export const DEFAULT_LIST_LIMIT = 100;
export const HARD_LIST_LIMIT = 200;

export function clampPageSize(
  pageSize?: number | string,
  fallback = DEFAULT_PAGE_SIZE,
  max = MAX_PAGE_SIZE,
): number {
  const parsed = Number(pageSize);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.min(Math.floor(parsed), max);
}

export function clampPage(page?: number | string): number {
  const parsed = Number(page);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 1;
  }
  return Math.floor(parsed);
}

export function clampListLimit(
  limit?: number | string,
  fallback = DEFAULT_LIST_LIMIT,
  max = HARD_LIST_LIMIT,
): number {
  return clampPageSize(limit, fallback, max);
}

export function resolveSortBy(
  sortBy: string | undefined,
  allowed: readonly string[],
  fallback: string,
): string {
  if (sortBy && allowed.includes(sortBy)) {
    return sortBy;
  }
  return fallback;
}
