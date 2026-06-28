export type Language = "es" | "en";

const supportedLanguages = new Set<Language>(["es", "en"]);

export function normalizeLanguage(value: string | null | undefined): Language {
  return supportedLanguages.has(value as Language) ? value as Language : "es";
}

export function defaultLanguage(): Language {
  const candidates = typeof navigator === "undefined"
    ? []
    : [navigator.language, ...(navigator.languages ?? [])];
  return candidates.some((candidate) => candidate.toLowerCase().startsWith("es")) ? "es" : "en";
}

export function languageLabel(language: Language): string {
  return language === "en" ? "English" : "Español";
}

const en: Record<string, string> = {
  "Cambiar tema": "Change theme",
  "Idioma": "Language",
  "Apoyar VideoCAT": "Support VideoCAT",
  "Perfil de GitHub": "GitHub profile",
  "Configura VITE_GITHUB_SPONSORS_URL": "Configure VITE_GITHUB_SPONSORS_URL",
  "Configura VITE_PAYPAL_DONATE_URL": "Configure VITE_PAYPAL_DONATE_URL",
  "Mostrar catalogo completo": "Show full catalog",
  "Agente conectado": "Agent connected",
  "Agente desconectado": "Agent disconnected",
  "Secciones principales": "Main sections",
  "Catalogo": "Catalog",
  "A descargar": "To download",
  "Duplicados": "Duplicates",
  "Esquema de uso": "Usage map",
  "Auditoria": "Audit",
  "Administracion": "Administration",
  "Perfil": "Profile",
  "Perfil y seguridad": "Profile and security",
  "PIN y patrones protegidos para carpetas privadas.": "PIN and protected patterns for private folders.",
  "PIN configurado": "PIN configured",
  "PIN no configurado": "PIN not configured",
  "PIN actual": "Current PIN",
  "Nuevo PIN": "New PIN",
  "Patrones protegidos": "Protected patterns",
  "Un patron por linea o separados por coma. VideoCAT ocultara carpetas cuyo nombre contenga cualquiera de estos textos.": "One pattern per line or separated by commas. VideoCAT will hide folders whose name contains any of these texts.",
  "Guardar perfil": "Save profile",
  "Guardando...": "Saving...",
  "Perfil actualizado.": "Profile updated.",
  "El nuevo PIN debe tener 4 digitos.": "The new PIN must have 4 digits.",
  "PIN actual incorrecto.": "Current PIN is incorrect.",
  "No se pudo cargar el perfil.": "Could not load profile.",
  "No se pudo guardar el perfil.": "Could not save profile.",
  "Cerrar sesion": "Sign out",
  "Salir": "Sign out",
  "Usuario": "Username",
  "Contrasena": "Password",
  "Entrar": "Sign in",
  "Discos conectados": "Connected drives",
  "Mostrar conectados": "Show connected",
  "Detectando...": "Detecting...",
  "Todos": "All",
  "Ninguno": "None",
  "Discos": "Drives",
  "Videos": "Videos",
  "Bytes catalogados": "Cataloged bytes",
  "Duplicados probables": "Probable duplicates",
  "Arrastrar para cambiar ancho": "Drag to resize",
  "Cambiar ancho de filtros": "Resize filters",
  "Filtros": "Filters",
  "Extension": "Extension",
  "Todas": "All",
  "Carpetas": "Folders",
  "Buscar carpeta": "Search folders",
  "Limpiar busqueda de carpetas": "Clear folder search",
  "Colapsar carpeta": "Collapse folder",
  "Expandir carpeta": "Expand folder",
  "Sin coincidencias de carpeta.": "No matching folders.",
  "Sin carpetas para estos discos.": "No folders for these drives.",
  "Categorias": "Categories",
  "Nueva categoria": "New category",
  "Color": "Color",
  "Crear": "Create",
  "Etiquetas": "Tags",
  "Sin etiquetas repetidas.": "No repeated tags.",
  "Buscar por nombre o ruta": "Search by name or path",
  "Por pantalla": "Per page",
  "Elegir etiqueta": "Choose tag",
  "Añadir": "Add",
  "Quitar": "Remove",
  "Marcar para borrar": "Mark for deletion",
  "Limpiar": "Clear",
  "Seleccionar página": "Select page",
  "Archivo": "File",
  "Disco": "Drive",
  "Ruta": "Path",
  "Tamano": "Size",
  "Tamaño": "Size",
  "Duracion": "Duration",
  "Resolucion": "Resolution",
  "Modificado": "Modified",
  "Indexado": "Indexed",
  "Cargando...": "Loading...",
  "No hay archivos para estos filtros.": "No files for these filters.",
  "Anterior": "Previous",
  "Pagina": "Page",
  "Siguiente": "Next",
  "Revision aleatoria de videos pendientes de decision.": "Random review of videos waiting for a decision.",
  "Espacio a recuperar": "Recoverable space",
  "Iniciar Review": "Start Review",
  "Pendientes": "Pending",
  "Marcados hoy": "Marked today",
  "Racha semanal": "Weekly streak",
  "GB liberados": "Freed GB",
  "Pendientes de review": "Pending review",
  "No quedan videos pendientes por revisar.": "No videos left to review.",
  "Ultimos sometidos al review": "Latest reviewed",
  "Aun no hay videos sometidos al review.": "No reviewed videos yet.",
  "Cola local para copiar videos desde discos conectados usando el companion.": "Local queue for copying videos from connected drives using the companion.",
  "Procesar cola": "Process queue",
  "Reanudar": "Resume",
  "Pausar": "Pause",
  "Vaciar cola": "Clear queue",
  "Actualizar": "Refresh",
  "Cola pausada: el companion no tomara nuevas descargas hasta reanudarla.": "Queue paused: the companion will not take new downloads until resumed.",
  "En cola": "Queued",
  "Descargando": "Downloading",
  "Pendiente": "Pending",
  "Descargados": "Downloaded",
  "Selección aleatoria": "Random selection",
  "Elige un aproximado en GB y VideoCAT pondrá videos aleatorios de los discos conectados en cola.": "Choose an approximate GB amount and VideoCAT will queue random videos from connected drives.",
  "GB aproximados": "Approximate GB",
  "Elegir al azar": "Pick randomly",
  "Solo se pueden retirar pendientes o fallidos.": "Only pending or failed items can be removed.",
  "Retirar de cola": "Remove from queue",
  "Seleccionar cola retirable": "Select removable queue",
  "Estado": "Status",
  "Solicitado": "Requested",
  "Destino / error": "Destination / error",
  "No hay archivos en cola de descarga.": "No files in the download queue.",
  "Potenciales duplicados": "Potential duplicates",
  "Grupos por tamano exacto dentro de los discos conectados seleccionados.": "Groups by exact size within selected connected drives.",
  "No hay duplicados probables para estos discos.": "No probable duplicates for these drives.",
  "Tamano por folder segun el ultimo dato reportado por el agente.": "Folder size based on the latest value reported by the agent.",
  "Aun no hay datos de uso por folder.": "No folder usage data yet.",
  "Auditoria del agente": "Agent audit",
  "Errores enviados por el agente durante los escaneos.": "Errors sent by the agent during scans.",
  "Fecha": "Date",
  "Categoria": "Category",
  "Fase": "Phase",
  "Codigo": "Code",
  "Mensaje": "Message",
  "Ver error completo": "View full error",
  "No hay errores registrados para estos discos.": "No errors registered for these drives.",
  "Limpieza de contenido indexado por unidad. No borra archivos del disco externo.": "Clean indexed content by drive. This does not delete files from the external drive.",
  "Capacidad": "Capacity",
  "Ultimo indexado": "Last indexed",
  "Limpiando...": "Cleaning...",
  "Vaciar catalogo": "Clear catalog",
  "Cerrar": "Close",
  "Mensaje completo": "Full message",
  "PIN requerido": "PIN required",
  "PIN de 4 digitos": "4-digit PIN",
  "Cancelar": "Cancel",
  "Marcados para borrar": "Marked for deletion",
  "Total recuperable": "Total recoverable",
  "Calculando espacio a recuperar...": "Calculating recoverable space...",
  "Calculando...": "Calculating...",
  "No hay archivos marcados para borrar en este momento.": "There are no files marked for deletion right now.",
  "Discos recomendados": "Recommended drives",
  "Grafico de recuperacion por disco": "Recovery chart by drive",
  "Etiquetas disponibles": "Available tags",
  "Ver captura": "View frame",
  "Sin miniaturas": "No thumbnails",
  "MARCADO": "MARKED",
  "BORRAR": "DELETE",
  "MANTENER": "KEEP",
  "Captura anterior": "Previous frame",
  "Captura siguiente": "Next frame",
  "Video anterior": "Previous video",
  "Video siguiente": "Next video",
  "Reproducir video": "Play video",
  "Abrir carpeta local": "Open local folder",
  "Borrar archivo fisicamente": "Delete physical file",
  "Categoria del video": "Video category",
  "Posibles duplicados": "Possible duplicates",
  "JSON tecnico": "Technical JSON",
  "Confirmacion requerida": "Confirmation required",
  "VideoCAT le pedira al companion local que elimine este archivo en Windows.": "VideoCAT will ask the local companion to delete this file in Windows.",
  "Borrando...": "Deleting...",
  "Borrar archivo": "Delete file",
  "Intentar abrir archivo local": "Try to open local file",
  "Intentar abrir carpeta local": "Try to open local folder",
  "Copiar": "Copy",
  "Sin marcar": "Unmarked",
  "Mantener": "Keep",
  "Por revisar": "To review",
  "Marcado para borrar": "Marked for deletion",
  "Descargado": "Downloaded",
  "Falló": "Failed",
  "Duplicado probable": "Probable duplicate",
  "Raiz del disco": "Drive root",
  "Sin etiqueta": "No label"
  ,"No se pudo iniciar sesion": "Could not sign in"
  ,"Selecciona al menos un disco conectado para iniciar Review.": "Select at least one connected drive to start Review."
  ,"No quedan videos pendientes por revisar en los discos seleccionados.": "No videos left to review on the selected drives."
  ,"No se pudo calcular el espacio a recuperar": "Could not calculate recoverable space"
  ,"No se pudo enviar a descarga.": "Could not send to download."
  ,"Indica un tamaño en GB mayor a cero.": "Enter a GB size greater than zero."
  ,"Selecciona al menos un disco conectado.": "Select at least one connected drive."
  ,"No se pudo crear la cola aleatoria.": "Could not create the random queue."
  ,"Cola de descarga pausada.": "Download queue paused."
  ,"Cola de descarga reanudada.": "Download queue resumed."
  ,"No se pudo cambiar el estado de la cola.": "Could not change queue status."
  ,"No se pudo vaciar la cola.": "Could not clear the queue."
  ,"No se pudieron retirar elementos de la cola.": "Could not remove items from the queue."
  ,"Companion no iniciado o bloqueado por el navegador.": "Companion not running or blocked by the browser."
  ,"Token local no valido": "Invalid local token"
  ,"No se pudieron consultar discos conectados": "Could not query connected drives"
  ,"Companion no iniciado": "Companion not running"
  ,"No se pudo aplicar la acción por lote.": "Could not apply the batch action."
  ,"No se pudo crear la categoria": "Could not create the category"
  ,"No se pudo eliminar la categoria": "Could not delete the category"
  ,"No se pudo limpiar la unidad": "Could not clean the drive"
  ,"Archivo borrado y quitado del catalogo": "File deleted and removed from the catalog"
  ,"Abriendo video local": "Opening local video"
  ,"Abriendo carpeta local": "Opening local folder"
  ,"Disco no conectado": "Drive not connected"
  ,"No se pudo abrir localmente": "Could not open locally"
};

