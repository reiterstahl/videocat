import { useState } from "react";
import { Check, Plus, Tags, X } from "lucide-react";
import { api } from "../lib/api";
import { transferError } from "../lib/transfers";

type GroupKeywordsEditorProps = {
  destinationId: string;
  keywords: string[];
  onSaved: (keywords: string[]) => void;
};

const maxKeywords = 20;

// Optional extra words that "Agrupar archivos" looks for besides the folder name.
export function GroupKeywordsEditor({ destinationId, keywords, onSaved }: GroupKeywordsEditorProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>(keywords);
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function start() {
    setDraft(keywords);
    setInput("");
    setError("");
    setEditing(true);
  }

  function add() {
    const words = input.split(",").map((word) => word.trim()).filter(Boolean);
    if (words.length === 0) return;
    setDraft((current) => [...current, ...words.filter((word) => !current.some((existing) => existing.toLowerCase() === word.toLowerCase()))].slice(0, maxKeywords));
    setInput("");
  }

  async function save() {
    const pending = input.trim() ? [...draft, ...input.split(",").map((word) => word.trim()).filter(Boolean)] : draft;
    setSaving(true);
    setError("");
    try {
      const response = await api<{ keywords: string[] }>(`/api/transfers/destinations/${destinationId}/keywords`, {
        method: "PUT",
        body: JSON.stringify({ keywords: pending.slice(0, maxKeywords) })
      });
      onSaved(response.keywords);
      setEditing(false);
    } catch (reason) {
      setError(transferError(reason, "No se pudieron guardar las palabras clave."));
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div className="vc-keywords">
        <span className="vc-keywords-label"><Tags size={13} aria-hidden="true" /> Palabras clave</span>
        {keywords.length > 0 ? (
          <ul className="vc-keywords-list">
            {keywords.map((keyword) => <li key={keyword}>{keyword}</li>)}
          </ul>
        ) : (
          <span className="vc-keywords-empty">Solo el nombre de la carpeta</span>
        )}
        <button className="vc-link-button" onClick={start} type="button">{keywords.length > 0 ? "Editar" : "Agregar"}</button>
      </div>
    );
  }

  return (
    <div className="vc-keywords is-editing">
      <span className="vc-keywords-label"><Tags size={13} aria-hidden="true" /> Palabras clave</span>
      <p className="vc-keywords-hint">Agrupar archivos también busca estas palabras, pero exactas: como palabra completa del nombre del archivo, sin importar mayúsculas, acentos, puntos ni separadores (GATO, gato, .gato. o mi_gato_2024 sí; gatos, gatito o gatoo no). El nombre de la carpeta sigue con la búsqueda amplia. Son opcionales.</p>
      {draft.length > 0 ? (
        <ul className="vc-keywords-list">
          {draft.map((keyword) => (
            <li key={keyword}>
              {keyword}
              <button onClick={() => setDraft((current) => current.filter((word) => word !== keyword))} type="button" aria-label={`Quitar ${keyword}`} title="Quitar">
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="vc-keywords-input">
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
          placeholder="Ej. prueba final, sesión 2"
          aria-label="Nueva palabra clave"
          maxLength={100}
          disabled={draft.length >= maxKeywords}
        />
        <button className="vc-button is-small" onClick={add} disabled={!input.trim() || draft.length >= maxKeywords} type="button"><Plus size={14} /> Agregar</button>
      </div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="vc-folders-actions">
        <button className="vc-button is-small is-primary" onClick={() => void save()} disabled={saving} type="button"><Check size={14} /> Guardar</button>
        <button className="vc-button is-small is-ghost" onClick={() => setEditing(false)} disabled={saving} type="button">Cancelar</button>
      </div>
    </div>
  );
}
