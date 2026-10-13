import { formatBytes } from "@videocat/shared";
import type { TransferNeed, TransferState } from "../types";

export const transferStateLabels: Record<TransferState, string> = {
  pending: "Esperando el disco de origen",
  staging: "Copiando a la carpeta temporal",
  staged: "Verificado en la carpeta temporal",
  source_removed: "Esperando el disco de destino",
  blocked_space: "Sin espacio en el destino",
  delivering: "Copiando al destino",
  delivered: "Verificado en el destino",
  done: "Listo",
  duplicate: "Ya estaba en el destino",
  cancelled: "Cancelado"
};

// Short form for badges on catalog cards.
export const transferBadgeLabels: Partial<Record<TransferState, string>> = {
  pending: "Por trasladar",
  blocked_space: "Sin espacio"
};

export function driveName(need: Pick<TransferNeed, "diskName" | "driveLetter">): string {
  return need.driveLetter ? `${need.diskName} (${need.driveLetter})` : need.diskName;
}

export function needTitle(need: TransferNeed): string {
  const name = driveName(need);
  if (need.kind === "free_space") return `Libera espacio en ${name}`;
  if (need.kind === "space_short") return `Faltará espacio en ${name}`;
  if (need.connected) return need.kind === "connect_target" ? `${name} conectado: entregando archivos` : `${name} conectado: copiando archivos`;
  return `Conecta ${name} para continuar`;
}

export function needDetail(need: TransferNeed): string {
  const amount = `${need.files} ${need.files === 1 ? "archivo" : "archivos"} · ${formatBytes(need.bytes)}`;
  if (need.kind === "free_space") return `${amount} esperando en la carpeta temporal. Borra o mueve contenido de ese disco desde Review o Duplicados.`;
  if (need.kind === "space_short") return `${amount} van hacia este disco y, según su último escaneo, faltan ${formatBytes(need.shortBytes ?? 0)}. Igual salen de su disco y esperan en la carpeta temporal; llegan cuando liberes espacio.`;
  if (need.kind === "connect_target") return `${amount} esperando en la carpeta temporal del Companion.`;
  return `${amount} por copiar desde este disco.`;
}

// Free space the Companion always leaves on the staging drive.
export const stagingReserveRatio = 0.05;

// Server messages about transfers, shown in Spanish (the page translator turns them into English).
const transferMessages: Record<string, string> = {
  "That file is already in this folder": "Ese archivo ya está en esta carpeta.",
  "That file is already in another transfer": "Ese archivo ya está en otro traslado.",
  "An identical file is already in this folder; it stays for review in Duplicates": "Ya hay un archivo idéntico en esta carpeta; se queda para revisar en Duplicados.",
  "Nothing to move": "Nada que mover.",
  "Not enough free space on the destination drive": "No hay espacio suficiente en el disco de destino.",
  "Scan the destination drive first so its free space is known": "Escanea primero el disco de destino para conocer su espacio libre.",
  "The Companion already started moving this file; it will finish its way to the folder": "El Companion ya empezó a mover este archivo; terminará su camino hasta la carpeta.",
  "That file is not in a grouping transfer": "Ese archivo no está en un traslado para agrupar.",
  "This destination still has files on their way": "Esta carpeta todavía tiene archivos en camino.",
  "That folder has no catalogued videos on this disk": "Esa carpeta no tiene videos catalogados en este disco.",
  "Some files were added to another transfer at the same time": "Algunos archivos se agregaron a otro traslado al mismo tiempo.",
  "Keywords need at least 3 letters or numbers": "Cada palabra clave necesita al menos 3 letras o números.",
  "That file is in a favorite folder and never moves": "Ese archivo está en una carpeta favorita y nunca se mueve."
};

export function transferError(reason: unknown, fallback: string): string {
  if (!(reason instanceof Error)) return fallback;
  return transferMessages[reason.message] ?? reason.message;
}