const esFromEn = Object.fromEntries(Object.entries(en).map(([source, target]) => [target, source]));

function preserveWhitespace(original: string, translated: string): string {
  const prefix = original.match(/^\s*/)?.[0] ?? "";
  const suffix = original.match(/\s*$/)?.[0] ?? "";
  return `${prefix}${translated}${suffix}`;
}

function translateDynamicText(text: string, language: Language): string | null {
  if (language === "es") return null;

  let match = text.match(/^(\d+) de (\d+)$/);
  if (match) return `${match[1]} of ${match[2]}`;

  match = text.match(/^de ([\d.,]+) · ([\d.,]+) archivos$/);
  if (match) return `of ${match[1]} · ${match[2]} files`;

  match = text.match(/^(\d+) seleccionado\(s\)$/);
  if (match) return `${match[1]} selected`;

  match = text.match(/^(\d+) en esta página$/);
  if (match) return `${match[1]} on this page`;

  match = text.match(/^(\d+) recientes$/);
  if (match) return `${match[1]} recent`;

  match = text.match(/^(\d+) archivos posibles$/);
  if (match) return `${match[1]} possible files`;

  match = text.match(/^([\d.,]+) archivo\(s\)$/);
  if (match) return `${match[1]} file(s)`;

  match = text.match(/^([A-Z]:|-) · ([\d.,]+) archivo\(s\) · Sin etiqueta$/);
  if (match) return `${match[1]} · ${match[2]} file(s) · No label`;

  return null;
}

