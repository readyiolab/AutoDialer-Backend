import {
  clampPageSize,
  clampPage,
  resolveSortBy,
  MAX_PAGE_SIZE,
} from './pagination';

describe('pagination utils', () => {
  it('clamps pageSize to the max', () => {
    expect(clampPageSize(500)).toBe(MAX_PAGE_SIZE);
    expect(clampPageSize(0)).toBe(20);
    expect(clampPageSize(undefined)).toBe(20);
  });

  it('clamps page to a positive integer', () => {
    expect(clampPage(-1)).toBe(1);
    expect(clampPage('3')).toBe(3);
  });

  it('allow-lists sort fields', () => {
    expect(resolveSortBy('name', ['name', 'createdAt'], 'createdAt')).toBe('name');
    expect(resolveSortBy('password', ['name', 'createdAt'], 'createdAt')).toBe(
      'createdAt',
    );
  });
});
