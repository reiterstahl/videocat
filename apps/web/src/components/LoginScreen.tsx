import { useState, type FormEvent } from "react";
import { AlertCircle, Eye, EyeOff, Lock, Moon, Shield, Sun } from "lucide-react";
import type { Language } from "../i18n";
import { webVersion } from "../lib/app-config";

type LoginScreenProps = {
  username: string;
  password: string;
  error: string;
  theme: string;
  language: Language;
  onUsernameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: () => Promise<void>;
  onToggleTheme: () => void;
  onLanguageChange: (language: Language) => void;
};

// Decorative contact sheet: abstract frames (sky, ground, sun) with timecodes, never real thumbnails,
// since nothing of the catalog may show before signing in.
const frames = [
  ["#2f3a46", "#1c242c", "#e9b872", "72%"], ["#3d2f2a", "#241b17", "#f08c5a", "18%"], ["#24352f", "#15211c", "#d9e3c4", "58%"], ["#33303f", "#1d1b26", "#c7b8f0", "34%"],
  ["#41372a", "#2a2219", "#ffd18a", "64%"], ["#22303d", "#141d26", "#9cc4e6", "12%"], ["#3a2c33", "#22191e", "#f2a7b8", "46%"], ["#2c3830", "#18221b", "#e6d38f", "80%"],
  ["#302d28", "#1b1915", "#f3c27a", "28%"], ["#263240", "#162029", "#b6d4f0", "66%"], ["#3b3226", "#231d15", "#ffb36b", "40%"], ["#2a2f38", "#181c22", "#d6dbe4", "22%"],
  ["#2d3b36", "#18241f", "#cfe0b0", "54%"], ["#3c2d38", "#231a21", "#f0b2c9", "76%"], ["#283444", "#16202b", "#a9cbef", "30%"], ["#3e3427", "#251f16", "#ffc27d", "62%"]
].map(([fill, ground, sun, sunX], index) => ({
  fill,
  ground,
  sun,
  sunX,
  horizon: `${34 + (index % 3) * 9}%`,
  time: ["00:12:41", "01:03:09", "00:04:55", "00:27:18", "00:51:02", "00:09:36", "01:15:44", "00:33:20", "00:02:17", "00:46:58", "00:18:05", "00:58:31", "00:07:49", "01:22:13", "00:39:02", "00:14:26"][index],
  tag: index === 2 || index === 15 ? "F · Mantener" : index === 9 ? "Duplicado" : null
}));

const drives = [
  { name: "LaCie Rugged", meta: "F: · 4.5 TB", connected: true },
  { name: "Archive 02", meta: "H: · 5.5 TB", connected: true },
  { name: "WD Elements", meta: "931 GB", connected: false },
  { name: "Samsung T7", meta: "1 TB", connected: false }
];

// Server answers in English; the page translator turns these Spanish texts into English when needed.
const loginMessages: Record<string, string> = {
  "Invalid username or password": "Usuario o contraseña incorrectos.",
  "Too many login attempts. Try again later.": "Demasiados intentos. Espera unos minutos y vuelve a intentarlo."
};

export function LoginScreen({
  username,
  password,
  error,
  theme,
  language,
  onUsernameChange,
  onPasswordChange,
  onSubmit,
  onToggleTheme,
  onLanguageChange
}: LoginScreenProps) {
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [missing, setMissing] = useState(false);
  const dark = theme === "dark";
  const message = missing ? "Escribe tu usuario y tu contraseña." : error ? (loginMessages[error] ?? error) : "";

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!username.trim() || !password) {
      setMissing(true);
      return;
    }
    setMissing(false);
    setBusy(true);
    try {
      await onSubmit();
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="vc-login">
      <section className="vc-login-showcase" aria-hidden="true">
        <div className="vc-login-overline">
          <span />
          Catálogo de video self-hosted
        </div>
        <div className="vc-login-sheet">
          {frames.map((frame, index) => (
            <div key={index} className="vc-login-frame" style={{ background: frame.fill }}>
              <i style={{ height: frame.horizon, background: frame.ground }} />
              <b style={{ left: frame.sunX, background: frame.sun }} />
              <small>{frame.time}</small>
              {frame.tag ? <em>{frame.tag}</em> : null}
            </div>
          ))}
        </div>
        <div className="vc-login-drives">
          {drives.map((drive) => (
            <span key={drive.name} className="vc-login-drive">
              <i className={drive.connected ? "is-connected" : ""} />
              <strong>{drive.name}</strong>
              <small>{drive.meta}</small>
            </span>
          ))}
        </div>
      </section>

      <section className="vc-login-panel" aria-label="Iniciar sesión">
        <div className="vc-login-tools">
          <div className="vc-login-language" role="group" aria-label="Idioma">
            <button type="button" aria-pressed={language === "es"} onClick={() => onLanguageChange("es")}>ES</button>
            <button type="button" aria-pressed={language === "en"} onClick={() => onLanguageChange("en")}>EN</button>
          </div>
          <button
            className="vc-login-theme"
            type="button"
            onClick={onToggleTheme}
            title={dark ? "Cambiar a tema claro" : "Cambiar a tema oscuro"}
            aria-label={dark ? "Cambiar a tema claro" : "Cambiar a tema oscuro"}
          >
            {dark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>

        <div className="vc-login-body">
          <div className="vc-login-brand">
            <span className="vc-catmark" aria-hidden="true" />
            <span className="vc-login-word">Video<span>CAT</span></span>
          </div>

          <div className="vc-login-heading">
            <h1>Inicia sesión</h1>
            <p>Usa la cuenta de administrador definida en el .env de tu servidor.</p>
          </div>

          <form className="vc-login-form" onSubmit={(event) => void submit(event)} noValidate>
            <label className="vc-login-field">
              <span>Usuario</span>
              <input
                value={username}
                onChange={(event) => {
                  setMissing(false);
                  onUsernameChange(event.target.value);
                }}
                autoComplete="username"
                aria-invalid={message ? true : undefined}
                placeholder="admin"
              />
            </label>
            <label className="vc-login-field">
              <span>Contraseña</span>
              <span className="vc-login-password">
                <input
                  value={password}
                  onChange={(event) => {
                    setMissing(false);
                    onPasswordChange(event.target.value);
                  }}
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  aria-invalid={message ? true : undefined}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  title={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                  aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </span>
            </label>

            {message ? (
              <div className="vc-login-error" role="alert">
                <AlertCircle size={18} aria-hidden="true" />
                <span>{message}</span>
              </div>
            ) : null}

            <button className="vc-login-submit" type="submit" disabled={busy}>
              <Shield size={18} aria-hidden="true" />
              {busy ? "Entrando…" : "Entrar"}
            </button>
          </form>

          <p className="vc-login-privacy">
            <Lock size={15} aria-hidden="true" />
            Tu catálogo se queda en este servidor.
          </p>
        </div>

        <footer className="vc-login-footer">
          <span>{`VideoCAT ${webVersion} · AGPL-3.0`}</span>
          <a href="https://github.com/reiterstahl/videocat" target="_blank" rel="noreferrer">GitHub</a>
        </footer>
      </section>
    </main>
  );
}
