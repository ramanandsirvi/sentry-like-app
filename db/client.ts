import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgres://postgres:postgres@localhost:5433/error_inbox";

const globalForDatabase = globalThis as typeof globalThis & {
  errorInboxPostgres?: ReturnType<typeof postgres>;
};

const client =
  globalForDatabase.errorInboxPostgres ??
  postgres(databaseUrl, {
    max: process.env.NODE_ENV === "development" ? 5 : 10,
    idle_timeout: 20,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDatabase.errorInboxPostgres = client;
}

export const db = drizzle(client, { schema });

export async function closeDatabase(): Promise<void> {
  await client.end({ timeout: 5 });
}
