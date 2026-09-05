import { Prisma } from "@prisma/client";
import { env } from "./env.js";
import { constantTimeStringEqual, hashPin, verifyHashedPin } from "./pin-security.js";
import { prisma } from "./prisma.js";

const pinHashKey = "protected_folder_pin_hash";
const patternsKey = "protected_folder_patterns";

type SettingRow = {
  value: string;
};

let patternsCache: { value: string[]; expiresAt: number } | null = null;

function envPatterns(): string[] {
  return normalizeProtectedPatterns(env.PROTECTED_FOLDER_PATTERNS.split(","));
}

async function getSetting(key: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<SettingRow[]>(Prisma.sql`
    SELECT "value"
    FROM "AppSetting"
    WHERE "key" = ${key}
    LIMIT 1
  `);
  return rows[0]?.value ?? null;
}

async function setSetting(key: string, value: string): Promise<void> {
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "AppSetting" ("key", "value", "createdAt", "updatedAt")
    VALUES (${key}, ${value}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT ("key") DO UPDATE
    SET "value" = EXCLUDED."value",
        "updatedAt" = CURRENT_TIMESTAMP
  `);
}

export function normalizeProtectedPatterns(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const normalized = trimmed.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(trimmed.slice(0, 80));
  }
  return result.slice(0, 50);
}

export function clearProtectedSettingsCache(): void {
  patternsCache = null;
}

export async function protectedFolderPatterns(): Promise<string[]> {
  if (patternsCache && patternsCache.expiresAt > Date.now()) return patternsCache.value;
  const stored = await getSetting(patternsKey);
  let value = envPatterns();
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      value = Array.isArray(parsed) ? normalizeProtectedPatterns(parsed) : value;
    } catch {
      value = envPatterns();
    }
  }
  patternsCache = { value, expiresAt: Date.now() + 10_000 };
  return value;
}

export async function isValidProtectedFolderPin(pin: string): Promise<boolean> {
  const storedHash = await getSetting(pinHashKey);
  if (storedHash) return verifyHashedPin(pin, storedHash);
  return constantTimeStringEqual(pin, env.PROTECTED_FOLDER_PIN);
}

export async function protectedSecurityProfile(): Promise<{ hasPin: boolean; protectedFolderPatterns: string[] }> {
  const storedHash = await getSetting(pinHashKey);
  return {
    hasPin: Boolean(storedHash || env.PROTECTED_FOLDER_PIN),
    protectedFolderPatterns: await protectedFolderPatterns()
  };
}

export async function updateProtectedSecurityProfile(input: {
  currentPin?: string;
  newPin?: string;
  protectedFolderPatterns: string[];
}): Promise<{ hasPin: boolean; protectedFolderPatterns: string[] }> {
  const storedHash = await getSetting(pinHashKey);
  if (input.newPin) {
    if (storedHash && (!input.currentPin || !verifyHashedPin(input.currentPin, storedHash))) {
      throw Object.assign(new Error("Current PIN is incorrect"), { statusCode: 403 });
    }
    await setSetting(pinHashKey, hashPin(input.newPin));
  }

  const normalizedPatterns = normalizeProtectedPatterns(input.protectedFolderPatterns);
  await setSetting(patternsKey, JSON.stringify(normalizedPatterns));
  clearProtectedSettingsCache();
  return protectedSecurityProfile();
}
