import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const identityFileName = "companion-identity.json";
const identitySchemaVersion = 1;

type StoredCompanionIdentity = {
  schemaVersion: typeof identitySchemaVersion;
  companionId: string;
  createdAt: string;
};

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function identityPath(stateRoot: string): string {
  return path.join(stateRoot, identityFileName);
}

async function readIdentity(target: string): Promise<string | null> {
  try {
    const value = JSON.parse(await fs.readFile(target, "utf8")) as Partial<StoredCompanionIdentity>;
    return value.schemaVersion === identitySchemaVersion && isUuid(value.companionId) ? value.companionId : null;
  } catch {
    return null;
  }
}

export async function loadOrCreateCompanionIdentity(stateRoot: string): Promise<string> {
  const target = identityPath(stateRoot);
  const existing = await readIdentity(target);
  if (existing) return existing;

  await fs.mkdir(stateRoot, { recursive: true });
  const identity: StoredCompanionIdentity = {
    schemaVersion: identitySchemaVersion,
    companionId: crypto.randomUUID(),
    createdAt: new Date().toISOString()
  };
  const temporary = `${target}.${process.pid}.tmp`;

  try {
    await fs.writeFile(temporary, `${JSON.stringify(identity, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await fs.rename(temporary, target);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
    const concurrent = await readIdentity(target);
    if (concurrent) return concurrent;
    throw error;
  }

  return identity.companionId;
}

