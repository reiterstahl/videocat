import { useEffect, useState, type FormEvent } from "react";
import { Cast, KeyRound, Lock, Palette, Shield } from "lucide-react";
import { InstallAppPanel } from "../components/InstallApp";
import { ThemeControls } from "../components/ThemeControls";
import type { Language } from "../i18n";
import { api } from "../lib/api";
import type { ProfileSecurityResponse } from "../lib/app-types";
import type { ResolvedAppearance, ThemePreferences } from "../lib/theme";

type ProfileViewProps = {
  security: ProfileSecurityResponse | null;
  onSecuritySaved: (security: ProfileSecurityResponse) => void;
  themePreferences: ThemePreferences;
  resolvedAppearance: ResolvedAppearance;
  onThemeChange: (changes: Partial<ThemePreferences>) => void;
  language: Language;
  onLanguageChange: (language: Language) => void;
};

const companionTokenKey = "videocat-companion-token";

function parsePatterns(text: string): string[] {
  const seen = new Set<string>();
  return text
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => {
      const normalized = item.toLowerCase();
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    })
    .slice(0, 50);
}

function readStoredToken(): boolean {
  try {
    return Boolean(localStorage.getItem(companionTokenKey));
  } catch {
    return false;
  }
}

export function ProfileView({
  security,
  onSecuritySaved,
  themePreferences,
  resolvedAppearance,
  onThemeChange,
  language,
  onLanguageChange
}: ProfileViewProps) {
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [patternsText, setPatternsText] = useState("");
  const [chromecastEnabled, setChromecastEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [tokenSaved, setTokenSaved] = useState(readStoredToken);

  useEffect(() => {
    if (!security) return;
    setPatternsText(security.protectedFolderPatterns.join("\n"));
    setChromecastEnabled(security.chromecastEnabled);
  }, [security]);

  async function saveSecurity(event: FormEvent) {
    event.preventDefault();
    const nextPin = newPin.trim();
    if (nextPin && !/^\d{4}$/.test(nextPin)) {
      setError("El nuevo PIN debe tener 4 dígitos.");
      return;
    }
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const response = await api<ProfileSecurityResponse>("/api/profile/security", {
        method: "PATCH",
        body: JSON.stringify({
          currentPin: currentPin.trim(),
          newPin: nextPin,
          protectedFolderPatterns: parsePatterns(patternsText),
          chromecastEnabled
        })
      });
      setCurrentPin("");
      setNewPin("");
      setMessage("Perfil actualizado.");
      onSecuritySaved(response);
    } catch (reason) {
      const text = reason instanceof Error ? reason.message : "No se pudo guardar el perfil.";
      setError(text === "Current PIN is incorrect" ? "PIN actual incorrecto." : text);
    } finally {
      setSaving(false);
    }
  }

  function saveToken() {
    const token = tokenInput.trim();
    if (!token) return;
    try {
      localStorage.setItem(companionTokenKey, token);
      setTokenInput("");
      setTokenSaved(true);
      setMessage("Token del Companion guardado en este navegador.");
    } catch {
      setError("Este navegador no permite guardar el token.");
    }
  }

  function clearToken() {
    try {
      localStorage.removeItem(companionTokenKey);
    } catch {
      // Nothing stored when storage is unavailable.
    }
    setTokenSaved(false);
    setMessage("Token del Companion quitado de este navegador.");
  }

  return (
    <section className="vc-view vc-profile" aria-label="Perfil">
      {message ? <div className="vc-notice" role="status">{message}</div> : null}
      {error ? <div className="form-error">{error}</div> : null}

      <form className="vc-profile-grid" onSubmit={saveSecurity}>
        <section className="vc-panel" aria-labelledby="profile-security-title">
          <div className="vc-panel-head">
            <div>
              <h2 id="profile-security-title"><Lock size={16} aria-hidden="true" /> Seguridad</h2>
              <p>El PIN desbloquea las carpetas protegidas en esta sesión.</p>
            </div>
            <span className={`vc-badge ${security?.hasPin ? "is-success" : "is-warning"}`}>
              {security?.hasPin ? "PIN configurado" : "PIN no configurado"}
            </span>
          </div>
          <div className="vc-panel-body">
            <div className="vc-field-row">
              <label className="vc-field">
                <span>PIN actual</span>
                <input
                  value={currentPin}
                  onChange={(event) => setCurrentPin(event.target.value.replace(/\D/g, "").slice(0, 4))}
                  inputMode="numeric"
                  autoComplete="current-password"
                  placeholder="0000"
                  type="password"
                />
              </label>
              <label className="vc-field">
                <span>Nuevo PIN</span>
                <input
                  value={newPin}
                  onChange={(event) => setNewPin(event.target.value.replace(/\D/g, "").slice(0, 4))}
                  inputMode="numeric"
                  autoComplete="new-password"
                  placeholder="0000"
                  type="password"
                />
              </label>
            </div>
            <label className="vc-field">
              <span>Patrones protegidos</span>
              <textarea value={patternsText} onChange={(event) => setPatternsText(event.target.value)} rows={5} placeholder={"Private\nProtected"} />
              <small>Uno por línea o separados por coma. Se ocultan las carpetas cuyo nombre contenga alguno de estos textos.</small>
            </label>
          </div>
        </section>

        <section className="vc-panel" aria-labelledby="profile-playback-title">
          <div className="vc-panel-head">
            <div>
              <h2 id="profile-playback-title"><Cast size={16} aria-hidden="true" /> Reproducción</h2>
              <p>Opciones para enviar videos a otros dispositivos.</p>
            </div>
          </div>
          <div className="vc-panel-body">
            <label className="vc-toggle-row">
              <input checked={chromecastEnabled} onChange={(event) => setChromecastEnabled(event.target.checked)} type="checkbox" />
              <span>
                <strong>Permitir reproducción en Chromecast</strong>
                <small>VideoCAT genera enlaces temporales para que un Chromecast pida el video a tu servidor. Google Cast solo se carga cuando usas esta función.</small>
              </span>
            </label>
          </div>
        </section>

        <div className="vc-profile-save">
          <span>El PIN, los patrones y la reproducción se guardan en el servidor.</span>
          <button className="vc-button is-primary" disabled={saving || !security} type="submit">
            <Shield size={16} />
            {saving ? "Guardando..." : "Guardar cambios"}
          </button>
        </div>
      </form>

      <div className="vc-profile-grid">
        <section className="vc-panel" aria-labelledby="profile-token-title">
          <div className="vc-panel-head">
            <div>
              <h2 id="profile-token-title"><KeyRound size={16} aria-hidden="true" /> Companion local</h2>
              <p>Abrir, copiar y borrar archivos en esta PC requiere el token del Companion.</p>
            </div>
            <span className={`vc-badge ${tokenSaved ? "is-success" : "is-warning"}`}>
              {tokenSaved ? "Token guardado en este navegador" : "Sin token en este navegador"}
            </span>
          </div>
          <div className="vc-panel-body">
            <p className="vc-help">Cópialo desde la bandeja de Windows (Configuración › Token del navegador) y pégalo aquí. Se guarda solo en este navegador.</p>
            <div className="vc-token-row">
              <label className="vc-visually-hidden" htmlFor="companion-token-input">Token del Companion</label>
              <input
                id="companion-token-input"
                value={tokenInput}
                onChange={(event) => setTokenInput(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                placeholder="Pega el token del Companion"
                type="password"
              />
              <button className="vc-button is-primary" disabled={!tokenInput.trim()} onClick={saveToken} type="button">Guardar token</button>
              {tokenSaved ? <button className="vc-button" onClick={clearToken} type="button">Quitar</button> : null}
            </div>
          </div>
        </section>

        <InstallAppPanel />

        <section className="vc-panel" aria-labelledby="profile-appearance-title">
          <div className="vc-panel-head">
            <div>
              <h2 id="profile-appearance-title"><Palette size={16} aria-hidden="true" /> Apariencia e idioma</h2>
              <p>Se guarda en este navegador. «Sistema» sigue la preferencia del dispositivo.</p>
            </div>
          </div>
          <div className="vc-panel-body vc-profile-theme">
            <ThemeControls
              preferences={themePreferences}
              resolvedAppearance={resolvedAppearance}
              onChange={onThemeChange}
              language={language}
              onLanguageChange={onLanguageChange}
            />
          </div>
        </section>
      </div>
    </section>
  );
}
