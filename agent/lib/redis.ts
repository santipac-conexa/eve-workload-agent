import { Redis } from "@upstash/redis";

let client: Redis | null = null;

function getClient(): Redis {
  if (client) return client;
  const url = process.env.REDIS_REST_URL;
  const token = process.env.REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error(
      "REDIS_REST_URL and REDIS_REST_TOKEN must be set. Provision an Upstash Redis instance and copy the REST credentials.",
    );
  }
  client = new Redis({ url, token });
  return client;
}

export async function getJSON<T>(key: string): Promise<T | null> {
  const value = await getClient().get<T>(key);
  return value ?? null;
}

export async function setJSON<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
  if (ttlSeconds && ttlSeconds > 0) {
    await getClient().set(key, value, { ex: ttlSeconds });
  } else {
    await getClient().set(key, value);
  }
}

export async function del(key: string): Promise<void> {
  await getClient().del(key);
}

export async function keys(pattern: string): Promise<string[]> {
  // SCAN-based; Upstash supports `keys` for small datasets only.
  const result = await getClient().keys(pattern);
  return Array.isArray(result) ? result : [];
}
