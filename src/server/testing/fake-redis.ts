/** In-memory stand-in for the few Redis commands the app uses (tests only). broken = every call fails. */
import type { RedisLike, RedisPipelineLike } from "@/server/redis";

export class FakeRedis implements RedisLike {
  data = new Map<string, string>();
  ttls = new Map<string, number>();
  expiring = new Set<string>();
  broken = false;
  calls: string[] = [];

  private check(): void {
    if (this.broken) throw new Error("connect ECONNREFUSED 127.0.0.1:6380");
  }

  get(key: string): Promise<string | null> {
    this.calls.push(`get ${key}`);
    try {
      this.check();
    } catch (e) {
      return Promise.reject(e);
    }
    return Promise.resolve(this.data.get(key) ?? null);
  }

  set(key: string, value: string, _mode: "EX", seconds: number): Promise<unknown> {
    this.calls.push(`set ${key}`);
    try {
      this.check();
    } catch (e) {
      return Promise.reject(e);
    }
    this.data.set(key, value);
    this.ttls.set(key, seconds);
    return Promise.resolve("OK");
  }

  incrSync(key: string): number {
    const n = Number(this.data.get(key) ?? "0") + 1;
    this.data.set(key, String(n));
    return n;
  }

  incr(key: string): Promise<number> {
    this.calls.push(`incr ${key}`);
    try {
      this.check();
    } catch (e) {
      return Promise.reject(e);
    }
    return Promise.resolve(this.incrSync(key));
  }

  pipeline(): RedisPipelineLike {
    const ops: Array<["incr" | "expire", string]> = [];
    const p: RedisPipelineLike = {
      incr: (key) => {
        ops.push(["incr", key]);
        return p;
      },
      expire: (key) => {
        ops.push(["expire", key]);
        return p;
      },
      exec: () => {
        if (this.broken) return Promise.reject(new Error("connect ECONNREFUSED 127.0.0.1:6380"));
        const out: Array<[Error | null, unknown]> = ops.map(([op, key]) => {
          if (op === "incr") return [null, this.incrSync(key)];
          this.expiring.add(key);
          return [null, 1];
        });
        return Promise.resolve(out);
      },
    };
    return p;
  }
}
