export class RateLimiter {
  private readonly limits = {
    notslider: { rpm: 60, delayMs: 1000 },
    soundcloud: { rpm: 100, delayMs: 600 },
    openai: { rpm: 60, delayMs: 1000 }
  };

  private lastRequest = new Map<string, number>();

  async throttle(service: string): Promise<void> {
    const config = this.limits[service as keyof typeof this.limits];
    if (!config) {
      console.warn(`No rate limit config found for service: ${service}`);
      return;
    }

    const last = this.lastRequest.get(service) || 0;
    const elapsed = Date.now() - last;

    if (elapsed < config.delayMs) {
      const waitTime = config.delayMs - elapsed;
      await new Promise(r => setTimeout(r, waitTime));
    }

    this.lastRequest.set(service, Date.now());
  }

  // Get current delay for a service
  getCurrentDelay(service: string): number {
    const config = this.limits[service as keyof typeof this.limits];
    if (!config) return 0;

    const last = this.lastRequest.get(service) || 0;
    const elapsed = Date.now() - last;
    return Math.max(0, config.delayMs - elapsed);
  }

  // Reset rate limit for a service (useful for testing)
  reset(service: string): void {
    this.lastRequest.delete(service);
  }

  // Reset all rate limits
  resetAll(): void {
    this.lastRequest.clear();
  }
}