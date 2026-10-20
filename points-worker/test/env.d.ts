declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    TEST_MIGRATIONS: { name: string; queries: string[] }[];
  }
}
