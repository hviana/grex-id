"use client";

import { Surreal } from "surrealdb";

let frontendDb: Surreal | null = null;
let cachedConfig: {
  url: string;
  namespace: string;
  database: string;
  user: string;
  pass: string;
} | null = null;

async function getFrontendDbConfig(): Promise<{
  url: string;
  namespace: string;
  database: string;
  user: string;
  pass: string;
}> {
  if (cachedConfig) return cachedConfig;

  const res = await fetch("/api/public/front-core");
  if (!res.ok) {
    throw new Error("Failed to fetch frontend database configuration");
  }
  const json = await res.json();
  const data = json.data as Record<string, { value: string }>;

  const url = data["db.frontend.url"]?.value;
  const namespace = data["db.frontend.namespace"]?.value;
  const database = data["db.frontend.database"]?.value;
  const user = data["db.frontend.user"]?.value;
  const pass = data["db.frontend.pass"]?.value;

  if (!url || !namespace || !database || !user || !pass) {
    throw new Error("Missing frontend database configuration settings");
  }

  cachedConfig = { url, namespace, database, user, pass };
  return cachedConfig;
}

export async function connectFrontendDb(): Promise<Surreal> {
  if (frontendDb) {
    return frontendDb;
  }

  const { url, namespace, database, user, pass } = await getFrontendDbConfig();

  frontendDb = new Surreal();
  await frontendDb.connect(url);
  await frontendDb.use({ namespace, database });
  await frontendDb.signin({ username: user, password: pass });

  return frontendDb;
}

export async function disconnectFrontendDb(): Promise<void> {
  if (frontendDb) {
    await frontendDb.close();
    frontendDb = null;
  }
}
