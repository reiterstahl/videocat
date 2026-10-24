import { trayLocalizerScript, type TrayLanguage } from "./tray-i18n.js";

// The Companion's two windows (settings and activity) as self-contained pages. Their texts are
// written in Spanish and shown in the chosen language by trayLocalizerScript (tray-i18n.ts).

export function configHtml(logoDataUrl: string, version: string, language: TrayLanguage): string {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>VideoCAT Companion v${version}</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f3f4f6; --surface: #ffffff; --sunken: #f6f7f9; --hover: #eef0f3;
      --border: #e2e5e9; --border-strong: #cdd2d8; --text: #14181c; --text-soft: #2b333b; --muted: #5b6670;
      --accent: #fc6121; --accent-strong: #c2410c; --accent-soft: #fff0e8; --accent-ink: #8a2e07;
      --success: #15803d; --success-soft: #e7f6ec; --danger: #b91c1c; --danger-soft: #fdecec;
      --shadow: 0 1px 2px rgba(16, 24, 32, 0.05), 0 10px 28px rgba(16, 24, 32, 0.06);
    }
    @media (prefers-color-scheme: dark) {
      :root {
        color-scheme: dark;
        --bg: #0d0f12; --surface: #15181c; --sunken: #111418; --hover: #1f242a;
        --border: #252a30; --border-strong: #363d45; --text: #e8ecef; --text-soft: #cfd6dc; --muted: #9aa5ae;
        --accent-soft: #3a1d10; --accent-ink: #ffb08a;
        --success: #4ade80; --success-soft: #11291b; --danger: #f87171; --danger-soft: #2c1414;
        --shadow: 0 10px 28px rgba(0, 0, 0, 0.4);
      }
    }
    * { box-sizing: border-box; }
    html, body { height: 100%; }
    /* Buttons and panels set their own display; hidden must still hide them. */
    [hidden] { display: none !important; }
    body { margin: 0; display: flex; flex-direction: column; overflow: hidden; background: var(--bg); color: var(--text); font: 13px/1.45 "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif; }
    header { flex: 0 0 auto; display: flex; align-items: center; gap: 12px; padding: 10px 18px; border-bottom: 1px solid var(--border); background: var(--surface); }
    .catmark { width: 28px; height: 23px; flex: 0 0 auto; background: var(--accent); -webkit-mask: url("${logoDataUrl}") center / contain no-repeat; mask: url("${logoDataUrl}") center / contain no-repeat; }
    h1 { margin: 0; font-size: 15px; font-weight: 600; letter-spacing: -0.01em; }
    h1 span { color: var(--accent); }
    .version { border: 1px solid var(--border); border-radius: 6px; padding: 1px 7px; color: var(--muted); font: 11px ui-monospace, Consolas, monospace; }
    .spacer { flex: 1 1 auto; }
    .pair-status { display: inline-flex; align-items: center; gap: 6px; border-radius: 999px; background: var(--accent-soft); color: var(--accent-ink); padding: 3px 10px; font-size: 12px; font-weight: 600; }
    .pair-status::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
    .pair-status.is-paired { background: var(--success-soft); color: var(--success); }
    .update-button { height: 28px; border-radius: 999px; padding: 0 12px; font-size: 12px; }
    .update-button[hidden] { display: none; }
    .update-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; }
    .update-row p { flex: 1 1 260px; }
    form.shell { flex: 1 1 auto; min-height: 0; display: grid; grid-template-columns: 208px minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) auto; }
    nav.pages { min-height: 0; display: flex; flex-direction: column; gap: 2px; overflow-y: auto; border-right: 1px solid var(--border); background: var(--surface); padding: 12px 10px; }
    nav.pages button { height: auto; justify-content: flex-start; gap: 10px; border: 0; border-radius: 10px; background: transparent; color: var(--muted); padding: 8px 10px; text-align: left; font-weight: 500; }
    nav.pages button:hover:not(:disabled) { background: var(--hover); color: var(--text); }
    nav.pages button[aria-selected="true"] { background: var(--accent-soft); color: var(--accent-ink); }
    nav.pages svg { width: 17px; height: 17px; flex: 0 0 auto; fill: none; stroke: currentColor; stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round; }
    .nav-text { min-width: 0; display: grid; flex: 1 1 auto; }
    .nav-text strong { color: inherit; font-size: 13px; font-weight: 600; }
    nav.pages button:not([aria-selected="true"]) .nav-text strong { color: var(--text-soft); }
    .nav-text small { overflow: hidden; color: var(--muted); font-size: 11px; font-weight: 400; text-overflow: ellipsis; white-space: nowrap; }
    .nav-count { min-width: 20px; border-radius: 999px; background: var(--hover); color: var(--text-soft); padding: 0 6px; font: 600 11px/18px ui-monospace, Consolas, monospace; text-align: center; }
    .nav-count:empty { display: none; }
    .nav-flag { width: 7px; height: 7px; flex: 0 0 auto; border-radius: 50%; background: var(--accent); }
    .nav-flag[hidden] { display: none; }
    main { min-height: 0; overflow-y: auto; padding: 16px 20px; }
    .page { display: grid; gap: 14px; align-content: start; }
    .page:not(.is-active) { display: none; }
    .page.split { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .card { min-width: 0; display: grid; gap: 12px; align-content: start; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); padding: 14px 16px; box-shadow: var(--shadow); }
    .card.full { grid-column: 1 / -1; }
    .card-head { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 12px; }
    .card-head > div:first-child { display: grid; gap: 2px; flex: 1 1 260px; }
    h2 { margin: 0; font-size: 14px; font-weight: 600; }
    p, .hint { margin: 0; color: var(--muted); font-size: 12px; font-weight: 400; }
    .fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 12px; }
    .fields.three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .wide { grid-column: 1 / -1; }
    label { min-width: 0; display: grid; gap: 4px; color: var(--text-soft); font-size: 12px; font-weight: 500; }
    label code { justify-self: start; overflow: hidden; max-width: 100%; color: var(--muted); font: 10.5px ui-monospace, Consolas, monospace; text-overflow: ellipsis; white-space: nowrap; }
    .label-row { display: grid; gap: 0; }
    .required { color: var(--accent); }
    .field-hint { color: var(--muted); font-size: 11.5px; font-weight: 400; }
    .card-head > .hint { white-space: nowrap; }
    input, select, textarea { width: 100%; height: 34px; border: 1px solid var(--border-strong); border-radius: 8px; background: var(--surface); color: var(--text); padding: 0 10px; font: inherit; }
    textarea { height: auto; min-height: 64px; padding: 8px 10px; resize: vertical; }
    input:focus, select:focus, textarea:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 24%, transparent); }
    input:invalid { border-color: color-mix(in srgb, var(--accent) 70%, var(--border)); }
    input::placeholder { color: color-mix(in srgb, var(--muted) 70%, transparent); }
    button { height: 34px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; border: 1px solid var(--border-strong); border-radius: 8px; background: var(--surface); color: var(--text); padding: 0 12px; font: inherit; font-weight: 600; cursor: pointer; white-space: nowrap; }
    button:hover:not(:disabled) { background: var(--hover); }
    button.primary { border-color: var(--accent-strong); background: var(--accent-strong); color: #ffffff; }
    button.primary:hover:not(:disabled) { background: color-mix(in srgb, var(--accent-strong) 88%, #000000); }
    button.ghost { background: transparent; }
    button.danger { border-color: color-mix(in srgb, var(--danger) 45%, var(--border)); background: transparent; color: var(--danger); }
    button.danger:hover:not(:disabled) { background: var(--danger-soft); }
    button:disabled { opacity: 0.55; cursor: default; }
    button:focus-visible, summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .inline { display: flex; align-items: flex-end; gap: 8px; }
    .inline > label { flex: 1 1 auto; }
    .pair-code { font-family: ui-monospace, Consolas, monospace; letter-spacing: 2px; text-transform: uppercase; }
    .note { border-radius: 10px; background: var(--sunken); padding: 8px 10px; color: var(--muted); font-size: 12px; }
    details.legacy { border-top: 1px solid var(--border); padding-top: 10px; }
    details.legacy summary { cursor: pointer; color: var(--text-soft); font-weight: 600; list-style: none; }
    details.legacy summary::before { content: "▸ "; color: var(--muted); }
    details[open].legacy summary::before { content: "▾ "; }
    details.legacy label { margin-top: 10px; }
    .steps { margin: 0; display: grid; gap: 8px; padding: 0; list-style: none; counter-reset: step; }
    .steps li { display: flex; align-items: baseline; gap: 10px; color: var(--text-soft); font-size: 12.5px; counter-increment: step; }
    .steps li::before { content: counter(step); width: 20px; height: 20px; flex: 0 0 auto; display: inline-grid; place-items: center; border-radius: 50%; background: var(--accent-soft); color: var(--accent-ink); font-size: 11px; font-weight: 700; }
    .monitor-actions { display: flex; flex: 0 0 auto; gap: 8px; }
    .monitor-columns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .monitor-group { min-width: 0; display: grid; align-content: start; gap: 6px; }
    .monitor-group-title { color: var(--muted); font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; }
    .drive-picker { display: grid; gap: 6px; border: 1px dashed var(--accent); border-radius: 10px; background: var(--accent-soft); padding: 8px; }
    .drive-picker[hidden] { display: none; }
    #targetList, #autoDiskList { display: grid; gap: 6px; }
    .monitor-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 10px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); padding: 8px 10px; }
    .monitor-row strong, .monitor-row span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .monitor-row strong { font-size: 13px; font-weight: 600; }
    .monitor-row span { color: var(--muted); font: 11.5px ui-monospace, Consolas, monospace; margin-top: 1px; }
    .monitor-row small { display: inline-block; margin-top: 4px; border-radius: 999px; background: var(--hover); color: var(--text-soft); padding: 1px 8px; font-size: 10.5px; font-weight: 600; }
    .monitor-row button { height: 30px; font-size: 12px; }
    .monitor-empty { border: 1px dashed var(--border-strong); border-radius: 10px; color: var(--muted); padding: 10px; font-size: 12px; }
    .monitor-row small.is-warn { background: var(--danger-soft); color: var(--danger); white-space: nowrap; }
    .row-actions { display: flex; gap: 6px; }
    .monitor-panel { grid-column: 1 / -1; min-width: 0; display: grid; gap: 8px; border-radius: 8px; background: var(--sunken); padding: 10px; }
    .monitor-panel p, .monitor-panel .verdict { font-size: 12px; }
    .monitor-panel .verdict { color: var(--text-soft); font-weight: 500; }
    .monitor-panel .verdict.is-ok { color: var(--success); }
    .monitor-panel .verdict.is-warn { color: var(--danger); }
    .panel-line { min-width: 0; display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
    .panel-line > select { flex: 1 1 260px; min-width: 0; height: 30px; }
    .monitor-panel input { height: 30px; }
    .panel-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
    option { background: var(--surface); color: var(--text); }
    .token-actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .actions { grid-column: 1 / -1; display: flex; align-items: center; gap: 10px; border-top: 1px solid var(--border); background: var(--surface); padding: 10px 18px; }
    #status { min-width: 0; flex: 1 1 auto; overflow: hidden; color: var(--success); font-size: 12.5px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
    #status.is-error { color: var(--danger); }
    #status.is-info { color: var(--muted); }
    @media (max-width: 760px) {
      form.shell { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr) auto; }
      nav.pages { flex-direction: row; overflow-x: auto; overflow-y: hidden; border-right: 0; border-bottom: 1px solid var(--border); padding: 8px 10px; }
      nav.pages button { flex: 0 0 auto; padding: 6px 10px; }
      .nav-text small { display: none; }
      .page.split, .monitor-columns { grid-template-columns: minmax(0, 1fr); }
      .fields.three { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      main { padding: 12px; }
    }
  </style>
${trayLocalizerScript(language)}
</head>
<body>
  <header>
    <span class="catmark" aria-hidden="true"></span>
    <h1>Video<span>CAT</span> Companion</h1>
    <span class="version">v${version}</span>
    <span class="spacer"></span>
    <button type="button" id="updateButton" class="primary update-button" hidden></button>
    <span id="pairStatus" class="pair-status">Sin emparejar</span>
  </header>
  <form id="form" class="shell" novalidate>
    <nav class="pages" role="tablist" aria-label="Secciones de la configuración">
      <button type="button" role="tab" data-page="connection" aria-controls="page-connection">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/></svg>
        <span class="nav-text"><strong>Conexión</strong><small>Servidor y código</small></span>
        <span class="nav-flag" id="connectionFlag" title="Falta completar la conexión" hidden></span>
      </button>
      <button type="button" role="tab" data-page="browser" aria-controls="page-browser">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5"/></svg>
        <span class="nav-text"><strong>Navegador</strong><small>Token local</small></span>
      </button>
      <button type="button" role="tab" data-page="routes" aria-controls="page-routes">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 12H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><path d="M6 16h.01"/><path d="M10 16h.01"/></svg>
        <span class="nav-text"><strong>Rutas</strong><small>Discos y carpetas</small></span>
        <span class="nav-count" id="routesCount"></span>
      </button>
      <button type="button" role="tab" data-page="files" aria-controls="page-files">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>
        <span class="nav-text"><strong>Archivos</strong><small>Descargas y FFmpeg</small></span>
      </button>
      <button type="button" role="tab" data-page="advanced" aria-controls="page-advanced">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 4h-7"/><path d="M10 4H3"/><path d="M21 12h-9"/><path d="M8 12H3"/><path d="M21 20h-5"/><path d="M12 20H3"/><path d="M14 2v4"/><path d="M8 10v4"/><path d="M16 18v4"/></svg>
        <span class="nav-text"><strong>Avanzado</strong><small>Puerto e intervalos</small></span>
      </button>
      <button type="button" role="tab" data-page="updates" aria-controls="page-updates">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>
        <span class="nav-text"><strong>Actualizaciones</strong><small id="updateNavText">v${version}</small></span>
        <span class="nav-flag" id="updateFlag" title="Actualización lista" hidden></span>
      </button>
    </nav>

    <main>
      <div class="page" id="page-connection" role="tabpanel" data-page="connection">
        <section class="card">
          <div class="card-head">
            <div><h2>Conexión con VideoCAT</h2><p>Servidor al que este equipo reporta escaneos y del que recibe tareas.</p></div>
            <span class="hint"><span class="required">*</span> obligatorio</span>
          </div>
          <div class="fields">
            <label class="wide"><span class="label-row"><span>URL del servidor <span class="required">*</span></span><code>SERVER_URL</code></span><input name="SERVER_URL" required placeholder="http://192.168.1.x:8081" /></label>
            <label><span class="label-row"><span>URL de la web</span><code>WEB_URL</code></span><input name="WEB_URL" placeholder="https://cat.example.com" /></label>
            <label><span class="label-row"><span>Nombre del equipo</span><code>COMPANION_NAME</code></span><input name="COMPANION_NAME" placeholder="Opcional" /></label>
          </div>
          <details class="legacy">
            <summary>Token compartido (solo clientes heredados)</summary>
            <label><span class="label-row"><span>Token compartido</span><code>AGENT_TOKEN</code></span><input name="AGENT_TOKEN" type="password" autocomplete="off" /></label>
          </details>
        </section>

        <section class="card">
          <div class="card-head">
            <div><h2>Emparejamiento</h2><p>Genera un código en VideoCAT › Administración › Companions. Solo se usa una vez.</p></div>
          </div>
          <div class="inline">
            <label><span class="label-row"><span>Código de emparejamiento</span></span><input id="pairCode" class="pair-code" maxlength="11" placeholder="ABCDE-23456" autocomplete="one-time-code" /></label>
            <button type="button" id="pair" class="primary">Emparejar</button>
          </div>
          <div id="pairDetail" class="note"></div>
        </section>
      </div>

      <div class="page" id="page-browser" role="tabpanel" data-page="browser">
        <section class="card">
          <div class="card-head">
            <div><h2>Token del navegador</h2><p>Abrir, copiar y borrar archivos desde la web solo se acepta con este token.</p></div>
          </div>
          <label><span class="label-row"><span>Token local</span><code>COMPANION_TOKEN</code></span><input name="COMPANION_TOKEN" id="companionToken" type="password" autocomplete="off" spellcheck="false" /></label>
          <div class="token-actions">
            <button type="button" id="copyToken" class="primary">Copiar token</button>
            <button type="button" id="toggleToken" class="ghost">Mostrar</button>
          </div>
        </section>
        <section class="card">
          <h2>Cómo usarlo</h2>
          <ol class="steps">
            <li>Copia el token con el botón de arriba.</li>
            <li>En VideoCAT, abre Perfil › Companion local.</li>
            <li>Pégalo y guárdalo. Repite en cada navegador de esta PC.</li>
          </ol>
          <p>Si lo borras y guardas, se genera uno nuevo y habrá que pegarlo otra vez en el navegador.</p>
        </section>
      </div>

      <div class="page" id="page-routes" role="tabpanel" data-page="routes">
        <section class="card">
          <div class="card-head">
            <div><h2>Rutas monitoreadas</h2><p>Unidades y carpetas locales o de red que el Companion revisa automáticamente.</p></div>
            <div class="monitor-actions">
              <button type="button" id="addFolder" class="ghost">Añadir carpeta…</button>
              <button type="button" id="addDrive" class="primary">Añadir unidad…</button>
            </div>
          </div>
          <div id="drivePicker" class="drive-picker" hidden></div>
          <div class="monitor-columns">
            <div class="monitor-group">
              <span class="monitor-group-title">Rutas añadidas manualmente</span>
              <div id="targetList"></div>
            </div>
            <div class="monitor-group">
              <span class="monitor-group-title">Discos VideoCAT detectados</span>
              <div id="autoDiskList"></div>
              <p>Puedes ignorarlos temporalmente sin borrar el marcador del disco.</p>
            </div>
          </div>
          <textarea name="COMPANION_MONITORED_TARGETS" id="COMPANION_MONITORED_TARGETS" hidden></textarea>
          <input name="COMPANION_DISABLED_DISK_IDS" id="COMPANION_DISABLED_DISK_IDS" hidden />
        </section>
        <section class="card">
          <div class="card-head">
            <div><h2>Salud de discos</h2><p>Lee el estado SMART de los discos conectados (sectores dañados, errores, temperatura) con smartctl y lo muestra en VideoCAT › Administración. Revisa cada disco al conectarlo y cada 6 horas.</p></div>
          </div>
          <div class="update-row">
            <p id="healthText">Consultando…</p>
            <div class="monitor-actions">
              <button type="button" id="healthCheck" class="ghost" hidden>Revisar ahora</button>
              <button type="button" id="healthToggle" class="primary" hidden>Activar…</button>
            </div>
          </div>
          <p class="note">Windows pide permiso de administrador al activarla y al desactivarla: smartctl queda en Program Files y una tarea programada lo ejecuta con ese permiso. El Companion nunca corre como administrador.</p>
        </section>
      </div>

      <div class="page" id="page-files" role="tabpanel" data-page="files">
        <section class="card">
          <div class="card-head">
            <div><h2>Archivos y herramientas</h2><p>Destino de las copias, carpeta temporal de traslados y rutas opcionales de FFmpeg.</p></div>
          </div>
          <div class="fields">
            <label class="wide"><span class="label-row"><span>Carpeta de descargas</span><code>COMPANION_DOWNLOAD_DIR</code></span><input name="COMPANION_DOWNLOAD_DIR" placeholder="C:\\Users\\tu_usuario\\Desktop\\VideoCAT" /></label>
            <label class="wide"><span class="label-row"><span>Carpeta temporal de traslados</span><code>COMPANION_STAGING_DIR</code></span><input name="COMPANION_STAGING_DIR" placeholder="Ej. D:\\VideoCAT\\Traslados (vacío = traslados desactivados)" /><small class="field-hint">Los archivos que se mueven entre discos esperan aquí hasta conectar el disco de destino. Siempre se deja libre el 5 % de esta unidad.</small></label>
            <label><span class="label-row"><span>FFmpeg</span><code>FFMPEG_PATH</code></span><input name="FFMPEG_PATH" placeholder="Detección automática" /></label>
            <label><span class="label-row"><span>FFprobe</span><code>FFPROBE_PATH</code></span><input name="FFPROBE_PATH" placeholder="Detección automática" /></label>
            <label class="wide"><span class="label-row"><span>Carpeta de estado</span><code>AGENT_STATE_DIR</code></span><input name="AGENT_STATE_DIR" placeholder="Automática: %LOCALAPPDATA%\\VideoCAT\\agent-state" /></label>
          </div>
        </section>
      </div>

      <div class="page" id="page-advanced" role="tabpanel" data-page="advanced">
        <section class="card">
          <div class="card-head">
            <div><h2>Opciones avanzadas</h2><p>Déjalas vacías para usar los valores por defecto.</p></div>
          </div>
          <div class="fields three">
            <label><span class="label-row"><span>Clic en el ícono</span><code>TRAY_CLICK_ACTION</code></span><select name="TRAY_CLICK_ACTION"><option value="open">Abrir VideoCAT</option><option value="activity">Mostrar actividad</option><option value="settings">Abrir configuración</option></select></label>
            <label><span class="label-row"><span>Idioma</span><code>COMPANION_LANGUAGE</code></span><select name="COMPANION_LANGUAGE"><option value="auto">Automático (el de Windows)</option><option value="es" data-no-i18n>Español</option><option value="en" data-no-i18n>English</option></select></label>
            <label><span class="label-row"><span>Puerto local</span><code>COMPANION_PORT</code></span><input name="COMPANION_PORT" placeholder="29429" /></label>
            <label title="Si un archivo no termina de leerse en este tiempo con el disco conectado (sectores dañados), el escaneo sigue con el siguiente y lo marca en riesgo."><span class="label-row"><span>Tiempo máximo por archivo (s)</span><code>COMPANION_FILE_TIMEOUT_SECONDS</code></span><input name="COMPANION_FILE_TIMEOUT_SECONDS" placeholder="180" /></label>
            <label><span class="label-row"><span>Remux MP4 temporal</span><code>COMPANION_REMOTE_REMUX_ENABLED</code></span><select name="COMPANION_REMOTE_REMUX_ENABLED"><option value="false">Desactivado</option><option value="true">Activado (solo H.264/AAC)</option></select></label>
            <label><span class="label-row"><span>Borrar los marcados</span><code>COMPANION_AUTO_DELETE_MARKED</code></span><select name="COMPANION_AUTO_DELETE_MARKED"><option value="true">Automáticamente</option><option value="false">Solo a pedido</option></select></label>
            <label class="wide"><span class="label-row"><span>Orígenes permitidos</span><code>COMPANION_ALLOWED_ORIGINS</code></span><input name="COMPANION_ALLOWED_ORIGINS" placeholder="https://cat.example.com,http://localhost:5173" /></label>
            <label><span class="label-row"><span>Detección de discos (ms)</span><code>COMPANION_DISK_POLL_MS</code></span><input name="COMPANION_DISK_POLL_MS" placeholder="5000" /></label>
            <label><span class="label-row"><span>Reescaneo (ms)</span><code>COMPANION_SCAN_POLL_MS</code></span><input name="COMPANION_SCAN_POLL_MS" placeholder="900000" /></label>
            <label><span class="label-row"><span>Latido (ms)</span><code>COMPANION_HEARTBEAT_MS</code></span><input name="COMPANION_HEARTBEAT_MS" placeholder="15000" /></label>
            <label><span class="label-row"><span>Revisión de borrados (ms)</span><code>COMPANION_DELETE_POLL_MS</code></span><input name="COMPANION_DELETE_POLL_MS" placeholder="60000" /></label>
            <label><span class="label-row"><span>Revisión de descargas (ms)</span><code>COMPANION_DOWNLOAD_POLL_MS</code></span><input name="COMPANION_DOWNLOAD_POLL_MS" placeholder="60000" /></label>
            <label><span class="label-row"><span>Copia estancada (ms)</span><code>COMPANION_DOWNLOAD_STALL_MS</code></span><input name="COMPANION_DOWNLOAD_STALL_MS" placeholder="30000" /></label>
            <label><span class="label-row"><span>Discos en la bandeja (ms)</span><code>TRAY_DISK_POLL_MS</code></span><input name="TRAY_DISK_POLL_MS" placeholder="10000" /></label>
            <label><span class="label-row"><span>Revisión de traslados (ms)</span><code>COMPANION_TRANSFER_POLL_MS</code></span><input name="COMPANION_TRANSFER_POLL_MS" placeholder="60000" /></label>
          </div>
        </section>
      </div>

      <div class="page" id="page-updates" role="tabpanel" data-page="updates">
        <section class="card">
          <div class="card-head">
            <div><h2>Actualizaciones</h2><p>El Companion busca versiones nuevas en GitHub, las descarga en segundo plano y las aplica al reiniciar.</p></div>
          </div>
          <div class="update-row">
            <p id="updateText">Consultando…</p>
            <button type="button" id="checkUpdates" class="ghost">Buscar ahora</button>
          </div>
        </section>
      </div>
    </main>

    <div class="actions">
      <div id="status" role="status"></div>
      <button type="button" id="close" class="ghost">Cerrar</button>
      <button type="submit" class="primary">Guardar cambios</button>
    </div>
  </form>
  <script>
    const tr = window.vcTr || ((text) => text);
    const numberLocale = window.vcLanguage || "es";
    const form = document.getElementById("form");
    const status = document.getElementById("status");
    const targetList = document.getElementById("targetList");
    const autoDiskList = document.getElementById("autoDiskList");
    const drivePicker = document.getElementById("drivePicker");
    const targetInput = document.getElementById("COMPANION_MONITORED_TARGETS");
    const disabledInput = document.getElementById("COMPANION_DISABLED_DISK_IDS");
    const pairStatus = document.getElementById("pairStatus");
    const pairDetail = document.getElementById("pairDetail");
    const pairCode = document.getElementById("pairCode");
    let targets = [];
    let disabledDiskIds = new Set();
    let availableDrives = [];
    const pageKey = "videocat-companion-settings-page";
    const pageTabs = [...document.querySelectorAll("nav.pages [data-page]")];
    const routesCount = document.getElementById("routesCount");
    const connectionFlag = document.getElementById("connectionFlag");

    function showPage(page) {
      if (!pageTabs.some((tab) => tab.dataset.page === page)) page = "connection";
      for (const tab of pageTabs) {
        const active = tab.dataset.page === page;
        tab.setAttribute("aria-selected", String(active));
        tab.tabIndex = active ? 0 : -1;
      }
      for (const panel of document.querySelectorAll("main .page")) panel.classList.toggle("is-active", panel.dataset.page === page);
      document.querySelector("main").scrollTop = 0;
      if (status.className === "is-info") setStatus("");
      try { localStorage.setItem(pageKey, page); } catch {}
    }

    function storedPage() {
      try { return localStorage.getItem(pageKey) || "connection"; } catch { return "connection"; }
    }

    function refreshConnectionFlag() {
      connectionFlag.hidden = Boolean(String(form.elements.namedItem("SERVER_URL").value || "").trim());
    }

    for (const tab of pageTabs) {
      tab.addEventListener("click", () => showPage(tab.dataset.page));
      tab.addEventListener("keydown", (event) => {
        const step = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 0;
        if (!step) return;
        event.preventDefault();
        const next = pageTabs[(pageTabs.indexOf(tab) + step + pageTabs.length) % pageTabs.length];
        showPage(next.dataset.page);
        next.focus();
      });
    }
    form.elements.namedItem("SERVER_URL").addEventListener("input", refreshConnectionFlag);
    showPage(storedPage());

    const updateButton = document.getElementById("updateButton");
    const updateText = document.getElementById("updateText");
    const checkUpdates = document.getElementById("checkUpdates");

    function renderUpdate(update) {
      if (!update) return;
      updateButton.hidden = !update.readyVersion;
      document.getElementById("updateFlag").hidden = !update.readyVersion;
      document.getElementById("updateNavText").textContent = update.readyVersion ? tr("v{version} lista", { version: update.readyVersion }) : "v" + update.currentVersion;
      updateButton.textContent = update.readyVersion ? tr("Actualizar a v{version}", { version: update.readyVersion }) : "";
      checkUpdates.hidden = !update.installed;
      updateText.textContent = update.message
        || (update.readyVersion
          ? tr("La versión v{version} está lista. Se instala al reiniciar el Companion.", { version: update.readyVersion })
          : update.installed
            ? tr("Versión instalada: v{version}.", { version: update.currentVersion })
            : "Esta copia no se actualiza sola. Instala el Companion con Setup.exe desde GitHub para recibir actualizaciones automáticas.");
    }

    function setStatus(message, type = "info") {
      status.textContent = message;
      status.className = type === "error" ? "is-error" : type === "success" ? "" : "is-info";
    }

    async function refreshPairingStatus() {
      try {
        const pairing = await window.videocatConfig.pairingStatus();
        pairStatus.textContent = pairing.paired ? "Emparejado" : "Sin emparejar";
        pairStatus.className = pairing.paired ? "pair-status is-paired" : "pair-status";
        pairDetail.textContent = pairing.paired
          ? tr("Credencial cifrada para {server}. ID: {id}", { server: pairing.serverUrl, id: pairing.companionId })
          : pairing.encryptionAvailable
            ? "Este equipo todavía usa el token compartido o no tiene credenciales."
            : "El cifrado seguro de Windows no está disponible en esta sesión.";
      } catch (error) {
        pairStatus.textContent = "Estado desconocido";
        pairDetail.textContent = error?.message || "No se pudo consultar el emparejamiento.";
      }
    }

    // This window is a data: URL (not a secure context), so crypto.randomUUID is missing here;
    // getRandomValues is always available and gives a proper v4 UUID for the disk identity.
    function newId() {
      if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
      const bytes = new Uint8Array(16);
      globalThis.crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
      return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) + "-" + hex.slice(16, 20) + "-" + hex.slice(20);
    }

    function normalizeTargets(value) {
      try {
        const parsed = JSON.parse(value || "[]");
        if (!Array.isArray(parsed)) return [];
        return parsed
          .filter((target) => target && target.id && target.name && target.path)
          .map((target) => ({
            id: String(target.id),
            name: String(target.name),
            path: String(target.path),
            enabled: target.enabled !== false
          }));
      } catch {
        return [];
      }
    }

    function syncMonitorInputs() {
      targetInput.value = JSON.stringify(targets);
      disabledInput.value = [...disabledDiskIds].join(",");
    }

    function hasManualTarget(targetPath) {
      const normalized = String(targetPath).replace(/[\\/]+$/, "").toLowerCase();
      return targets.some((target) => String(target.path).replace(/[\\/]+$/, "").toLowerCase() === normalized);
    }

    function addManualTarget(targetPath, name) {
      if (hasManualTarget(targetPath)) {
        setStatus("Esta ruta ya se encuentra en monitoreo.", "info");
        return false;
      }
      targets.push({ id: newId(), name: String(name).trim(), path: targetPath, enabled: true });
      renderMonitors();
      setStatus("Ruta añadida. Guarda los cambios para iniciar su monitoreo.", "success");
      return true;
    }

    // Whole drives are followed by their .videocat-disk.json, never by their letter.
    function isDriveRoot(value) {
      return /^[A-Za-z]:[\\\\/]?$/.test(String(value).trim());
    }

    function sameRoot(a, b) {
      return String(a).replace(/[\\\\/]+$/, "").toLowerCase() === String(b).replace(/[\\\\/]+$/, "").toLowerCase();
    }

    // A route saved by older builds for a whole drive, still scanning whatever drive has that letter.
    function letterTargetAt(root) {
      return targets.find((target) => target.enabled !== false && isDriveRoot(target.path) && sameRoot(target.path, root));
    }

    function formatBytes(bytes) {
      const units = ["B", "KB", "MB", "GB", "TB"];
      let value = Number(bytes) || 0;
      let unit = 0;
      // Base 1024, like the Windows Explorer, so the size reads the same as there.
      while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit += 1;
      }
      return value.toLocaleString(numberLocale, { maximumFractionDigits: value < 10 ? 2 : 1 }) + " " + units[unit];
    }

    function driveLabel(drive) {
      return drive.totalBytes ? tr("{root} · {total} ({free} libres)", { root: drive.root, total: formatBytes(drive.totalBytes), free: formatBytes(drive.freeBytes) }) : drive.root;
    }

    // One panel open at a time, under its row: { kind: "convert", root } or
    // { kind: "pin", targetId, root, result }.
    let drivePanel = null;
    let panelBusy = false;

    function panelElement(className, text) {
      const element = document.createElement(className === "p" ? "p" : "div");
      if (className !== "p") element.className = className;
      if (text) element.textContent = text;
      return element;
    }

    function panelButton(label, className, onClick) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = className;
      button.textContent = label;
      button.disabled = panelBusy;
      button.addEventListener("click", onClick);
      return button;
    }

    // The panel lives inside the settings form: Enter must run its own action, not save the form.
    function nameInput(value, onEnter) {
      const input = document.createElement("input");
      input.maxLength = 80;
      input.placeholder = "Ej.: WD 6TB Video 01";
      input.setAttribute("aria-label", "Nombre del disco");
      input.value = value || "";
      input.disabled = panelBusy;
      input.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        onEnter();
      });
      return input;
    }

    function applyMarkerResult(result) {
      targets = targets
        .filter((target) => target.id !== result.removedTargetId)
        .map((target) => result.pausedTargetIds.includes(target.id) ? { ...target, enabled: false } : target);
      drivePanel = null;
      const message = tr("{root} ahora es el disco VideoCAT «{name}». Se reconoce aunque cambie la letra.", { root: result.root, name: result.diskName });
      setStatus(result.pausedTargetIds.length > 0 ? message + " " + tr("La ruta por letra que apuntaba ahí quedó en pausa.") : message, "success");
    }

    async function runPanelAction(action) {
      panelBusy = true;
      renderMonitors();
      try {
        await action();
      } catch (error) {
        setStatus(error?.message || "No se pudo completar la acción.", "error");
      } finally {
        panelBusy = false;
        await refreshAvailableDrives();
      }
    }

    function convertDrive(root, name) {
      if (!String(name || "").trim()) {
        setStatus("Escribe un nombre para el disco.", "error");
        return;
      }
      void runPanelAction(async () => {
        setStatus(tr("Creando el marcador en {root}...", { root }), "info");
        const result = await window.videocatConfig.convertDrive({ root, name });
        if (!result.ok) {
          setStatus(result.message, "error");
          return;
        }
        applyMarkerResult(result);
      });
    }

    function convertPanel(drive) {
      const panel = panelElement("monitor-panel");
      panel.append(panelElement("p", tr("Se escribirá .videocat-disk.json en la raíz de {root}. Desde ahí el Companion la reconoce en cualquier letra y la revisa sola.", { root: drive.root })));
      const input = nameInput("", () => convertDrive(drive.root, input.value));
      const actions = panelElement("panel-actions");
      actions.append(
        panelButton("Cancelar", "ghost", () => {
          drivePanel = null;
          renderMonitors();
        }),
        panelButton("Crear marcador", "primary", () => convertDrive(drive.root, input.value))
      );
      panel.append(input, actions);
      setTimeout(() => input.focus(), 0);
      return panel;
    }

    function openPinPanel(target, root) {
      const candidates = availableDrives.filter((drive) => !drive.diskId);
      const preferred = candidates.find((drive) => sameRoot(drive.root, root || target.path)) || candidates[0];
      drivePanel = { kind: "pin", targetId: target.id, root: preferred ? preferred.root : "", result: null };
      drivePicker.hidden = true;
      renderMonitors();
    }

    function checkIdentity(target) {
      void runPanelAction(async () => {
        setStatus(tr("Comparando {root} con el catálogo de «{name}»...", { root: drivePanel.root, name: target.name }), "info");
        const result = await window.videocatConfig.checkIdentity(target.id, drivePanel.root);
        if (!result.ok) {
          setStatus(result.message, "error");
          return;
        }
        drivePanel.result = result;
        setStatus("");
      });
    }

    function pinIdentity(target, name, acceptMixed) {
      if (!String(name || "").trim()) {
        setStatus("Escribe un nombre para el disco.", "error");
        return;
      }
      void runPanelAction(async () => {
        setStatus(tr("Fijando la identidad de {root}...", { root: drivePanel.root }), "info");
        const result = await window.videocatConfig.pinIdentity({ targetId: target.id, root: drivePanel.root, name, acceptMixed });
        if (!result.ok) {
          setStatus(result.message, "error");
          return;
        }
        applyMarkerResult(result);
      });
    }

    function verdictText(target, result) {
      const check = result.check;
      const values = { matched: check.matched, checked: check.checked, total: check.totalFiles.toLocaleString(numberLocale), root: result.root, name: target.name };
      if (check.verdict === "empty") return tr("El catálogo todavía no tiene archivos de este disco. Puedes fijar su identidad sin riesgo.");
      if (check.verdict === "match") return tr("{matched} de {checked} archivos de una muestra del catálogo ({total} en total) están en {root}, con el mismo tamaño. Es el mismo disco.", values);
      if (check.verdict === "mixed") {
        return tr("Solo {matched} de {checked} archivos de una muestra del catálogo están en {root}. El catálogo mezcla archivos de otra unidad que tuvo la misma letra. Si esta es la unidad original, fija su identidad; si no, créale un disco nuevo.", values);
      }
      return tr("Solo {matched} de {checked} archivos de una muestra del catálogo están en {root}: esta unidad no es el disco de ese catálogo. Créale un disco nuevo; el catálogo de «{name}» espera a su unidad original.", values);
    }

    function pinPanel(target) {
      const panel = panelElement("monitor-panel");
      const candidates = availableDrives.filter((drive) => !drive.diskId);
      if (candidates.length === 0) {
        panel.append(panelElement("p", tr("No hay unidades sin marcador conectadas. Conecta el disco de «{name}» y búscalo de nuevo.", { name: target.name })));
        const actions = panelElement("panel-actions");
        actions.append(
          panelButton("Cancelar", "ghost", () => {
            drivePanel = null;
            renderMonitors();
          }),
          panelButton("Buscar de nuevo", "primary", () => void refreshAvailableDrives())
        );
        panel.append(actions);
        return panel;
      }

      panel.append(panelElement("p", tr("¿En qué unidad está hoy el disco «{name}»? La letra pudo cambiar. Se compara una muestra de su catálogo con los archivos de la unidad.", { name: target.name })));
      if (!candidates.some((drive) => sameRoot(drive.root, drivePanel.root))) drivePanel.root = candidates[0].root;
      const line = panelElement("panel-line");
      const select = document.createElement("select");
      select.setAttribute("aria-label", "Unidad");
      select.disabled = panelBusy;
      for (const drive of candidates) {
        const option = document.createElement("option");
        option.value = drive.root;
        option.textContent = driveLabel(drive);
        option.selected = sameRoot(drive.root, drivePanel.root);
        select.append(option);
      }
      select.addEventListener("change", () => {
        drivePanel.root = select.value;
        drivePanel.result = null;
        renderMonitors();
      });
      line.append(select, panelButton("Comprobar", drivePanel.result ? "ghost" : "primary", () => checkIdentity(target)));
      panel.append(line);

      const result = drivePanel.result;
      const actions = panelElement("panel-actions");
      actions.append(panelButton("Cancelar", "ghost", () => {
        drivePanel = null;
        renderMonitors();
      }));
      if (result) {
        const verdict = result.check.verdict;
        panel.append(panelElement("verdict " + (verdict === "match" || verdict === "empty" ? "is-ok" : "is-warn"), verdictText(target, result)));
        const keep = verdict === "match" || verdict === "empty";
        const input = nameInput(verdict === "mismatch" ? "" : result.diskName || target.name, () => keep
          ? pinIdentity(target, input.value, false)
          : convertDrive(result.root, input.value));
        panel.append(input);
        if (keep) {
          actions.append(panelButton("Fijar identidad", "primary", () => pinIdentity(target, input.value, false)));
        } else if (verdict === "mixed") {
          actions.append(
            panelButton("Crear disco nuevo", "ghost", () => convertDrive(result.root, input.value)),
            panelButton("Es la original: fijar identidad", "danger", () => pinIdentity(target, input.value, true))
          );
        } else {
          actions.append(panelButton("Crear disco nuevo", "primary", () => convertDrive(result.root, input.value)));
        }
      }
      panel.append(actions);
      return panel;
    }

    function renderDrivePicker() {
      drivePicker.textContent = "";
      if (availableDrives.length === 0) {
        const empty = document.createElement("div");
        empty.className = "monitor-empty";
        empty.textContent = "No se detectaron unidades accesibles. Conecta una unidad y pulsa Añadir unidad de nuevo.";
        drivePicker.appendChild(empty);
        return;
      }

      for (const drive of availableDrives) {
        const row = document.createElement("div");
        row.className = "monitor-row";
        const main = document.createElement("div");
        const name = document.createElement("strong");
        name.textContent = drive.diskName || drive.root;
        const location = document.createElement("span");
        const letterTarget = drive.diskId ? null : letterTargetAt(drive.root);
        location.textContent = driveLabel(drive) + " · " + (drive.diskId
          ? tr("Disco VideoCAT")
          : letterTarget ? tr("Seguida por letra como «{name}»", { name: letterTarget.name }) : tr("Sin marcador"));
        main.append(name, location);

        const action = document.createElement("button");
        action.type = "button";
        const ignored = drive.diskId && disabledDiskIds.has(drive.diskId);
        if (drive.diskId && !ignored) {
          action.textContent = "Automático";
          action.disabled = true;
          action.title = "Ya tiene su marcador: el Companion la reconoce sola.";
          action.className = "ghost";
        } else if (drive.diskId && ignored) {
          action.textContent = "Monitorear";
          action.className = "primary";
          action.addEventListener("click", () => {
            disabledDiskIds.delete(drive.diskId);
            renderMonitors();
            setStatus("Disco VideoCAT activado. Guarda los cambios para aplicar.", "success");
          });
        } else if (letterTarget) {
          // Converting it as a new disk would lose the catalog it already has: pin it instead.
          action.textContent = "Fijar identidad…";
          action.className = "primary";
          action.addEventListener("click", () => openPinPanel(letterTarget, drive.root));
        } else {
          const open = drivePanel?.kind === "convert" && sameRoot(drivePanel.root, drive.root);
          action.textContent = "Convertir…";
          action.className = open ? "ghost" : "primary";
          action.disabled = open || panelBusy;
          action.addEventListener("click", () => {
            drivePanel = { kind: "convert", root: drive.root };
            renderMonitors();
          });
        }
        row.append(main, action);
        if (drivePanel?.kind === "convert" && sameRoot(drivePanel.root, drive.root) && !drive.diskId && !letterTarget) {
          row.append(convertPanel(drive));
        }
        drivePicker.appendChild(row);
      }
    }

    function renderMonitors() {
      syncMonitorInputs();
      renderDrivePicker();
      targetList.textContent = "";
      if (targets.length === 0) {
        const empty = document.createElement("div");
        empty.className = "monitor-empty";
        empty.textContent = "No hay rutas manuales. Los discos con .videocat-disk.json se detectan solos, en cualquier letra.";
        targetList.appendChild(empty);
      } else {
        for (const target of targets) {
          const row = document.createElement("div");
          row.className = "monitor-row";
          const main = document.createElement("div");
          const name = document.createElement("strong");
          name.textContent = target.name;
          const location = document.createElement("span");
          location.textContent = target.path;
          const type = document.createElement("small");
          const wholeDrive = isDriveRoot(target.path);
          const paused = target.enabled === false;
          type.textContent = wholeDrive ? (paused ? "en pausa · sigue la letra" : "sigue la letra") : "carpeta manual";
          if (wholeDrive) {
            type.className = "is-warn";
            type.title = paused
              ? "La unidad que hoy tiene esa letra ya tiene su marcador. Fija la identidad cuando conectes el disco original."
              : "Windows puede darle esta letra a otro disco y el Companion lo tomaría por este. Fija su identidad.";
          }
          main.append(name, location, type);
          const remove = document.createElement("button");
          remove.type = "button";
          remove.className = "danger";
          remove.textContent = "Quitar";
          remove.disabled = panelBusy;
          remove.addEventListener("click", () => {
            targets = targets.filter((item) => item.id !== target.id);
            if (drivePanel?.targetId === target.id) drivePanel = null;
            renderMonitors();
          });
          const actions = document.createElement("div");
          actions.className = "row-actions";
          if (wholeDrive) {
            const pin = document.createElement("button");
            pin.type = "button";
            const open = drivePanel?.kind === "pin" && drivePanel.targetId === target.id;
            pin.className = open ? "ghost" : "primary";
            pin.textContent = "Fijar identidad…";
            pin.disabled = open || panelBusy;
            pin.addEventListener("click", () => openPinPanel(target, target.path));
            actions.append(pin);
          }
          actions.append(remove);
          row.append(main, actions);
          if (drivePanel?.kind === "pin" && drivePanel.targetId === target.id) row.append(pinPanel(target));
          targetList.appendChild(row);
        }
      }

      autoDiskList.textContent = "";
      const markerDrives = availableDrives.filter((drive) => drive.diskId);
      const monitored = targets.filter((target) => target.enabled).length + markerDrives.filter((drive) => !disabledDiskIds.has(drive.diskId)).length;
      routesCount.textContent = monitored > 0 ? String(monitored) : "";
      if (markerDrives.length === 0) {
        const empty = document.createElement("div");
        empty.className = "monitor-empty";
        empty.textContent = "No hay discos VideoCAT con marcador conectados en este momento.";
        autoDiskList.appendChild(empty);
        return;
      }

      for (const drive of markerDrives) {
        const ignored = disabledDiskIds.has(drive.diskId);
        const row = document.createElement("div");
        row.className = "monitor-row";
        const main = document.createElement("div");
        const name = document.createElement("strong");
        name.textContent = drive.diskName || drive.root;
        const location = document.createElement("span");
        location.textContent = drive.root;
        const type = document.createElement("small");
        type.textContent = ignored ? "ignorado" : "monitoreo automático";
        main.append(name, location, type);
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = ignored ? "primary" : "danger";
        toggle.textContent = ignored ? "Monitorear" : "Ignorar";
        toggle.addEventListener("click", () => {
          if (ignored) disabledDiskIds.delete(drive.diskId);
          else disabledDiskIds.add(drive.diskId);
          renderMonitors();
        });
        row.append(main, toggle);
        autoDiskList.appendChild(row);
      }
    }

    async function refreshAvailableDrives() {
      try {
        availableDrives = window.videocatConfig?.listDrives ? await window.videocatConfig.listDrives() : [];
      } catch {
        availableDrives = [];
      }
      renderMonitors();
    }

    async function loadConfig() {
      if (!window.videocatConfig) {
        setStatus("No se pudo cargar el puente de configuración de Electron.", "error");
        return;
      }

      try {
        const config = await window.videocatConfig.load();
        for (const [key, value] of Object.entries(config)) {
          const input = form.elements.namedItem(key);
          if (input) input.value = value || "";
        }
        refreshConnectionFlag();
        if (!String(config.SERVER_URL || "").trim()) showPage("connection");
        targets = normalizeTargets(config.COMPANION_MONITORED_TARGETS);
        disabledDiskIds = new Set(String(config.COMPANION_DISABLED_DISK_IDS || "").split(",").map((item) => item.trim()).filter(Boolean));
        await refreshAvailableDrives();
        await refreshPairingStatus();
      } catch (error) {
        setStatus(error?.message || "No se pudo cargar la configuración.", "error");
      }
    }

    const healthText = document.getElementById("healthText");
    const healthToggle = document.getElementById("healthToggle");
    const healthCheck = document.getElementById("healthCheck");
    let healthInstalled = false;

    async function refreshHealth() {
      const health = await window.videocatConfig?.healthStatus?.().catch(() => null);
      if (!health) {
        healthText.textContent = "No se pudo consultar la salud de discos.";
        return;
      }
      healthInstalled = health.installed;
      healthToggle.hidden = !health.supported;
      healthCheck.hidden = !health.installed;
      healthToggle.textContent = health.installed ? "Desactivar…" : "Activar…";
      healthToggle.className = health.installed ? "ghost" : "primary";
      // A disabled button says why.
      healthToggle.disabled = !health.installed && !health.administrator;
      healthToggle.title = healthToggle.disabled ? "Necesita una cuenta de Windows que pueda ser administradora" : "";
      healthText.textContent = !health.supported
        ? "Solo disponible en Windows."
        : health.installed
          ? (health.lastCheckedAt ? tr("Activa. Última revisión: {date}.", { date: new Date(health.lastCheckedAt).toLocaleString(numberLocale) }) : "Activa. Todavía sin revisiones.")
          : health.administrator
            ? "Desactivada."
            : "Desactivada. Tu usuario de Windows no es administrador: hace falta una cuenta que pueda serlo.";
    }

    healthToggle.addEventListener("click", async () => {
      healthToggle.disabled = true;
      healthCheck.disabled = true;
      setStatus(healthInstalled ? "Desactivando: acepta el permiso de Windows…" : "Activando: acepta el permiso de Windows…", "info");
      try {
        const result = healthInstalled ? await window.videocatConfig.disableHealth() : await window.videocatConfig.enableHealth();
        setStatus(result.message, result.ok ? "success" : "error");
      } catch (error) {
        setStatus(error?.message || "No se pudo completar la acción.", "error");
      } finally {
        healthCheck.disabled = false;
        await refreshHealth();
      }
    });
    healthCheck.addEventListener("click", async () => {
      healthCheck.disabled = true;
      try {
        const result = await window.videocatConfig.checkHealth();
        setStatus(result.message, result.ok ? "success" : "error");
      } finally {
        healthCheck.disabled = false;
      }
    });

    void loadConfig();
    void refreshHealth();
    window.videocatConfig?.updateStatus?.().then(renderUpdate).catch(() => undefined);
    window.videocatConfig?.onUpdateReady?.(renderUpdate);
    updateButton.addEventListener("click", () => window.videocatConfig?.installUpdate?.());
    checkUpdates.addEventListener("click", async () => {
      checkUpdates.disabled = true;
      updateText.textContent = "Buscando actualizaciones…";
      try {
        renderUpdate(await window.videocatConfig.checkForUpdates());
      } finally {
        checkUpdates.disabled = false;
      }
    });
    document.getElementById("close").addEventListener("click", () => window.videocatConfig?.close());
    document.getElementById("toggleToken").addEventListener("click", (event) => {
      const input = document.getElementById("companionToken");
      const reveal = input.type === "password";
      input.type = reveal ? "text" : "password";
      event.currentTarget.textContent = reveal ? "Ocultar" : "Mostrar";
    });
    document.getElementById("copyToken").addEventListener("click", async () => {
      const copied = window.videocatConfig?.copyToken ? await window.videocatConfig.copyToken() : false;
      setStatus(copied ? "Token copiado. Pégalo en VideoCAT › Perfil › Companion local." : "Guarda la configuración para generar el token.", copied ? "success" : "error");
    });
    document.getElementById("pair").addEventListener("click", async () => {
      if (!window.videocatConfig?.pair) return;
      const code = String(pairCode.value || "").trim();
      if (!code) {
        setStatus("Ingresa el código generado desde Administración.", "error");
        pairCode.focus();
        return;
      }
      syncMonitorInputs();
      const button = document.getElementById("pair");
      button.disabled = true;
      setStatus("Emparejando con el servidor...", "info");
      try {
        const result = await window.videocatConfig.pair(code, Object.fromEntries(new FormData(form).entries()));
        if (!result.ok) {
          setStatus(result.message || "No se pudo emparejar.", "error");
          return;
        }
        pairCode.value = "";
        form.elements.namedItem("AGENT_TOKEN").value = "";
        await refreshPairingStatus();
        setStatus("Emparejamiento completado. Companion reiniciado con su credencial individual.", "success");
      } catch (error) {
        setStatus(error?.message || "No se pudo emparejar.", "error");
      } finally {
        button.disabled = false;
      }
    });
    document.getElementById("addFolder").addEventListener("click", async () => {
      if (!window.videocatConfig?.chooseFolder) {
        setStatus("No se pudo abrir el selector de carpetas.", "error");
        return;
      }
      const folder = await window.videocatConfig.chooseFolder();
      if (!folder) return;
      if (isDriveRoot(folder)) {
        drivePicker.hidden = false;
        await refreshAvailableDrives();
        setStatus("Para una unidad completa usa Convertir: le crea su marcador y la reconoce aunque cambie la letra.", "info");
        return;
      }
      const defaultName = folder.split(/[\\\\/]/).filter(Boolean).pop() || folder;
      addManualTarget(folder, defaultName);
    });
    document.getElementById("addDrive").addEventListener("click", async () => {
      drivePicker.hidden = false;
      setStatus("Buscando unidades conectadas...", "info");
      await refreshAvailableDrives();
      setStatus(
        availableDrives.length > 0 ? "Elige una unidad. Convertir le crea su marcador para reconocerla aunque cambie la letra." : "No se detectaron unidades accesibles.",
        availableDrives.length > 0 ? "info" : "error"
      );
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const invalid = form.querySelector("main :invalid");
      if (invalid) {
        showPage(invalid.closest(".page").dataset.page);
        form.reportValidity();
        return;
      }
      if (!window.videocatConfig) {
        setStatus("No se pudo cargar el puente de configuración de Electron. Cierra y abre de nuevo el Companion.", "error");
        return;
      }
      syncMonitorInputs();
      const values = Object.fromEntries(new FormData(form).entries());
      const submit = form.querySelector("button[type=submit]");
      submit.disabled = true;
      setStatus("Guardando configuración...", "info");
      try {
        const result = await window.videocatConfig.save(values);
        if (!result.ok) {
          setStatus(result.message || "No se pudo guardar la configuración.", "error");
          return;
        }
        setStatus("Configuración guardada. Companion reiniciado.", "success");
      } catch (error) {
        setStatus(error?.message || "No se pudo guardar la configuración.", "error");
      } finally {
        submit.disabled = false;
      }
    });
  </script>
