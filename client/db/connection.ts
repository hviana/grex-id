"use client";

import { Surreal } from "surrealdb";

let frontendDb: Surreal | null = null;

export async function connectFrontendDb(userToken: string): Promise<Surreal> {
  if (frontendDb) {
    return frontendDb;
  }

  const url = "ws://127.0.0.1:8000/rpc";
  const namespace = "core";
  const database = "main";

  frontendDb = new Surreal();
  await frontendDb.connect(url);
  await frontendDb.use({ namespace, database });
  await frontendDb.authenticate(userToken);

  return frontendDb;
}

export async function disconnectFrontendDb(): Promise<void> {
  if (frontendDb) {
    await frontendDb.close();
    frontendDb = null;
  }
}
