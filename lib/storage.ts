import { Redis } from "@upstash/redis";

export interface KeyValueStore {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttl: number, onlyIfAbsent?: boolean): Promise<boolean>;
  del(key: string): Promise<void>;
  release(key: string, token: string): Promise<void>;
  increment(key: string, ttl: number): Promise<number>;
}

export class RedisStorage implements KeyValueStore {
  private redis: Redis;
  constructor() {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) throw new Error("Session storage is not configured");
    this.redis = new Redis({ url, token });
  }
  get<T>(key: string) { return this.redis.get<T>(key); }
  async set(key: string, value: unknown, ttl: number, onlyIfAbsent = false) {
    const result = onlyIfAbsent
      ? await this.redis.set(key, value, { ex: ttl, nx: true })
      : await this.redis.set(key, value, { ex: ttl });
    return result === "OK";
  }
  async del(key: string) { await this.redis.del(key); }
  async release(key: string, token: string) {
    await this.redis.eval(
      'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) end return 0',
      [key], [token],
    );
  }
  async increment(key: string, ttl: number): Promise<number> {
    return this.redis.eval(
      'local n = redis.call("incr", KEYS[1]); if n == 1 then redis.call("expire", KEYS[1], ARGV[1]) end return n',
      [key], [ttl],
    );
  }
}
