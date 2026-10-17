import { type CSSProperties, type ReactNode, useCallback, useEffect, useState } from "react";
import { ArrowRight, Plus, Star, Tag, Trash2 } from "lucide-react";
import { formatBytes } from "@videocat/shared";
import { api } from "../lib/api";
import { formatCount } from "../lib/app-helpers";
import { transferError } from "../lib/transfers";
import type { TransferDestination } from "../types";

type Category = { key: string; label: string; color: string };

type TagRule = {
  id: string;
  category: Category;
  destination: { id: string; diskId: string; diskName: string; path: string };
  taggedFiles: number;
  taggedBytes: number;
  onTheirWay: number;
  moved: number;
};

type TagRulesSectionProps = {
  destinations: TransferDestination[] | null;
  refreshKey: number;
  jobs: ReactNode;
  onChanged: () => void;
};

// "Mover por etiqueta": a standing rule; every video with the tag goes to the starred folder,
// the ones tagged later too, as soon as their drive is connected.
export function TagRulesSection({ destinations, refreshKey, jobs, onChanged }: TagRulesSectionProps) {
  const [rules, setRules] = useState<TagRule[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryKey, setCategoryKey] = useState("");
  const [destinationId, setDestinationId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const [ruleResponse, categoryResponse] = await Promise.all([
        api<{ rules: TagRule[] }>("/api/transfers/tag-rules"),
        api<{ categories: Category[] }>("/api/categories")
      ]);
      setRules(ruleResponse.rules);
      setCategories(categoryResponse.categories.filter((category) => category.key !== "delete"));
    } catch (reason) {
      setError(transferError(reason, "No se pudieron cargar las reglas por etiqueta."));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const usedKeys = new Set(rules?.map((rule) => rule.category.key) ?? []);
  const freeCategories = categories.filter((category) => !usedKeys.has(category.key));

  async function create() {
    if (!categoryKey || !destinationId) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api<{ added: number }>("/api/transfers/tag-rules", { method: "POST", body: JSON.stringify({ categoryKey, destinationId }) });
      setNotice(result.added > 0
        ? `Regla creada: ${result.added} ${result.added === 1 ? "video ya está" : "videos ya están"} en camino.`
        : "Regla creada. Los videos con esa etiqueta se moverán cuando se conecte su disco.");
      setCategoryKey("");
      await load();
      onChanged();
    } catch (reason) {
      setError(transferError(reason, "No se pudo crear la regla."));
    } finally {
      setBusy(false);
    }
  }

  async function remove(rule: TagRule) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api<{ withdrawn: number }>(`/api/transfers/tag-rules/${rule.id}`, { method: "DELETE" });
      setNotice(result.withdrawn > 0
        ? `Regla quitada: ${result.withdrawn} ${result.withdrawn === 1 ? "video que aún no salía de su disco se queda" : "videos que aún no salían de su disco se quedan"} donde están.`
        : "Regla quitada.");
      await load();
      onChanged();
    } catch (reason) {
      setError(transferError(reason, "No se pudo quitar la regla."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="vc-panel vc-transfers-kind vc-accent-bar is-tag" aria-label="Mover por etiqueta">
      <header className="vc-transfers-kind-head">
        <span className="vc-kind-icon" aria-hidden="true"><Tag size={20} /></span>
        <div>
          <h3>Mover por etiqueta</h3>
          <p>Elige una etiqueta y una carpeta con estrella: todos los videos con esa etiqueta, también los que la reciban después, van a esa carpeta cuando se conecta su disco. Si a un video le quitas la etiqueta antes de que salga de su disco, se queda donde está.</p>
        </div>
      </header>

      {destinations && destinations.length === 0 ? (
        <p className="vc-transfers-detail">Primero marca una carpeta con estrella (en Uso por carpeta o en Agrupar archivos).</p>
      ) : (
        <div className="vc-tag-rule-form">
          <label className="vc-field">
            <span>Etiqueta</span>
            <select value={categoryKey} onChange={(event) => setCategoryKey(event.target.value)} aria-label="Etiqueta para mover">
              <option value="">Elige una etiqueta</option>
              {freeCategories.map((category) => <option key={category.key} value={category.key}>{category.label}</option>)}
            </select>
          </label>
          <ArrowRight size={16} aria-hidden="true" className="vc-tag-rule-arrow" />
          <label className="vc-field">
            <span>Carpeta con estrella</span>
            <select value={destinationId} onChange={(event) => setDestinationId(event.target.value)} aria-label="Carpeta destino de la etiqueta">
              <option value="">Elige una carpeta</option>
              {(destinations ?? []).map((destination) => (
                <option key={destination.id} value={destination.id}>{`${destination.diskName} › ${destination.path}`}</option>
              ))}
            </select>
          </label>
          <button className="vc-button is-primary" disabled={busy || !categoryKey || !destinationId} onClick={() => void create()} type="button">
            <Plus size={15} /> Crear regla
          </button>
        </div>
      )}

      {error ? <div className="form-error" role="alert">{error}</div> : null}
      {notice ? <div className="vc-notice" role="status">{notice}</div> : null}

      {rules === null ? <div className="loading">Cargando...</div> : rules.length === 0 ? (
        <p className="vc-folders-empty">Sin reglas por etiqueta todavía.</p>
      ) : (
        <ul className="vc-tag-rules">
          {rules.map((rule) => (
            <li key={rule.id}>
              <span className="vc-tag-rule-tag" style={{ "--tag-color": rule.category.color } as CSSProperties}>
                <i aria-hidden="true" />{rule.category.label}
              </span>
              <ArrowRight size={14} aria-hidden="true" />
              <span className="vc-tag-rule-target" title={rule.destination.path}>
                <Star size={12} aria-hidden="true" className="vc-star-icon" />
                {`${rule.destination.diskName} › ${rule.destination.path}`}
              </span>
              <span className="vc-tag-rule-stats">
                {`${formatCount(rule.taggedFiles)} con la etiqueta · ${formatBytes(rule.taggedBytes)} · ${formatCount(rule.onTheirWay)} en camino · ${formatCount(rule.moved)} movidos`}
              </span>
              <button className="icon-button" disabled={busy} onClick={() => void remove(rule)} type="button" title="Quitar regla">
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <h4 className="vc-transfers-kind-subtitle">Movimientos por etiqueta</h4>
      {jobs}
    </section>
  );
}
