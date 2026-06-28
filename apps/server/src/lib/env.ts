import { z } from "zod";

const booleanEnv = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  if (["true", "1", "yes", "on"].includes(value.toLowerCase())) return true;
  if (["false", "0", "no", "off"].includes(value.toLowerCase())) return false;
  return value;
}, z.boolean());

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  SERVER_PORT: z.coerce.number().int().positive().default(4000),
  SERVER_HOST: z.string().default("0.0.0.0"),
  WEB_ORIGIN: z.string().default("http://localhost:8081,http://localhost:5173"),
  TRUST_PROXY: booleanEnv.default(true),
  COOKIE_SECURE: booleanEnv.optional(),
  JWT_SECRET: z.string().min(16),
  AGENT_TOKEN: z.string().min(8),
  PROTECTED_FOLDER_PIN: z.string().regex(/^\d{4}$/).default("0000"),
  PROTECTED_FOLDER_PATTERNS: z.string().default(""),
  ADMIN_USER: z.string().min(1).default("admin"),
  ADMIN_PASSWORD: z.string().min(8),
  THUMBNAILS_DIR: z.string().default("/data/video-catalog/thumbnails"),
  PUBLIC_THUMBNAILS_BASE_URL: z.string().default("/thumbnails")
});

export const env = envSchema.parse(process.env);

function assertProductionSecret(name: string, value: string, minimumLength: number, blockedValues: string[]): void {
  if (process.env.NODE_ENV !== "production") return;
  const normalized = value.trim().toLowerCase();
  const isBlocked = blockedValues.some((blocked) => normalized === blocked)
    || normalized.startsWith("change-me")
    || normalized.startsWith("replace-with");
  if (value.length < minimumLength || isBlocked) {
    throw new Error(`${name} must be changed to a strong value before running VideoCAT in production.`);
  }
}

assertProductionSecret("JWT_SECRET", env.JWT_SECRET, 32, ["change-me-long-random-string"]);
assertProductionSecret("AGENT_TOKEN", env.AGENT_TOKEN, 32, ["change-me-agent-token"]);
assertProductionSecret("ADMIN_PASSWORD", env.ADMIN_PASSWORD, 12, ["change-me-admin-password"]);
assertProductionSecret("PROTECTED_FOLDER_PIN", env.PROTECTED_FOLDER_PIN, 4, ["0000", "1234", "2468", "9284"]);

function allWebOriginsAreLocal(originList: string): boolean {
  return originList
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .every((origin) => {
      try {
        const hostname = new URL(origin).hostname;
        return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
      } catch {
        return false;
      }
    });
}

if (process.env.NODE_ENV === "production" && env.COOKIE_SECURE !== true && !allWebOriginsAreLocal(env.WEB_ORIGIN)) {
  throw new Error("COOKIE_SECURE must be true when running VideoCAT in production outside localhost.");
}
