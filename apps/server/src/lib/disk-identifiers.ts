import type { Prisma } from "@prisma/client";
import { z } from "zod";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Companions identify a drive by its marker UUID, but folders added by hand in older tray
// builds carry ids like "target-lx2k9-4f8a" (and the CLI accepts any --disk-id). They are
// stored as Disk.volumeId, so the API accepts any short, path-safe identifier.
export const agentDiskIdentifierSchema = z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);

export function isUuid(value: string): boolean {
  return uuidPattern.test(value);
}

// Disk.id is a UUID column: comparing it with any other string makes PostgreSQL reject the query.
export function disksByAgentIdentifiers(identifiers: string[]): Prisma.DiskWhereInput {
  const uuids = identifiers.filter(isUuid);
  return {
    OR: [
      ...(uuids.length > 0 ? [{ id: { in: uuids } }] : []),
      { volumeId: { in: identifiers } }
    ]
  };
}