</body>
</html>`;
}

export function logHtml(version: string, language: TrayLanguage): string {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>VideoCAT Actividad v${version}</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Segoe UI, Arial, sans-serif; background: #0f1519; color: #eef5f7; }
    main { height: 100vh; display: grid; grid-template-rows: auto 1fr auto; }
    header { padding: 16px 18px; border-bottom: 1px solid #26343c; background: #121b20; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    h1 { margin: 0; font-size: 18px; }
    .actions { display: flex; align-items: center; gap: 10px; }
    label { color: #b1c4ce; font-size: 12px; font-weight: 800; display: flex; align-items: center; gap: 6px; }
    button { min-height: 34px; border: 1px solid #33444e; border-radius: 7px; padding: 0 12px; font-weight: 900; color: #fff; background: #162128; }
    button.primary { border-color: #fc6121; background: #fc6121; }
    #log { overflow: auto; padding: 12px 14px; font-family: Consolas, "Cascadia Mono", monospace; font-size: 12px; line-height: 1.45; }
    .row { display: grid; grid-template-columns: 74px 86px 110px 1fr; gap: 10px; align-items: start; padding: 5px 0; border-bottom: 1px solid rgba(255, 255, 255, 0.04); }
    .time { color: #78909c; }
    .source { color: #dce8ed; font-weight: 800; }
    .message { color: #c8d5db; white-space: pre-wrap; overflow-wrap: anywhere; }
    .level { width: 64px; height: 22px; display: inline-flex; align-items: center; justify-content: center; align-self: start; border: 1px solid transparent; border-radius: 4px; padding: 0 7px; font-size: 11px; line-height: 1; font-weight: 900; text-transform: uppercase; }
    .info .level { color: #bde8cd; background: rgba(39, 174, 96, 0.16); }
    .warn .level { color: #ffdf8f; background: rgba(245, 158, 11, 0.18); }
    .error .level { color: #ffb4a4; background: rgba(239, 68, 68, 0.2); }
    footer { padding: 10px 18px; color: #78909c; border-top: 1px solid #26343c; background: #121b20; font-size: 12px; font-weight: 700; }
    .empty { color: #78909c; padding: 20px; text-align: center; font-family: Segoe UI, Arial, sans-serif; }
    .version { color: #fc6121; font-size: 12px; font-weight: 800; vertical-align: middle; }
  </style>
${trayLocalizerScript(language)}
</head>
<body>
  <main>
    <header>
      <h1>Actividad de VideoCAT Companion <span class="version">v${version}</span></h1>
      <div class="actions">
        <label><input id="follow" type="checkbox" checked /> Seguir</label>
        <button id="clear" type="button">Limpiar</button>
        <button id="close" class="primary" type="button">Cerrar</button>
      </div>
    </header>
    <section id="log"><div class="empty">Cargando actividad...</div></section>
    <footer id="count">${language === "en" ? "0 events" : "0 eventos"}</footer>
  </main>
  <script>
    const tr = window.vcTr || ((text) => text);
    const numberLocale = window.vcLanguage || "es";
    const log = document.getElementById("log");
    const count = document.getElementById("count");
    const follow = document.getElementById("follow");
    let total = 0;

    function renderCount() {
      count.textContent = total === 1 ? tr("1 evento") : tr("{count} eventos", { count: total });
    }

    function appendEntry(entry) {
      if (log.querySelector(".empty")) log.textContent = "";
      const row = document.createElement("div");
      row.className = "row " + entry.level;
      // The agent's own lines stay as written.
      row.dataset.noI18n = "";
      const time = new Date(entry.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      const cells = [
        ["time", time],
        ["level", entry.level],
        ["source", entry.source],
        ["message", entry.message]
      ];
      for (const [className, text] of cells) {
        const cell = document.createElement("div");
        cell.className = className;
        cell.textContent = text;
        row.appendChild(cell);
      }
      log.appendChild(row);
      total += 1;
      renderCount();
      if (follow.checked) log.scrollTop = log.scrollHeight;
    }

    async function loadLogs() {
      if (!window.videocatLog) {
        log.innerHTML = '<div class="empty">No se pudo cargar el puente de logs de Electron.</div>';
        return;
      }
      const entries = await window.videocatLog.load();
      log.textContent = "";
      total = 0;
      if (entries.length === 0) {
        log.innerHTML = '<div class="empty">Todavia no hay actividad registrada.</div>';
      } else {
        for (const entry of entries) appendEntry(entry);
      }
      renderCount();
    }

    void loadLogs();
    window.videocatLog?.onEntry((entry) => appendEntry(entry));
    window.videocatLog?.onCleared(() => {
      total = 0;
      log.innerHTML = '<div class="empty">Log limpio.</div>';
      renderCount();
    });
    document.getElementById("clear").addEventListener("click", () => window.videocatLog?.clear());
    document.getElementById("close").addEventListener("click", () => window.videocatLog?.close());
  </script>
</body>
</html>`;
}
