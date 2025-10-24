interface RateLimitEntry {
  count: number;
  resetTime: number;
}

class RateLimiter {
  private attempts = new Map<string, RateLimitEntry>();
  private readonly maxAttempts: number;
  private readonly windowMs: number;

  constructor(maxAttempts = 5, windowMinutes = 15) {
    this.maxAttempts = maxAttempts;
    this.windowMs = windowMinutes * 60 * 1000;
  }

  private getKey(identifier: string, action: string): string {
    return `${action}:${identifier}`;
  }

  private cleanupExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.attempts.entries()) {
      if (entry.resetTime <= now) {
        this.attempts.delete(key);
      }
    }
  }

  check(identifier: string, action: string): { allowed: boolean; remainingAttempts: number; resetTime: number } {
    this.cleanupExpired();
    
    const key = this.getKey(identifier, action);
    const now = Date.now();
    const entry = this.attempts.get(key);

    if (!entry || entry.resetTime <= now) {
      // First attempt or window expired
      this.attempts.set(key, {
        count: 1,
        resetTime: now + this.windowMs
      });
      return {
        allowed: true,
        remainingAttempts: this.maxAttempts - 1,
        resetTime: now + this.windowMs
      };
    }

    if (entry.count >= this.maxAttempts) {
      return {
        allowed: false,
        remainingAttempts: 0,
        resetTime: entry.resetTime
      };
    }

    // Increment count
    entry.count++;
    return {
      allowed: true,
      remainingAttempts: this.maxAttempts - entry.count,
      resetTime: entry.resetTime
    };
  }

  reset(identifier: string, action: string): void {
    const key = this.getKey(identifier, action);
    this.attempts.delete(key);
  }
}

// Create singleton instances for different actions
export const loginRateLimiter = new RateLimiter(5, 15); // 5 attempts per 15 minutes
export const apiRateLimiter = new RateLimiter(100, 1); // 100 requests per minute