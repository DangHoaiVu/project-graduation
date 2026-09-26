import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

let client: postgres.Sql | null = null;
let dbInstance: ReturnType<typeof drizzle<typeof schema>> | null = null;

function initClient(): ReturnType<typeof drizzle<typeof schema>> | null {
  const connectionString = process.env.DATABASE_URL || '';
  if (!connectionString || connectionString.includes('[YOUR-PASSWORD]') || connectionString.includes('your-password')) {
    return null;
  }
  if (!client || !dbInstance) {
    try {
      client = postgres(connectionString, {
        prepare: false,
        max: process.env.NODE_ENV === 'production' ? 5 : 1,
        idle_timeout: 20,
        connect_timeout: 10,
      });
      dbInstance = drizzle(client, { schema });
    } catch (err) {
      console.warn('Postgres connection initialization failed:', err);
      return null;
    }
  }
  return dbInstance;
}

// Xuất db proxy an toàn, chỉ khởi tạo khi thực sự truy cập
export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_target, prop) {
    const instance = initClient();
    if (!instance) {
      throw new Error('DATABASE_URL is not configured or connection failed');
    }
    return (instance as unknown as Record<string | symbol, unknown>)[prop];
  },
}) as ReturnType<typeof drizzle<typeof schema>>;

export function getDb() {
  return initClient();
}

export { schema };
