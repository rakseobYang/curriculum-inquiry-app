import { DurableObject } from 'cloudflare:workers';
import worker from './handler.ts';
import { reserveUsage, type UsageStorage } from './usage-limiter.ts';

export class GenerationLimiter extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    return reserveUsage(this.ctx.storage as UsageStorage, request, Date.now());
  }

  async alarm() {
    await this.ctx.storage.deleteAll();
  }
}

export default worker;