export function translateText(value: string, language: Language): string {
  const trimmed = value.trim();
  if (!trimmed) return value;
  if (language === "es") return esFromEn[trimmed] ? preserveWhitespace(value, esFromEn[trimmed]) : value;

  const exact = en[trimmed];
  if (exact) return preserveWhitespace(value, exact);

  const dynamic = translateDynamicText(trimmed, language);
  return dynamic ? preserveWhitespace(value, dynamic) : value;
}

const textOriginals = new WeakMap<Text, string>();
const attributeNames = ["title", "aria-label", "placeholder"] as const;

function shouldIgnoreElement(element: Element): boolean {
  return ["SCRIPT", "STYLE", "NOSCRIPT", "CODE", "PRE", "SVG"].includes(element.tagName);
}

function localizeTextNode(node: Text, language: Language): void {
  const parent = node.parentElement;
  if (!parent || shouldIgnoreElement(parent)) return;

  const existingOriginal = textOriginals.get(node);
  const current = node.nodeValue ?? "";
  const original = existingOriginal && current === translateText(existingOriginal, language)
    ? existingOriginal
    : current;

  textOriginals.set(node, original);
  const translated = language === "es" ? original : translateText(original, language);
  if (node.nodeValue !== translated) node.nodeValue = translated;
}

