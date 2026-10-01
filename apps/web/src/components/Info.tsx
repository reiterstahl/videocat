import { Copy, FileVideo, FolderOpen } from "lucide-react";

export function Info({
  label,
  value,
  copy = false,
  openKind = "folder",
  openBusy = false,
  onOpen
}: {
  label: string;
  value: string;
  copy?: boolean;
  openKind?: "file" | "folder";
  openBusy?: boolean;
  onOpen?: () => void;
}) {
  return (
    <div className="info-row">
      <span>{label}</span>
      <strong>{value}</strong>
      {onOpen ? (
        <button
          className="open-button"
          disabled={openBusy}
          onClick={onOpen}
          type="button"
          title={openKind === "file" ? "Intentar abrir archivo local" : "Intentar abrir carpeta local"}
        >
          {openKind === "file" ? <FileVideo size={15} /> : <FolderOpen size={15} />}
        </button>
      ) : null}
      {copy ? (
        <button className="copy-button" onClick={() => void navigator.clipboard.writeText(value)} title="Copiar">
          <Copy size={15} />
        </button>
      ) : null}
    </div>
  );
}
