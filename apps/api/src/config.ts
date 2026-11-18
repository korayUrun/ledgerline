import { fileURLToPath } from "node:url";

export type ApiConfig = {
  databaseUrl: string;
  port: number;
  // Root folder for uploaded files. A receipt key such as "receipts/<uuid>.pdf"
  // is stored relative to it.
  storageDir: string;
};

// Read once at startup, then passed into AppModule. Modules never read process.env
// themselves, which is what lets the integration tests start the app against a
// throwaway database just by passing a different config.
export function readConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const databaseUrl = env["DATABASE_URL"];
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set (copy .env.example to .env)");
  }
  return {
    databaseUrl,
    port: Number(env["API_PORT"] ?? 3001),
    storageDir:
      env["STORAGE_DIR"] ?? fileURLToPath(new URL("../../../var/storage", import.meta.url)),
  };
}
