declare module 'cloudflare:workers' {
  export class DurableObject<Env = unknown> {
    readonly ctx: {
      storage: {
        get<T>(key: string): Promise<T | undefined>;
        put<T>(key: string, value: T): Promise<void>;
        setAlarm(timestamp: number): Promise<void>;
        deleteAll(): Promise<void>;
      };
    };
    readonly env: Env;
    constructor(ctx: DurableObject['ctx'], env: Env);
  }
}
