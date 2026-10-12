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
  if (need.connected) return need.kind === "connect_target" ? `${name} conectado: entregando archivos` : `${name} conectado: copiando archivos`;
  return `Conecta ${name} para continuar`;
}

export function needDetail(need: TransferNeed): string {
  const amount = `${need.files} ${need.files === 1 ? "archivo" : "archivos"} · ${formatBytes(need.bytes)}`;
  if (need.kind === "free_space") return `${amount} esperando en la carpeta temporal. Borra o mueve contenido de ese disco desde Review o Duplicados.`;
  if (need.kind === "connect_target") return `${amount} esperando en la carpeta temporal del Companion.`;
  return `${amount} por copiar desde este disco.`;
}

// Free space the Companion always leaves on the staging drive.
export const stagingReserveRatio = 0.05;