function localizeElementAttributes(element: Element, language: Language): void {
  if (shouldIgnoreElement(element)) return;

  for (const attribute of attributeNames) {
    const value = element.getAttribute(attribute);
    if (!value) continue;

    const originalAttribute = `data-videocat-i18n-${attribute}`;
    const stored = element.getAttribute(originalAttribute);
    const original = stored && value === translateText(stored, language) ? stored : value;
    element.setAttribute(originalAttribute, original);

    const translated = language === "es" ? original : translateText(original, language);
    if (value !== translated) element.setAttribute(attribute, translated);
  }
}

export function localizeTree(root: ParentNode, language: Language): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current) {
    localizeTextNode(current as Text, language);
    current = walker.nextNode();
  }

  if (root instanceof Element) localizeElementAttributes(root, language);
  root.querySelectorAll?.("*").forEach((element) => localizeElementAttributes(element, language));
}

export function observeLocalization(root: ParentNode, language: Language): () => void {
  localizeTree(root, language);
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "characterData") {
        localizeTextNode(mutation.target as Text, language);
      } else if (mutation.type === "attributes" && mutation.target instanceof Element) {
        localizeElementAttributes(mutation.target, language);
      } else {
        mutation.addedNodes.forEach((node) => {
          if (node instanceof Text) localizeTextNode(node, language);
          if (node instanceof Element) localizeTree(node, language);
        });
      }
    }
  });
  observer.observe(root, {
    attributes: true,
    attributeFilter: [...attributeNames],
    characterData: true,
    childList: true,
    subtree: true
  });
  return () => observer.disconnect();
}
