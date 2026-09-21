import { describe, it, expect, vi, beforeEach } from 'vitest';

// Round 1 PR 4: `reportRouteError` is a drop-in for `console.error` in a
// route's catch block that ALSO reaches Sentry. Pinned: the console line
// is unchanged (the same args, in order), the first Error goes to
// captureException with the string label in extra, a string-only call
// becomes a captureMessage, and a Sentry failure never becomes the error.

const captureException = vi.fn();
const captureMessage = vi.fn();
vi.mock('@sentry/nextjs', () => ({ captureException: (...a: unknown[]) => captureException(...a), captureMessage: (...a: unknown[]) => captureMessage(...a) }));

import { reportRouteError } from '../observability/report';

describe('reportRouteError', () => {
  beforeEach(() => {
    captureException.mockReset();
    captureMessage.mockReset();
  });

  it('logs the same args and sends the Error to Sentry with the label', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = new Error('boom');
    reportRouteError('[follow] insert failed:', err, { code: '23505' });
    expect(spy).toHaveBeenCalledWith('[follow] insert failed:', err, { code: '23505' });
    expect(captureException).toHaveBeenCalledTimes(1);
    const [sent, ctx] = captureException.mock.calls[0] as [Error, { tags: Record<string, string>; extra: Record<string, unknown> }];
    expect(sent).toBe(err);
    expect(ctx.tags).toEqual({ area: 'api' });
    expect(ctx.extra.label).toBe('[follow] insert failed:');
    expect(ctx.extra.details).toEqual([{ code: '23505' }]);
    expect(captureMessage).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('a call without an Error becomes a message (Supabase errors are plain objects)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    reportRouteError('[posts] read failed:', { message: 'timeout', code: '57014' });
    expect(captureException).not.toHaveBeenCalled();
    expect(captureMessage).toHaveBeenCalledWith('[posts] read failed:', expect.objectContaining({ level: 'error', tags: { area: 'api' }, extra: { details: [{ message: 'timeout', code: '57014' }] } }));
    spy.mockRestore();
  });

  it('never throws when Sentry does', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    captureException.mockImplementation(() => { throw new Error('sentry down'); });
    expect(() => reportRouteError('x', new Error('y'))).not.toThrow();
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
