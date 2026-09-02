import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

let client: postgres.Sql | null = null;
let dbInstance: ReturnType<typeof drizzle<typeof schema>> | null = null;

function isValidPostgresUrl(urlStr: string): boolean {
  if (!urlStr || urlStr.includes('[YOUR-') || urlStr.includes('[PASSWORD]')) {
    return false;
  }
  try {
    const parsed = new URL(urlStr);
    return parsed.protocol === 'postgresql:' || parsed.protocol === 'postgres:';
  } catch {
    return false;
  }
}

export function getDb() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString || !isValidPostgresUrl(connectionString)) {
    return null;
  }

  try {
    if (!dbInstance || !client) {
      client = postgres(connectionString, {
        max: process.env.NODE_ENV === 'production' ? 10 : 1,
        idle_timeout: 20,
        connect_timeout: 10,
      });
      dbInstance = drizzle(client, { schema });
    }
    return dbInstance;
  } catch (error) {
    console.warn('Postgres connection initialization failed:', error);
    return null;
  }
}

export { schema };
