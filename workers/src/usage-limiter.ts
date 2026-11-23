export type UsageStorage = {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  setAlarm(timestamp: number): Promise<void>;
  deleteAll(): Promise<void>;
};

export async function reserveUsage(storage: UsageStorage, request: Request, now: number) {
  if (request.method !== 'POST') return new Response(null, { status: 405 });
  let body: { day?: unknown; limit?: unknown; intervalMs?: unknown };
  try { body = await request.json() as typeof body; } catch { return new Response(null, { status: 400 }); }
  if (typeof body.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.day) ||
      typeof body.limit !== 'number' || body.limit < 1 || body.limit > 100 ||
      typeof body.intervalMs !== 'number' || body.intervalMs < 0 || body.intervalMs > 60000 ||
      (body.intervalMs > 0 && body.intervalMs < 1000)) {
    return new Response(null, { status: 400 });
  }
  const current = await storage.get<{ day: string; count: number; lastAt: number }>('usage');
  const count = current?.day === body.day ? current.count : 0;
  const lastAt = current?.day === body.day ? current.lastAt : 0;
  if (count >= body.limit || (body.intervalMs > 0 && now - lastAt < body.intervalMs)) {
    return new Response(null, { status: 429 });
  }
  await storage.put('usage', { day: body.day, count: count + 1, lastAt: now });
  await storage.setAlarm(now + 90 * 24 * 60 * 60 * 1000);
  return Response.json({ allowed: true, remaining: body.limit - count - 1 });
}
