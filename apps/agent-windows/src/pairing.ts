import os from "node:os";
import path from "node:path";
import { tl } from "./agent-language.js";
import { normalizeConfig, normalizeServerUrl, validateConfig } from "./config-store.js";
import { loadOrCreateCompanionIdentity } from "./identity.js";

// Pairing with a one-time code from Administración › Companions. The agent makes the call and
// hands the credential to the tray, which encrypts it with Windows' protection and keeps it; the
// agent never writes it to disk.

export type PairingResult =
  | { ok: true; companionId: string; serverUrl: string; issuedAt: string; credential: string }
  | { ok: false; message: string };

export async function pairWithServer(input: { code: string; values: Record<string, string>; defaultStateRoot: string; version: number }): Promise<PairingResult> {
  try {
    const normalized = normalizeConfig(input.values);
    const validationError = validateConfig(normalized, { allowMissingCredential: true });
    if (validationError) return { ok: false, message: validationError };
    const serverUrl = normalizeServerUrl(normalized.SERVER_URL);
    const companionId = await loadOrCreateCompanionIdentity(
      normalized.AGENT_STATE_DIR ? path.resolve(normalized.AGENT_STATE_DIR) : input.defaultStateRoot
    );
    const response = await fetch(`${serverUrl}/api/agent/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: input.code,
        companionId,
        companionName: normalized.COMPANION_NAME || os.hostname(),
        version: input.version
      }),
      signal: AbortSignal.timeout(20_000)
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { message?: string } | null;
      return { ok: false, message: body?.message ?? tl("El servidor rechazo el emparejamiento ({status}).", { status: response.status }) };
    }
    const body = await response.json() as { credential?: string; issuedAt?: string };
    if (!body.credential || !body.issuedAt) return { ok: false, message: tl("El servidor devolvio una respuesta de emparejamiento incompleta.") };
    return { ok: true, companionId, serverUrl, issuedAt: body.issuedAt, credential: body.credential };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}
