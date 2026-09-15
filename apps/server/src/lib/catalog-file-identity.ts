export function catalogFileIdentityChanged(
  existing: { sizeBytes: bigint; modifiedAt: Date | null },
  incoming: { sizeBytes: number; modifiedAt: Date | null }
): boolean {
  return existing.sizeBytes !== BigInt(incoming.sizeBytes)
    || (existing.modifiedAt?.getTime() ?? null) !== (incoming.modifiedAt?.getTime() ?? null);
}
