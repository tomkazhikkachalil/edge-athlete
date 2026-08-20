import { describe, it, expect } from 'vitest';
import { safeInternalPath } from '../safe-internal-path';

describe('safeInternalPath', () => {
  it('passes same-origin absolute paths', () => {
    expect(safeInternalPath('/invite/abc123')).toBe('/invite/abc123');
    expect(safeInternalPath('/app/guardian?tab=x')).toBe('/app/guardian?tab=x');
  });

  it('rejects protocol-relative and absolute URLs', () => {
    expect(safeInternalPath('//evil.com/x')).toBeNull();
    expect(safeInternalPath('https://evil.com')).toBeNull();
    expect(safeInternalPath('/x://y')).toBeNull();
  });

  it('rejects relative paths, backslashes, and empties', () => {
    expect(safeInternalPath('invite/abc')).toBeNull();
    expect(safeInternalPath('/\\evil.com')).toBeNull();
    expect(safeInternalPath('')).toBeNull();
    expect(safeInternalPath(null)).toBeNull();
    expect(safeInternalPath(undefined)).toBeNull();
  });
});
