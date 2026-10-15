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
  "disponible": "available",
  "Secciones principales": "Main sections",
  "Catalogo": "Catalog",
  "Catálogo": "Catalog",
  "Vista de fotogramas": "Frame view",
  "Fotograma": "Frame",
  "Galería": "Gallery",
  "Fotograma (G)": "Frame (G)",
  "Galería (G)": "Gallery (G)",
  "Todos los fotogramas": "All frames",
  "galería ·": "gallery ·",
  "Abrir, copiar y borrar archivos en esta PC requiere el token del Companion.": "Opening, copying and deleting files on this PC requires the Companion token.",
  "Acción": "Action",
  "Agrupar repetidos": "Group repeats",
  "Antigüedad": "Age",
  "Apariencia e idioma": "Appearance and language",
  "Aplicando...": "Applying...",
  "Aplicar retención ahora": "Apply retention now",
  "Borrado de archivo": "File deletion",
  "Buscar acción, objetivo o error": "Search action, target or error",
  "Buscar en la auditoría": "Search the audit",
  "Buscar mensaje, ruta o código": "Search message, path or code",
  "Cada PC se empareja con un código de un solo uso y recibe una credencial propia, cifrada y revocable.": "Each PC pairs with a one-time code and receives its own encrypted, revocable credential.",
  "Cargar más": "Load more",
  "Carpetas por tamaño": "Folders by size",
  "Categoría": "Category",
  "Cola de descarga": "Download queue",
  "Cola de descargas vaciada": "Download queue cleared",
  "Companion revocado. Tendrá que emparejarse de nuevo para conectarse.": "Companion revoked. It must pair again to connect.",
  "Completada": "Completed",
  "Completadas": "Completed",
  "Copiar código": "Copy code",
  "Credencial individual": "Individual credential",
  "Código de emparejamiento copiado.": "Pairing code copied.",
  "Código de un solo uso": "One-time code",
  "Cópialo desde la bandeja de Windows (Configuración › Token del navegador) y pégalo aquí. Se guarda solo en este navegador.": "Copy it from the Windows tray (Settings › Browser token) and paste it here. It is stored only in this browser.",
  "Discos seleccionados": "Selected drives",
  "El Companion no tomará nuevas descargas hasta reanudarla. La descarga en curso termina primero.": "The Companion won't take new downloads until you resume. The current download finishes first.",
  "El Companion puede comenzar con el siguiente archivo.": "The Companion can start the next file.",
  "El PIN desbloquea las carpetas protegidas en esta sesión.": "The PIN unlocks protected folders for this session.",
  "El PIN, los patrones y la reproducción se guardan en el servidor.": "The PIN, patterns and playback settings are saved on the server.",
  "El nuevo PIN debe tener 4 dígitos.": "The new PIN must have 4 digits.",
  "El proceso local está abierto, pero no reporta a este servidor. Revisa SERVER_URL y la credencial del Companion.": "The local process is open but doesn't report to this server. Check SERVER_URL and the Companion credential.",
  "Eliminado": "Deleted",
  "En curso": "In progress",
  "Errores del agente": "Agent errors",
  "Escaneo finalizado": "Scan finished",
  "Esta carpeta no tiene subcarpetas con videos.": "This folder has no subfolders with videos.",
  "Este navegador no permite guardar el token.": "This browser doesn't allow saving the token.",
  "Explorar subcarpetas": "Explore subfolders",
  "Exportar CSV": "Export CSV",
  "Fallida": "Failed",
  "Fallidas": "Failed",
  "Fallidos": "Failed",
  "Generar código": "Generate code",
  "Guardar cambios": "Save changes",
  "Historial de descargas limpiado": "Download history cleared",
  "La retención elimina historial antiguo. Nunca borra videos catalogados ni miniaturas.": "Retention removes old history. It never deletes catalogued videos or thumbnails.",
  "Limpiar completados": "Clear completed",
  "Limpieza por retención": "Retention cleanup",
  "Mantenimiento": "Maintenance",
  "No hay acciones registradas para estos filtros.": "No actions recorded for these filters.",
  "No hay archivos en la cola de descarga.": "No files in the download queue.",
  "No hay errores registrados para estos filtros.": "No errors recorded for these filters.",
  "No hay videos catalogados en los discos seleccionados.": "No catalogued videos on the selected drives.",
  "No se pudieron cargar más registros.": "Could not load more records.",
  "No se pudo aplicar la retención.": "Could not apply retention.",
  "No se pudo calcular el esquema de uso.": "Could not compute the usage map.",
  "No se pudo cargar la administración.": "Could not load administration.",
  "No se pudo cargar la auditoría.": "Could not load the audit.",
  "No se pudo generar el código de emparejamiento.": "Could not generate the pairing code.",
  "No se pudo limpiar la unidad.": "Could not clean the drive.",
  "No se pudo revocar el Companion.": "Could not revoke the Companion.",
  "Opciones para enviar videos a otros dispositivos.": "Options for sending videos to other devices.",
  "Primera vez": "First seen",
  "Quita de la lista las descargas completadas": "Removes completed downloads from the list",
  "Registro de acciones": "Action log",
  "Repeticiones": "Repetitions",
  "Reproducción": "Playback",
  "Reproducción remota": "Remote playback",
  "Resumen por categoría y fase": "Summary by category and phase",
  "Revocar": "Revoke",
  "Ruta de ejemplo": "Sample path",
  "Seguridad": "Security",
  "Selecciona al menos un disco para ver el esquema de uso.": "Select at least one drive to see the usage map.",
  "Selecciona al menos un disco para ver sus errores.": "Select at least one drive to see its errors.",
  "Sin archivo en curso": "No file in progress",
  "Sin datos del volumen": "No volume data",
  "Sin túnel": "No tunnel",
  "Tipo de registro": "Record type",
  "Todavía no hay Companions registrados.": "No Companions registered yet.",
  "Todo el historial": "All history",
  "Transferencia": "Transfer",
  "Túnel seguro activo": "Secure tunnel active",
  "Ubicación": "Location",
  "Uno por línea o separados por coma. Se ocultan las carpetas cuyo nombre contenga alguno de estos textos.": "One per line or comma separated. Folders whose name contains any of these texts are hidden.",
  "Uso físico reportado por el Companion y contenido catalogado. Vaciar el catálogo no borra archivos del disco.": "Physical usage reported by the Companion and catalogued content. Emptying the catalog doesn't delete files from the drive.",
  "Vaciar catálogo": "Empty catalog",
  "Ver en el catálogo": "View in catalog",
  "VideoCAT genera enlaces temporales para que un Chromecast pida el video a tu servidor. Google Cast solo se carga cuando usas esta función.": "VideoCAT creates temporary links so a Chromecast can request the video from your server. Google Cast only loads when you use this feature.",
  "VideoCAT pone en cola videos al azar de los discos conectados hasta el tamaño elegido.": "VideoCAT queues random videos from connected drives up to the chosen size.",
  "Última vez": "Last seen",
  "Últimas 24 horas": "Last 24 hours",
  "Últimos 30 días": "Last 30 days",
  "Últimos 90 días": "Last 90 days",
  "Companions": "Companions",
  "Credencial": "Credential",
  "La reproducción remota requiere un Companion sincronizado con el servidor. Ábrelo en la PC donde está conectado el disco.": "Remote playback requires a Companion synced with the server. Open it on the PC where the drive is connected.",
  "El Companion está activo, pero este disco no fue reportado como conectado. Conéctalo y actualiza los discos desde el Companion.": "The Companion is running, but this drive was not reported as connected. Connect it and refresh the drives from the Companion.",
  "El formato original no es compatible con este navegador. Usa el botón MP4 para preparar una copia temporal compatible.": "The original format is not supported by this browser. Use the MP4 button to prepare a compatible temporary copy.",
  "Este navegador no puede reproducir el formato original de este video.": "This browser cannot play this video's original format.",
  "Reproduciendo remotamente": "Playing remotely",
  "Reproducción pausada": "Playback paused",
  "Ruta relativa": "Relative path",
  "Ruta absoluta escaneada": "Scanned absolute path",
  "Tamano exacto": "Exact size",
  "Tamano del folder": "Folder size",
  "Companion local": "Local Companion",
  "Sin token en este navegador": "No token in this browser",
  "Token guardado en este navegador": "Token saved in this browser",
  "Abrir, copiar y borrar archivos en esta PC requiere el token del Companion. Cópialo desde la bandeja de Windows (Configuración › Token del navegador) y pégalo aquí. Se guarda solo en este navegador.": "Opening, copying and deleting files on this PC requires the Companion token. Copy it from the Windows tray (Settings › Browser token) and paste it here. It is stored only in this browser.",
  "Token del Companion": "Companion token",
  "Guardar token": "Save token",
  "Pega el token del Companion": "Paste the Companion token",
  "Token del Companion guardado en este navegador.": "Companion token saved in this browser.",
  "Token del Companion quitado de este navegador.": "Companion token removed from this browser.",
  "Falta el token del Companion o no es válido. Pégalo en Perfil › Companion local.": "The Companion token is missing or invalid. Paste it in Profile › Local Companion.",
  "Duplicado": "Duplicate",
  "Descargas": "Downloads",
  "Más secciones": "More sections",
  "Secciones": "Sections",
  "Cerrar menú": "Close menu",
  "Cerrar filtros": "Close filters",
  "Resolver": "Resolve",
  "Resuelto": "Resolved",
  "Recomendado ·": "Recommended ·",
  "Conecta primero": "Connect first",
  "Ver plan completo": "View full plan",
  "Salir del modo asistido": "Exit assisted mode",
  "Volver": "Back",
  "Duplicados · modo asistido": "Duplicates · assisted mode",
  "Pasa el cursor para ver los fotogramas": "Hover to preview frames",
  "Sin miniatura": "No thumbnail",
  "La copia elegida se marca para mantener y la otra para borrar. El borrado físico ocurre cuando el Companion procesa ese disco.": "The chosen copy is marked to keep and the other one for deletion. Physical deletion happens when the Companion processes that drive.",
  "recomendado ·": "recommended ·",
  "Salir del review": "Exit review",
  "Sesión de review": "Review session",
  "Mantenido": "Kept",
  "Uso por carpeta": "Folder usage",
  "Tu sesión de acceso expiró": "Your access session expired",
  "El sitio está protegido por un acceso previo (por ejemplo, Cloudflare Access) y pide iniciar sesión otra vez. Tus datos no se perdieron.": "This site is protected by an access gateway (for example Cloudflare Access) that asks you to sign in again. Your data is safe.",
  "Volver a iniciar sesión": "Sign in again",
  "Tu sesión de acceso a este sitio expiró. Vuelve a iniciar sesión para continuar.": "Your access session for this site expired. Sign in again to continue.",
  "Ruta de exploración": "Exploration path",
  "Subir": "Up",
  "Subir un nivel (Retroceso)": "Up one level (Backspace)",
  "Todas las carpetas": "All folders",
  "Ir al catálogo": "Go to catalog",
  "Abriendo carpeta…": "Opening folder…",
  "Cargando videos…": "Loading videos…",
  "No se pudo abrir la carpeta.": "The folder could not be opened.",
  "No se pudieron cargar los videos de la carpeta.": "The folder's videos could not be loaded.",
  "Carpetas pequeñas agrupadas en un solo bloque": "Small folders grouped into one block",
  "Clic: entrar en la carpeta · Clic derecho: ir al catálogo o marcar como favorita.": "Click: enter the folder · Right click: go to the catalog or mark as favorite.",
  "Las carpetas con el mismo nombre se muestran juntas, estén en el disco y en el nivel que estén. Haz clic en un bloque para entrar y explorarlo hasta sus videos; con clic derecho, ir al catálogo o marcar como favorita.": "Folders with the same name are shown together, whatever drive or level they are on. Click a block to enter it and explore down to its videos; right click to go to the catalog or mark it as favorite.",
  "Favorita": "Favorite",
  "Marcar como favorita": "Mark as favorite",
  "Quitar de favoritas": "Remove from favorites",
  "Dentro de una carpeta favorita": "Inside a favorite folder",
  "Está dentro de una carpeta favorita": "It is inside a favorite folder",
  "Marcar como favorita: sus videos nunca se ofrecen para moverse": "Mark as favorite: its videos are never offered to move",
  "Los videos de una carpeta favorita nunca se ofrecen para moverse a otra carpeta.": "Videos in a favorite folder are never offered to move to another folder.",
  "Carpeta quitada de favoritas: sus videos vuelven a poder moverse.": "Folder removed from favorites: its videos can move again.",
  "Carpeta favorita: sus videos ya no se ofrecen para moverse a otra carpeta.": "Favorite folder: its videos are no longer offered to move to another folder.",
  "No se pudo cambiar la carpeta favorita.": "The favorite folder could not be changed.",
  "En carpetas favoritas": "In favorite folders",
  "Ese archivo está en una carpeta favorita y nunca se mueve.": "That file is in a favorite folder and never moves.",
  "Parecido a una palabra clave": "Similar to a keyword",
  "Contiene una palabra clave": "Contains a keyword",
  "Cada palabra clave necesita al menos 3 letras o números.": "Each keyword needs at least 3 letters or numbers.",
  "Palabras clave": "Keywords",
  "Solo el nombre de la carpeta": "Only the folder name",
  "Editar": "Edit",
  "Agregar": "Add",
  "Guardar": "Save",
  "Nueva palabra clave": "New keyword",
  "Ej. prueba final, sesión 2": "E.g. final test, session 2",
  "No se pudieron guardar las palabras clave.": "The keywords could not be saved.",
  "Agrupar archivos también busca estas palabras, con las mismas reglas que el nombre de la carpeta (sin importar mayúsculas, acentos, puntos ni separadores, y con una letra de diferencia). Son opcionales.": "Group files also looks for these words, with the same rules as the folder name (ignoring case, accents, dots and separators, and allowing one letter of difference). They are optional.",
  "Ningún archivo de los discos tiene un nombre parecido que no esté ya en la carpeta, en otro traslado o ignorado. Puedes sumar palabras clave en Traslados › Carpetas con estrella.": "No file on the drives has a similar name that is not already in the folder, in another transfer or ignored. You can add keywords in Transfers › Starred folders.",
  "Actividad": "Activity",
  "Sin actividad en este momento": "No activity right now",
  "Sin actividad en este momento.": "No activity right now.",
  "Verificando la copia temporal": "Verifying the staging copy",
  "Verificando en el destino": "Verifying at the destination",
  "Escaneando": "Scanning",
  "Borrando": "Deleting",
  "Copiando": "Copying",
  "Verificando": "Verifying",
  "Traslado": "Transfer",
  "Descarga": "Download",
  "Escaneo": "Scan",
  "Trasladado": "Transferred",
  "Escaneo terminado": "Scan finished",
  "Últimos movimientos": "Latest movements",
  "hace un momento": "just now",
  "Todavía no se conoce el espacio libre del destino.": "The destination's free space is not known yet.",
  "Se medirá al conectarlo. Puedes crear el traslado: si no alcanza, los archivos esperan en la carpeta temporal.": "It will be measured when the drive is connected. You can create the transfer: if it does not fit, the files wait in the staging folder.",
  "Puedes crear el traslado igual: los archivos salen de su disco y esperan en la carpeta temporal; llegan cuando liberes espacio y conectes el disco.": "You can still create the transfer: the files leave their drive and wait in the staging folder; they arrive once you free space and connect the drive.",
  "Todavía no se conoce el espacio libre del destino: se medirá al conectarlo. Si no alcanza, los archivos esperarán en la carpeta temporal.": "The destination's free space is not known yet: it will be measured when the drive is connected. If it does not fit, the files will wait in the staging folder.",
  "Por ahora no hay espacio en el disco de destino. Los archivos agrupados igual salen de su disco y esperan en la carpeta temporal hasta que liberes espacio.": "There is no room on the destination drive for now. Grouped files still leave their drive and wait in the staging folder until you free space.",
  "Para continuar": "To continue",
  "No se pudieron cargar las carpetas con estrella.": "Starred folders could not be loaded.",
  "Sin informar": "Not reported",
  "Sin configurar": "Not set",
  "Configura la carpeta temporal en el Companion": "Set the staging folder in the Companion",
  "Elige una carpeta en Companion › Configuración › Archivos › Carpeta temporal de traslados. Hasta entonces los traslados no avanzan.": "Choose a folder in Companion › Settings › Files › Transfer staging folder. Until then transfers do not move.",
  "El Companion todavía no informó su carpeta temporal: actualízalo a la última versión, conéctalo y elige la carpeta en Configuración › Archivos.": "The Companion has not reported its staging folder yet: update it to the latest version, connect it and choose the folder in Settings › Files.",
  "Son las únicas que pueden recibir archivos. Desde cada una puedes consolidar sus carpetas iguales o agrupar archivos parecidos.": "They are the only folders that can receive files. From each one you can consolidate its namesakes or group similar files.",
  "Ninguna todavía. Márcalas en Uso por carpeta › Carpetas repetidas o elige una carpeta en Agrupar archivos.": "None yet. Star them in Folder usage › Repeated folders or choose a folder in Group files.",
  "Contenido": "Contents",
  "Libre en el disco": "Free on the drive",
  "Sin carpetas iguales en otros discos": "No folders with this name on other drives",
  "No hay carpetas con este nombre en otros discos": "There are no folders with this name on other drives",
  "Traer aquí el contenido de las carpetas iguales": "Bring the contents of the namesake folders here",
  "o usa Consolidar en una carpeta con estrella.": "or use Consolidate on a starred folder.",
  "Consolidaciones": "Consolidations",
  "Agrupaciones": "Groupings",
  "Sin consolidaciones todavía.": "No consolidations yet.",
  "Sin archivos agrupados todavía.": "No grouped files yet.",
  "Buscar archivos de esta carpeta en todos los discos (Agrupar archivos)": "Find this folder's files on every drive (Group files)",
  "Ese archivo ya está en esta carpeta.": "That file is already in this folder",
  "Ese archivo ya está en otro traslado.": "That file is already in another transfer",
  "Ya hay un archivo idéntico en esta carpeta; se queda para revisar en Duplicados.": "An identical file is already in this folder; it stays for review in Duplicates",
  "Nada que mover.": "Nothing to move",
  "No hay espacio suficiente en el disco de destino.": "Not enough free space on the destination drive",
  "Escanea primero el disco de destino para conocer su espacio libre.": "Scan the destination drive first so its free space is known",
  "El Companion ya empezó a mover este archivo; terminará su camino hasta la carpeta.": "The Companion already started moving this file; it will finish its way to the folder",
  "Ese archivo no está en un traslado para agrupar.": "That file is not in a grouping transfer",
  "Esta carpeta todavía tiene archivos en camino.": "This destination still has files on their way",
  "Esa carpeta no tiene videos catalogados en este disco.": "That folder has no catalogued videos on this disk",
  "Algunos archivos se agregaron a otro traslado al mismo tiempo.": "Some files were added to another transfer at the same time",
  "Salir de agrupar": "Leave grouping",
  "Sesión para agrupar archivos": "File grouping session",
  "Agrupado": "Grouped",
  "Ignorar": "Ignore",
  "Ignorado": "Ignored",
  "Este es el último archivo parecido.": "This is the last similar file.",
  "agrupar ·": "group ·",
  "ignorar ·": "ignore ·",
  "Por decidir": "To decide",
  "Agrupados": "Grouped",
  "Ignorados": "Ignored",
  "Nombre parecido": "Similar name",
  "Contiene el nombre": "Contains the name",
  "Buscando archivos parecidos…": "Looking for similar files…",
  "Ver en Traslados": "View in Transfers",
  "Ningún archivo de los discos tiene un nombre parecido que no esté ya en la carpeta, en otro traslado o ignorado.": "No file on the drives has a similar name that is not already in the folder, in another transfer or ignored.",
  "No se pudieron buscar los archivos parecidos.": "Similar files could not be searched.",
  "No se pudo deshacer.": "It could not be undone.",
  "Nombre de la carpeta destino": "Destination folder name",
  "Buscar carpeta para agrupar archivos": "Search a folder to group files into",
  "Buscando…": "Searching…",
  "Ninguna carpeta con ese nombre en el catálogo.": "No folder with that name in the catalog.",
  "Con estrella": "Starred",
  "Agrupar aquí": "Group here",
  "Escribe al menos 3 letras. La carpeta que elijas queda marcada con estrella.": "Type at least 3 letters. The folder you choose gets a star.",
  "Agrupar archivos en esta carpeta": "Group files into this folder",
  "No se pudo marcar la carpeta.": "The folder could not be starred.",
  "Busca en todos los discos archivos con un nombre parecido al de esta carpeta": "Finds files on every drive with a name similar to this folder",
  "Traslados": "Transfers",
  "Mueve videos entre discos aunque no estén conectados a la vez. Cada archivo pasa por la carpeta temporal del Companion y solo se borra de un lugar después de verificar su copia en el siguiente.": "Move videos between drives even when they are never connected at the same time. Each file goes through the Companion staging folder and is only removed from one place after its copy in the next one is verified.",
  "Consolidar carpetas": "Consolidate folders",
  "Junta en una sola las carpetas que se llaman igual en distintos discos. El contenido de las pequeñas va a la carpeta con estrella, normalmente la más grande.": "Merges folders with the same name on different drives into one. The contents of the small ones go to the starred folder, usually the largest.",
  "Ir a Uso por carpeta": "Go to Folder usage",
  "Agrupar archivos": "Group files",
  "Parte de una carpeta (ej. testing001) y busca en todos los discos archivos con nombres parecidos. Decides uno por uno, como en Review: F agrupar, J ignorar.": "Starts from a folder (e.g. testing001) and finds files with similar names on every drive. You decide one by one, like in Review: F group, J ignore.",
  "Próximamente": "Coming soon",
  "Se actualiza solo cada pocos segundos mientras el Companion trabaja.": "Updates by itself every few seconds while the Companion works.",
  "No hay traslados en curso.": "No transfers in progress.",
  "En pausa": "Paused",
  "Cancelado": "Cancelled",
  "Terminado": "Finished",
  "Consolidar": "Consolidate",
  "Agrupar": "Group",
  "Pausar": "Pause",
  "Carpeta temporal": "Staging folder",
  "El Companion todavía no informó su carpeta temporal. Actualízalo y conéctalo.": "The Companion has not reported its staging folder yet. Update it and connect it.",
  "Sin configurar. Elige una carpeta en Companion › Configuración › Archivos para que los traslados avancen.": "Not set. Choose a folder in Companion › Settings › Files so transfers can move forward.",
  "En tránsito": "In transit",
  "Disponible": "Available",
  "Reserva (5 %)": "Reserve (5 %)",
  "Carpetas con estrella": "Starred folders",
  "Ninguna todavía. Márcalas en Uso por carpeta › Carpetas repetidas.": "None yet. Star them in Folder usage › Repeated folders.",
  "Quitar estrella": "Remove star",
  "Cancelar traslado": "Cancel transfer",
  "Los archivos que aún no salieron de su disco se quedan donde están. Los que ya están en la carpeta temporal terminan su camino hasta la carpeta destino: nunca se pierden.": "Files that have not left their drive yet stay where they are. Files already in the staging folder finish their way to the destination folder: they are never lost.",
  "No se pudieron cargar los traslados.": "Transfers could not be loaded.",
  "No se pudo actualizar el traslado.": "The transfer could not be updated.",
  "No se pudo quitar la estrella.": "The star could not be removed.",
  "No se pudo cambiar la carpeta destino.": "The destination folder could not be changed.",
  "No se pudo preparar el plan.": "The plan could not be prepared.",
  "No se pudo crear el traslado.": "The transfer could not be created.",
  "Esperando el disco de origen": "Waiting for the source drive",
  "Copiando a la carpeta temporal": "Copying to the staging folder",
  "Verificado en la carpeta temporal": "Verified in the staging folder",
  "Esperando el disco de destino": "Waiting for the destination drive",
  "Sin espacio en el destino": "No space at the destination",
  "Copiando al destino": "Copying to the destination",
  "Verificado en el destino": "Verified at the destination",
  "Listo": "Done",
  "Ya estaba en el destino": "Already at the destination",
  "Por trasladar": "To transfer",
  "Sin espacio": "No space",
  "Quitar estrella: deja de recibir archivos": "Remove star: stops receiving files",
  "Marcar con estrella: esta carpeta puede recibir archivos": "Star: this folder can receive files",
  "Excluye nombres genéricos (como RAW o 2019) para verlos por separado. Marca con estrella la carpeta que debe recibir el contenido de las demás.": "Exclude generic names (such as RAW or 2019) to see them separately. Star the folder that should receive the contents of the others.",
  "Los archivos salen de cada carpeta, esperan verificados en la carpeta temporal del Companion y llegan a la carpeta con estrella cuando conectes su disco. Nada se borra sin una copia verificada en otro lugar.": "Files leave each folder, wait verified in the Companion staging folder and reach the starred folder when you connect its drive. Nothing is removed without a verified copy somewhere else.",
  "Calculando el plan…": "Working out the plan…",
  "Desde": "From",
  "Nada que mover": "Nothing to move",
  "A mover": "To move",
  "Libre en el destino": "Free at the destination",
  "Sin escanear": "Not scanned",
  "Ya están en el destino": "Already at the destination",
  "En otro traslado": "In another transfer",
  "No hay nada que mover.": "There is nothing to move.",
  "Todo ya está en la carpeta destino o en otro traslado.": "Everything is already in the destination folder or in another transfer.",
  "Escanea primero el disco de destino.": "Scan the destination drive first.",
  "Se necesita su espacio libre para saber si cabe.": "Its free space is needed to know whether everything fits.",
  "Falta la carpeta temporal en el Companion.": "The Companion has no staging folder.",
  "Configúrala en Companion › Configuración › Archivos. Puedes crear el traslado ahora; empezará cuando esté configurada.": "Set it in Companion › Settings › Files. You can create the transfer now; it starts once the folder is set.",
  "El Companion siempre deja libre el 5 % de ese disco; los archivos irán pasando por partes: cuando unos llegan al destino, entran los siguientes.": "The Companion always keeps 5 % of that drive free; files will go through in batches: when some reach the destination, the next ones come in.",
  "Crear traslado": "Create transfer",
  "Creando…": "Creating…",
  "Las carpetas con el mismo nombre se muestran juntas, estén en el disco y en el nivel que estén. Haz clic en cualquier bloque para ver su contenido en el catálogo.": "Folders with the same name are shown together, whatever drive or level they are on. Click any block to see its contents in the catalog.",
  "Selecciona al menos un disco para ver el uso por carpeta.": "Select at least one drive to see folder usage.",
  "No se pudo calcular el uso por carpeta.": "Folder usage could not be calculated.",
  "Pasa el cursor por un bloque para ver su ruta y sus ubicaciones.": "Hover over a block to see its path and locations.",
  "Carpetas repetidas": "Repeated folders",
  "Excluye nombres genéricos (como RAW o 2019) para verlos por separado.": "Exclude generic names (such as RAW or 2019) to see them separately.",
  "Buscar carpeta repetida": "Search repeated folders",
  "No hay carpetas con el mismo nombre en los discos seleccionados.": "There are no folders with the same name on the selected drives.",
  "Ninguna carpeta coincide con la búsqueda.": "No folder matches the search.",
  "Sin agrupar": "Not merged",
  "Ver en catálogo": "View in catalog",
  "Agrupar de nuevo": "Merge again",
  "No agrupar": "Don't merge",
  "No se pudo guardar la exclusión.": "The exclusion could not be saved.",
  "Archivos sueltos": "Loose files",
  "Actualizando…": "Updating…",
  "Modo privacidad": "Privacy mode",
  "Modo privacidad (Espacio)": "Privacy mode (Space)",
  "Salir del modo privacidad": "Leave privacy mode",
  "privacidad ·": "privacy ·",
  "Instalar app": "Install app",
  "App de VideoCAT": "VideoCAT app",
  "Instálala en el móvil o la PC para abrirla desde su propio ícono, en una ventana sin pestañas.": "Install it on your phone or PC to open it from its own icon, in a window without tabs.",
  "Estás usando VideoCAT como app instalada.": "You are using VideoCAT as an installed app.",
  "Para instalarla, abre VideoCAT con HTTPS. Los navegadores solo permiten instalar apps desde sitios seguros o desde localhost.": "To install it, open VideoCAT over HTTPS. Browsers only install apps from secure sites or from localhost.",
  "Instalar VideoCAT": "Install VideoCAT",
  "Se abre en su propia ventana y se actualiza sola con cada versión del servidor.": "It opens in its own window and updates itself with every server version.",
  "Instalando VideoCAT…": "Installing VideoCAT…",
  "Instalación cancelada. Puedes instalarla cuando quieras.": "Installation cancelled. You can install it whenever you like.",
  "Hay una nueva versión de VideoCAT.": "A new version of VideoCAT is available.",
  "Más tarde": "Later",
  "Sin conexión. VideoCAT necesita llegar a tu servidor para mostrar el catálogo y guardar cambios.": "You are offline. VideoCAT needs to reach your server to show the catalog and save changes.",
  "Usa el ícono Instalar de la barra de direcciones o el menú del navegador › Instalar VideoCAT.": "Use the Install icon in the address bar or the browser menu › Install VideoCAT.",
  "Toca Compartir y luego Agregar a pantalla de inicio.": "Tap Share, then Add to Home Screen.",
  "En Safari, elige Archivo › Añadir al Dock.": "In Safari, choose File › Add to Dock.",
  "En Firefox 143 o posterior, usa el ícono Añadir a la barra de tareas, a la derecha de la barra de direcciones.": "In Firefox 143 or later, use the Add to taskbar icon to the right of the address bar.",
  "Abre el menú de Firefox y elige Instalar.": "Open the Firefox menu and choose Install.",
  "Firefox solo instala apps en Windows y Android. En este equipo usa Chrome, Edge o Safari.": "Firefox only installs apps on Windows and Android. On this device use Chrome, Edge or Safari.",
  "Busca Instalar o Agregar a pantalla de inicio en el menú del navegador.": "Look for Install or Add to Home Screen in the browser menu.",
  "Saltado": "Skipped",
  "Deshacer": "Undo",
  "en esta sesión": "this session",
  "Video actual": "Current video",
  "Ver fotograma en grande": "View frame full size",
  "Fotograma anterior": "Previous frame",
  "Pausar fotogramas": "Pause frames",
  "Reproducir fotogramas": "Play frames",
  "Fotograma siguiente": "Next frame",
  "Pantalla completa": "Full screen",
  "Pantalla completa (P)": "Full screen (P)",
  "Fotogramas": "Frames",
  "Saltar": "Skip",
  "Etiquetar": "Tag",
  "Información": "Information",
  "Hoy": "Today",
  "Últimos 7 días": "Last 7 days",
  "Marcado en la sesión": "Marked this session",
  "Siguiente · precargado": "Next · preloaded",
  "Este es el último pendiente en los discos seleccionados.": "This is the last pending video on the selected drives.",
  "Preparando el siguiente video…": "Preparing the next video…",
  "Decisiones de la sesión": "Session decisions",
  "Todavía no tomaste decisiones.": "No decisions yet.",
  "Borrar": "Delete",
  "mantener ·": "keep ·",
  "borrar ·": "delete ·",
  "saltar ·": "skip ·",
  "deshacer ·": "undo ·",
  "fotogramas ·": "frames ·",
  "reproducir ·": "play ·",
  "pantalla completa ·": "full screen ·",
  "salir": "exit",
  "deshacer": "undo",
  "Espacio": "Space",
  "Review aleatorio": "Random review",
  "Decide qué conservar y qué borrar, un video a la vez, en los discos seleccionados.": "Decide what to keep and what to delete, one video at a time, on the selected drives.",
  "Progreso del review": "Review progress",
  "Últimos revisados": "Recently reviewed",
  "No hay otro video pendiente para mostrar.": "There is no other pending video to show.",
  "No se pudo deshacer: el archivo ya no está en el catálogo.": "Could not undo: the file is no longer in the catalog.",
  "No se pudo cargar otro video.": "Could not load another video.",
  "Ordenar": "Sort",
  "Por página": "Per page",
  "Vista": "View",
  "Cuadrícula": "Grid",
  "Lista": "List",
  "Seleccionar": "Select",
  "Cerrar detalle": "Close details",
  "Categorías": "Categories",
  "Resolución": "Resolution",
  "Duración": "Duration",
  "Formato": "Format",
  "Carpeta": "Folder",
  "Más información": "More information",
  "Códec": "Codec",
  "Resultados": "Results",
  "Quitar filtro": "Remove filter",
  "Limpiar filtros": "Clear filters",
  "Detalle del video": "Video details",
  "Reproducir remotamente": "Play remotely",
  "Buscar en el catálogo": "Search the catalog",
  "Mostrar u ocultar filtros": "Show or hide filters",
  "Modificados recientes": "Recently modified",
  "Modificados antiguos": "Oldest modified",
  "Indexados recientes": "Recently indexed",
  "Nombre A–Z": "Name A–Z",
  "Nombre Z–A": "Name Z–A",
  "Más grandes": "Largest",
  "Más pequeños": "Smallest",
  "Más largos": "Longest",
  "Más cortos": "Shortest",
  "navegar ·": "browse ·",
  "cerrar": "close",
  "Tema e idioma": "Theme and language",
  "Auditoría": "Audit",
  "Administración": "Administration",
  "Navegación": "Navigation",
  "Cuenta": "Account",
  "Contraer": "Collapse",
  "Contraer barra lateral": "Collapse sidebar",
  "Expandir barra lateral": "Expand sidebar",
  "Tema": "Theme",
  "Personalizar tema": "Customize theme",
  "Apariencia": "Appearance",
  "Sistema": "System",
  "Claro": "Light",
  "Oscuro": "Dark",
  "Esquema de color": "Color scheme",
  "Naranja CAT": "CAT Orange",
  "Cobalto": "Cobalt",
  "Esmeralda": "Emerald",
  "Uva": "Grape",
  "Rosa": "Pink",
  "Grafito": "Graphite",
  "Densidad": "Density",
  "Cómoda": "Comfortable",
  "Compacta": "Compact",
  "Se guarda en este navegador. «Sistema» sigue la preferencia del dispositivo.": "Saved in this browser. “System” follows your device preference.",
  "Discos para descargar": "Drives to download from",
  "Resumen del catálogo": "Catalog summary",
  "Revisar →": "Review →",
  "Conectado al Companion": "Connected to the Companion",
  "No detectado por el Companion": "Not detected by the Companion",
  "Sin datos de capacidad": "No capacity data",
  "Sin datos": "No data",
  "A descargar": "To download",
  "Duplicados": "Duplicates",
  "Iniciar modo asistido": "Start assisted mode",
  "Discos prioritarios": "Priority drives",
  "Plan de liberación": "Space recovery plan",
  "Listo para borrar": "Ready to delete",
  "Pendiente de decidir": "Waiting for a decision",
  "Potencial total": "Total potential",
  "La prioridad favorece archivos ya marcados para borrar y luego el mayor espacio potencial entre duplicados. No se borrará nada desde esta pantalla.": "Priority goes first to files already marked for deletion, then to the greatest potential duplicate space. Nothing is deleted from this screen.",
  "Calculando discos prioritarios...": "Calculating priority drives...",
  "No hay espacio duplicado atribuible a los discos seleccionados.": "No duplicate space can be attributed to the selected drives.",
  "Sin letra reportada": "No drive letter reported",
  "Conectar primero": "Connect first",
  "Recuperable": "Recoverable",
  "Ya marcado": "Already marked",
  "grupos": "groups",
  "archivos candidatos": "candidate files",
  "Revisión asistida de duplicados": "Assisted duplicate review",
  "Mantener este": "Keep this one",
  "Recomendado": "Recommended",
  "Mayor resolución": "Higher resolution",
  "Mayor tamaño de archivo": "Larger file size",
  "Mayor duración": "Longer duration",
  "Mejor opción por consistencia": "Best option by stable ordering",
  "El elegido se marcará para mantener; el otro quedará marcado para borrar.": "The selected file will be kept; the other will be marked for deletion.",
  "Omitir este grupo": "Skip this group",
  "No quedan grupos de duplicados pendientes de decisión.": "No duplicate groups are waiting for a decision.",
  "Revisión asistida completada.": "Assisted review completed.",
  "No quedan más grupos en esta sesión.": "No more groups remain in this session.",
  "No se pudo guardar la decisión.": "Could not save the decision.",
  "Esquema de uso": "Usage map",
  "Auditoria": "Audit",
  "Administracion": "Administration",
  "Companions autorizados": "Authorized Companions",
  "Cada equipo puede usar una credencial individual, cifrada localmente y revocable.": "Each computer can use its own locally encrypted, revocable credential.",
  "Generar codigo": "Generate code",
  "Codigo de un solo uso": "One-time code",
  "Copiar codigo": "Copy code",
  "Codigo de emparejamiento copiado.": "Pairing code copied.",
  "Individual": "Individual",
  "Token heredado": "Legacy token",
  "Revocado": "Revoked",
  "Revocar Companion": "Revoke Companion",
  "¿Revocar acceso?": "Revoke access?",
  "Sí": "Yes",
  "No": "No",
  "Todavia no hay Companion registrados.": "No Companions have been registered yet.",
  "Uso físico": "Physical usage",
  "Sin reporte": "Not reported",
  "Usado": "Used",
  "Libre": "Free",
  "Total": "Total",
  "Catalogado": "Cataloged",
  "Videos presentes": "Present videos",
  "No encontrados": "Missing",
  "Escaneos": "Scans",
  "Errores": "Errors",
  "Actividad reciente": "Recent activity",
  "Desconectado": "Disconnected",
  "Sin actividad registrada.": "No recorded activity.",
  "Perfil": "Profile",
  "Más": "More",
  "Perfil y seguridad": "Profile and security",
  "Seguridad, carpetas privadas y preferencias de reproducción.": "Security, private folders, and playback preferences.",
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
  "Permitir reproducción en Chromecast": "Allow Chromecast playback",
  "Al activarlo, VideoCAT podrá generar enlaces temporales para que un Chromecast solicite el video a tu servidor. Google Cast solo se cargará cuando uses esta función.": "When enabled, VideoCAT may generate temporary links so a Chromecast can request the video from your server. Google Cast is loaded only when you use this feature.",
  "Reproducir en Chromecast": "Play on Chromecast",
  "Activa Chromecast en Perfil antes de compartir un flujo de video.": "Enable Chromecast in Profile before sharing a video stream.",
  "Preparando un enlace temporal para Chromecast...": "Preparing a temporary Chromecast link...",
  "No se pudo iniciar Chromecast.": "Could not start Chromecast.",
  "Cerrar sesion": "Sign out",
  "Salir": "Sign out",
  "Usuario": "Username",
  "Contrasena": "Password",
  "Entrar": "Sign in",
  "Discos conectados": "Connected drives",
  "Mostrar conectados": "Show connected",
  "Detectando...": "Detecting...",
  "Expandir discos conectados": "Expand connected drives",
  "Colapsar discos conectados": "Collapse connected drives",
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
  "Regenerar miniaturas": "Regenerate thumbnails",
  "Galería de capturas": "Screenshot gallery",
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
  "Últimos borrados": "Recent deletions",
  "Review y companion": "Review and companion",
  "Borrados": "Deleted",
  "Espacio liberado": "Freed space",
  "Procesar pendientes": "Process pending",
  "Enviando...": "Sending...",
  "Actualizando...": "Refreshing...",
  "El companion no está conectado. Los borrados pendientes se conservarán hasta que vuelva a estar activo.": "The companion is offline. Pending deletions will be kept until it is active again.",
  "El companion está activo, pero no reporta discos conectados.": "The companion is active, but it reports no connected drives.",
  "Cargando historial de borrados...": "Loading deletion history...",
  "Aún no hay borrados ni archivos pendientes registrados.": "There are no recorded deletions or pending files yet.",
  "Borrado": "Deleted",
  "Ya ausente": "Already missing",
  "Fallido": "Failed",
  "Conectado": "Connected",
  "No conectado": "Not connected",
  "El historial detallado se conserva para los borrados realizados a partir de esta actualización.": "Detailed history is retained for deletions completed after this update.",
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
  "Abre el Companion de Windows para detectar discos y procesar esta cola.": "Open the Windows Companion to detect drives and process this queue.",
  "Sin discos conectados": "No connected drives",
  "Procesar cola": "Process queue",
  "Reanudar": "Resume",
  "Detener": "Stop",
  "Vaciar cola": "Clear queue",
  "Eliminar cola": "Clear completed",
  "Eliminar historial completado": "Clear completed history",
  "Eliminar historial de descargas": "Clear download history",
  "Esto eliminara los elementos completados del historial de descargas.": "This will remove completed items from the download history.",
  "No borra archivos copiados, videos originales ni etiquetas de descarga.": "It does not delete copied files, original videos, or download tags.",
  "Actualizar": "Refresh",
  "Cola pausada: el companion no tomara nuevas descargas hasta reanudarla.": "Queue paused: the companion will not take new downloads until resumed.",
  "En cola": "Queued",
  "Descargando": "Downloading",
  "Pendiente": "Pending",
  "Descargados": "Downloaded",
  "Transferencia activa": "Active transfer",
  "Resumen de transferencias": "Transfer overview",
  "Cola detenida": "Queue stopped",
  "Lista para procesar": "Ready to process",
  "Sin transferencias pendientes": "No pending transfers",
  "La descarga actual terminará antes de detener la cola.": "The current download will finish before the queue stops.",
  "El companion puede comenzar con el siguiente archivo.": "The companion can start the next file.",
  "Añade videos a la cola para comenzar una transferencia.": "Add videos to the queue to begin a transfer.",
  "Progreso del archivo": "File progress",
  "Velocidad reciente": "Recent speed",
  "Velocidad reciente de transferencia": "Recent transfer speed",
  "Últimas 30 muestras": "Last 30 samples",
  "Tiempo restante": "Time remaining",
  "ETA del archivo": "File ETA",
  "ETA de la cola": "Queue ETA",
  "Resta en este archivo": "Remaining in this file",
  "Cola restante": "Remaining queue",
  "Selección aleatoria": "Random selection",
  "Elige un aproximado en GB y VideoCAT pondrá videos aleatorios de los discos conectados en cola.": "Choose an approximate GB amount and VideoCAT will queue random videos from connected drives.",
  "GB aproximados": "Approximate GB",
  "Elegir al azar": "Pick randomly",
  "Carpetas para la selección": "Folders for selection",
  "Sin selección se usarán todas las carpetas disponibles.": "With no selection, all available folders will be used.",
  "Usar todas": "Use all",
  "Solo se pueden retirar pendientes o fallidos.": "Only pending or failed items can be removed.",
  "Retirar de cola": "Remove from queue",
  "Seleccionar cola retirable": "Select removable queue",
  "Estado": "Status",
  "Solicitado": "Requested",
  "Destino / error": "Destination / error",
  "No hay archivos en cola de descarga.": "No files in the download queue.",
  "Potenciales duplicados": "Potential duplicates",
  "Coincidencias por huella visual, duración y tamaño dentro de los discos seleccionados.": "Matches by visual fingerprint, duration and size across the selected drives.",
  "Coincidencia visual": "Visual match",
  "Coincidencia mixta": "Mixed match",
  "Mismo tamaño": "Same size",
  "Contenido visual coincidente": "Matching visual content",
  "Duración coincidente": "Matching duration",
  "Resolución o compresión diferente": "Different resolution or compression",
  "recuperables": "recoverable",
  "de confianza": "confidence",
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
  "Activar reproducción aleatoria": "Enable shuffle playback",
  "Desactivar reproducción aleatoria": "Disable shuffle playback",
  "Reproducir otro video al azar": "Play another random video",
  "Eligiendo otro video al azar...": "Choosing another random video...",
  "No hay discos conectados disponibles para elegir otro video al azar.": "No connected drives are available to choose another random video.",
  "No se pudo elegir otro video al azar.": "Could not choose another random video.",
  "Companion desconectado": "Companion is offline",
  "No hay discos conectados disponibles": "No connected disks are available",
  "No hay otro video reproducible disponible en los discos conectados": "No other playable video is available on connected disks",
  "No hay videos reproducibles disponibles en los discos conectados": "No playable video is available on connected disks",
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
  ,"No se pudo eliminar el historial de descargas.": "Could not clear the download history."
  ,"No se pudieron retirar elementos de la cola.": "Could not remove items from the queue."
  ,"Companion no iniciado o bloqueado por el navegador.": "Companion not running or blocked by the browser."
  ,"Token local no valido": "Invalid local token"
  ,"No se pudieron consultar discos conectados": "Could not query connected drives"
  ,"Companion no iniciado": "Companion not running"
  ,"Companion sin sincronizar": "Companion not synchronized"
  ,"Actualización requerida": "Update required"
  ,"Agente sincronizado": "Agent synchronized"
  ,"Agente sincronizado; actualización requerida": "Agent synchronized; update required"
  ,"Agente abierto localmente, sin sincronizar": "Agent running locally, not synchronized"
  ,"Companion no iniciado. Abre el Companion para detectar discos y procesar descargas.": "Companion not running. Open the Companion to detect drives and process downloads."
  ,"Companion abierto localmente, pero no está sincronizado con este servidor. Revisa SERVER_URL y AGENT_TOKEN.": "Companion is running locally, but it is not synchronized with this server. Check SERVER_URL and AGENT_TOKEN."
  ,"El Companion está sincronizado, pero necesita actualizarse para reportar qué discos están conectados.": "The Companion is synchronized, but it must be updated to report which drives are connected."
  ,"El Companion reporta discos conectados, pero no coinciden con este catálogo. Revisa SERVER_URL y vuelve a escanearlos.": "The Companion reports connected drives, but they do not match this catalog. Check SERVER_URL and scan them again."
  ,"Companion sincronizado. No hay discos VideoCAT conectados en este momento.": "Companion synchronized. No VideoCAT drives are connected right now."
  ,"El proceso local está abierto, pero no reporta a este servidor. Revisa SERVER_URL y AGENT_TOKEN.": "The local process is running, but it is not reporting to this server. Check SERVER_URL and AGENT_TOKEN."
  ,"Instala la versión más reciente del Companion para reportar los discos conectados.": "Install the latest Companion version to report connected drives."
  ,"El Companion no está en ejecución o no está sincronizado con VideoCAT.": "The Companion is not running or is not synchronized with VideoCAT."
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

// Transfer state labels that appear as "label: count".
const transferStateTexts = new Set([
  "Esperando el disco de origen",
  "Copiando a la carpeta temporal",
  "Verificado en la carpeta temporal",
  "Esperando el disco de destino",
  "Sin espacio en el destino",
  "Copiando al destino",
  "Verificado en el destino",
  "Ya estaba en el destino",
  "Cancelado"
]);

function translateDynamicText(text: string, language: Language): string | null {
  if (language === "es") return null;

  let match = text.match(/^(\d+) de (\d+)$/);
  if (match) return `${match[1]} of ${match[2]}`;

  match = text.match(/^([\d.,\s]+) de ([\d.,\s]+) discos seleccionados$/);
  if (match) return `${match[1]} of ${match[2]} drives selected`;

  match = text.match(/^([\d.,\s]+) pendientes$/);
  if (match) return `${match[1]} pending`;

  match = text.match(/^([\d.,\s]+) videos? pendientes?$/);
  if (match) return `${match[1]} pending ${match[1].trim() === "1" ? "video" : "videos"}`;

  match = text.match(/^Ver fotograma (\d+) en grande$/);
  if (match) return `View frame ${match[1]} full size`;

  match = text.match(/^Fotograma (\d+)$/);
  if (match) return `Frame ${match[1]}`;

  match = text.match(/^([\d.,\s]+) carpetas iguales en otros discos · (.+)$/);
  if (match) return `${match[1]} namesake folders on other drives · ${match[2]}`;

  match = text.match(/^1 carpeta igual en otros discos · (.+)$/);
  if (match) return `1 namesake folder on another drive · ${match[1]}`;

  match = text.match(/^(.+) disponibles · reserva 5 %$/);
  if (match) return `${match[1]} available · 5 % reserve`;

  match = text.match(/^(.+) · ([\d.,\s]+) videos$/);
  if (match) return `${match[1]} · ${match[2]} videos`;

  match = text.match(/^Agrupar archivos en (.+)$/);
  if (match) return `Group files into ${match[1]}`;

  match = text.match(/^Agrupar en (.+)$/);
  if (match) return `Group into ${match[1]}`;

  match = text.match(/^Destino: (.+)$/);
  if (match) return `Destination: ${match[1]}`;

  match = text.match(/^No hay archivos para agrupar en (.+)$/);
  if (match) return `No files to group into ${match[1]}`;

  match = text.match(/^Terminaste con (.+)$/);
  if (match) return `You are done with ${match[1]}`;

  match = text.match(/^En esta sesión · agrupados: ([\d.,\s]+) \((.+)\) · ignorados: ([\d.,\s]+)$/);
  if (match) return `This session · grouped: ${match[1]} (${match[2]}) · ignored: ${match[3]}`;

  match = text.match(/^Hay una carpeta (.+) más grande en (.+) \((.+)\)\. Conviene agrupar ahí\.$/);
  if (match) return `There is a larger ${match[1]} folder on ${match[2]} (${match[3]}). Grouping there is better.`;

  match = text.match(/^([\d.,\s]+) ya tienen una copia idéntica en la carpeta y se quedan para revisar en Duplicados\.$/);
  if (match) return `${match[1]} already have an identical copy in the folder and stay for review in Duplicates.`;

  match = text.match(/^Faltará espacio en (.+)$/);
  if (match) return `Space will run short on ${match[1]}`;

  match = text.match(/^Hoy no cabe en (.+): faltan (.+)\.$/);
  if (match) return `It does not fit on ${match[1]} today: ${match[2]} missing.`;

  match = text.match(/^([\d.,\s]+) (?:archivo|archivos) · (.+?) van hacia este disco y, según su último escaneo, faltan (.+?)\. Igual salen de su disco y esperan en la carpeta temporal; llegan cuando liberes espacio\.$/);
  if (match) return `${match[1]} ${match[1].trim() === "1" ? "file" : "files"} · ${match[2]} are headed to this drive and, by its last scan, ${match[3]} is missing. They still leave their drive and wait in the staging folder; they arrive once you free space.`;

  match = text.match(/^(Copiando|Verificando|Descargando|Escaneando|Borrando)( [\d]+ %)?( · \+\d+)?$/);
  if (match) return `${({ Copiando: "Copying", Verificando: "Verifying", Descargando: "Downloading", Escaneando: "Scanning", Borrando: "Deleting" } as Record<string, string>)[match[1]]}${match[2] ?? ""}${match[3] ?? ""}`;

  match = text.match(/^(Traslado|Descarga|Escaneo|Borrado) · (.+)$/);
  if (match && en[match[2]]) return `${en[match[1]]} · ${en[match[2]]}`;

  match = text.match(/^Actividad: (.+)$/);
  if (match) return `Activity: ${match[1]}`;

  match = text.match(/^([\d.,\s]+) en traslado$/);
  if (match) return `${match[1]} in transfer`;

  match = text.match(/^([\d.,\s]+) en cola de descarga$/);
  if (match) return `${match[1]} in the download queue`;

  match = text.match(/^hace (\d+) (min|h|d)$/);
  if (match) return `${match[1]} ${match[2]} ago`;

  match = text.match(/^(Trasladado|Ya estaba en el destino|Descargado|Borrado|Escaneo terminado) · ([\d.,]+\s?[KMGTP]?B)$/);
  if (match) return `${en[match[1]]} · ${match[2]}`;

  match = text.match(/^(.+) · (hace un momento|hace \d+ (?:min|h|d))$/);
  if (match) return `${translateText(match[1], "en")} · ${translateText(match[2], "en")}`;

  match = text.match(/^Palabra clave: (.+)$/);
  if (match) return `Keyword: ${match[1]}`;

  match = text.match(/^Quitar (.+)$/);
  if (match) return `Remove ${match[1]}`;

  match = text.match(/^Marcar como favorita \(([\d.,]+) ubicaciones\)$/);
  if (match) return `Mark as favorite (${match[1]} locations)`;

  match = text.match(/^Carpeta favorita: sus videos ya no se mueven\. ([\d.,]+) (?:archivo salió|archivos salieron) de traslados que aún no habían empezado\.$/);
  if (match) return `Favorite folder: its videos no longer move. ${match[1]} ${match[1] === "1" ? "file left" : "files left"} transfers that had not started yet.`;

  match = text.match(/^([\d.,\s]+) no se mueven$/);
  if (match) return `${match[1]} do not move`;

  match = text.match(/^([\d.,\s]+) están en carpetas favoritas y no se ofrecen\.$/);
  if (match) return `${match[1]} are in favorite folders and are not offered.`;

  match = text.match(/^([\d.,\s]+) videos · (.+?) · se muestran los ([\d.,\s]+) más grandes\. Clic: abrir el video\.$/);
  if (match) return `${match[1]} videos · ${match[2]} · showing the ${match[3]} largest. Click: open the video.`;

  match = text.match(/^([\d.,\s]+) videos · (.+?)\. Clic: abrir el video; clic derecho: ir al catálogo\.$/);
  if (match) return `${match[1]} videos · ${match[2]}. Click: open the video; right click: go to the catalog.`;

  match = text.match(/^Libera espacio en (.+)$/);
  if (match) return `Free up space on ${match[1]}`;

  match = text.match(/^Conecta (.+) para continuar$/);
  if (match) return `Connect ${match[1]} to continue`;

  match = text.match(/^(.+) conectado: entregando archivos$/);
  if (match) return `${match[1]} connected: delivering files`;

  match = text.match(/^(.+) conectado: copiando archivos$/);
  if (match) return `${match[1]} connected: copying files`;

  match = text.match(/^([\d.,\s]+) (?:archivo|archivos) · (.+?) esperando en la carpeta temporal\. Borra o mueve contenido de ese disco desde Review o Duplicados\.$/);
  if (match) return `${match[1]} ${match[1].trim() === "1" ? "file" : "files"} · ${match[2]} waiting in the staging folder. Delete or move content on that drive from Review or Duplicates.`;

  match = text.match(/^([\d.,\s]+) (?:archivo|archivos) · (.+?) esperando en la carpeta temporal del Companion\.$/);
  if (match) return `${match[1]} ${match[1].trim() === "1" ? "file" : "files"} · ${match[2]} waiting in the Companion staging folder.`;

  match = text.match(/^([\d.,\s]+) (?:archivo|archivos) · (.+?) por copiar desde este disco\.$/);
  if (match) return `${match[1]} ${match[1].trim() === "1" ? "file" : "files"} · ${match[2]} to copy from this drive.`;

  match = text.match(/^([\d.,\s]+) de ([\d.,\s]+) archivos · (.+) de (.+)$/);
  if (match) return `${match[1]} of ${match[2]} files · ${match[3]} of ${match[4]}`;

  match = text.match(/^(.+): ([\d.,\s]+)$/);
  if (match && transferStateTexts.has(match[1])) return `${en[match[1]]}: ${match[2]}`;

  match = text.match(/^(.+) · destino: (.+)$/);
  if (match) return `${en[match[1]] ?? match[1]} · destination: ${match[2]}`;

  match = text.match(/^(.+) · ([\d.,\s]+) reintentos$/);
  if (match) return `${en[match[1]] ?? match[1]} · ${match[2]} retries`;

  match = text.match(/^Consolidar en (.+)$/);
  if (match) return `Consolidate on ${match[1]}`;

  match = text.match(/^Llevar todo a (.+)$/);
  if (match) return `Move everything to ${match[1]}`;

  match = text.match(/^([\d.,\s]+) videos · (.+)$/);
  if (match && /^[\d.,]+\s?[KMGTP]?B$/.test(match[2].trim())) return `${match[1]} videos · ${match[2]}`;

  match = text.match(/^([\d.,\s]+) se quedan para revisar en Duplicados$/);
  if (match) return `${match[1]} stay for review in Duplicates`;

  match = text.match(/^No cabe en (.+)\.$/);
  if (match) return `It does not fit on ${match[1]}.`;

  match = text.match(/^Faltan (.+)\. Libera espacio en ese disco y vuelve a escanearlo\.$/);
  if (match) return `${match[1]} missing. Free up space on that drive and scan it again.`;

  match = text.match(/^La carpeta temporal tiene (.+) disponibles\.$/);
  if (match) return `The staging folder has ${match[1]} available.`;

  match = text.match(/^La ubicación más grande es (.+?): (.+) \((.+)\)\. Conviene que la estrella esté ahí para mover menos datos\.$/);
  if (match) return `The largest location is ${match[1]}: ${match[2]} (${match[3]}). Starring it means less data has to move.`;

  match = text.match(/^Companion: (.+)$/);
  if (match) return `Companion: ${match[1]}`;

  match = text.match(/^([\d.,\s]+) carpetas agrupadas$/);
  if (match) return `${match[1]} merged folders`;

  match = text.match(/^([\d.,\s]+) carpetas? más$/);
  if (match) return `${match[1]} more ${match[1].trim() === "1" ? "folder" : "folders"}`;

  match = text.match(/^Raíz de (.+)$/);
  if (match) return `${match[1]} root`;

  match = text.match(/^Carpeta: (.+?) \(([\d.,]+) ubicaciones\)$/);
  if (match) return `Folder: ${match[1]} (${match[2]} locations)`;

  match = text.match(/^Carpeta: (.+)$/);
  if (match) return `Folder: ${match[1]}`;

  match = text.match(/^(.+?) · ([\d.,\s]+) videos · ([\d.,]+) ubicaciones$/);
  if (match) return `${match[1]} · ${match[2]} videos · ${match[3]} locations`;

  match = text.match(/^Carpeta (.+)$/);
  if (match) return `Folder ${match[1]}`;

  match = text.match(/^([\d.,\s]+) grupos? · (.+) recuperables$/);
  if (match) return `${match[1]} ${match[1].trim() === "1" ? "group" : "groups"} · ${match[2]} recoverable`;

  match = text.match(/^([\d.,]+ [KMGT]?B) recuperables$/);
  if (match) return `${match[1]} recoverable`;

  match = text.match(/^(.+) recuperables en el grupo$/);
  if (match) return `${match[1]} recoverable in this group`;

  match = text.match(/^(\d+)% de confianza$/);
  if (match) return `${match[1]}% confidence`;

  match = text.match(/^Mantener ([AB]) · borrar ([AB])$/);
  if (match) return `Keep ${match[1]} · delete ${match[2]}`;

  match = text.match(/^Marcado ([\d.,]+ [KMGT]?B)$/);
  if (match) return `Marked ${match[1]}`;

  match = text.match(/^Por decidir (.+)$/);
  if (match) return `To decide ${match[1]}`;

  match = text.match(/^([\d.,\s]+) seleccionados?( en cola)?$/);
  if (match) return `${match[1]} selected${match[2] ? " in queue" : ""}`;

  match = text.match(/^(\d+) en esta página$/);
  if (match) return `${match[1]} on this page`;

  match = text.match(/^Ordenar por (.+)$/);
  if (match) return `Sort by ${translateText(match[1], language).toLowerCase()}`;

  match = text.match(/^de ([\d.,]+ [KMGT]?B)$/);
  if (match) return `of ${match[1]}`;

  match = text.match(/^([\d.,]+)% del total$/);
  if (match) return `${match[1]}% of total`;

  match = text.match(/^([\d.,\s]+) video\(s\) en cola\. Falta el token del Companion o no es válido: pégalo en Perfil › Companion local\.$/);
  if (match) return `${match[1]} video(s) queued. The Companion token is missing or invalid: paste it in Profile › Local Companion.`;

  match = text.match(/^Ver ([\d.,\s]+) videos?$/);
  if (match) return `Show ${match[1]} ${match[1].trim() === "1" ? "video" : "videos"}`;

  match = text.match(/^(\d+) subcarpetas$/);
  if (match) return `${match[1]} subfolders`;

  match = text.match(/^Ver (.+) en el catálogo$/);
  if (match) return `View ${match[1]} in the catalog`;

  match = text.match(/^([\d.,\s]+) videos directamente en esta carpeta · (.+)$/);
  if (match) return `${match[1]} videos directly in this folder · ${match[2]}`;

  match = text.match(/^Expira a las (.+)\. Ingrésalo en la configuración del Companion\.$/);
  if (match) return `Expires at ${match[1]}. Enter it in the Companion settings.`;

  match = text.match(/^v(\d+) · visto (.+)$/);
  if (match) return `v${match[1]} · seen ${match[2]}`;

  match = text.match(/^Usado (.+)$/);
  if (match) return `Used ${match[1]}`;

  match = text.match(/^Catalogado (.+)$/);
  if (match) return `Catalogued ${match[1]}`;

  match = text.match(/^Libre (.+) de (.+)$/);
  if (match) return `Free ${match[1]} of ${match[2]}`;

  match = text.match(/^Último indexado: (.+)$/);
  if (match) return `Last indexed: ${match[1]}`;

  match = text.match(/^(\d+) días$/);
  if (match) return `${match[1]} days`;

  match = text.match(/^([\d.,\s]+) registros · ([\d.,\s]+) vencidos$/);
  if (match) return `${match[1]} records · ${match[2]} expired`;

  match = text.match(/^Se eliminarán de VideoCAT los videos, miniaturas, escaneos y errores de "(.+)"\. Escribe BORRAR para confirmar\.$/);
  if (match) return `VideoCAT will remove the videos, thumbnails, scans and errors of "${match[1]}". Type BORRAR to confirm.`;

  match = text.match(/^Retención aplicada: (\d+) errores, (\d+) acciones y (\d+) escaneos eliminados\.$/);
  if (match) return `Retention applied: ${match[1]} errors, ${match[2]} actions and ${match[3]} scans removed.`;

  match = text.match(/^(Eliminado|Borrado): (.+)$/);
  if (match) return `${match[1] === "Eliminado" ? "Deleted" : "Deletion"}: ${match[2]}`;

  match = text.match(/^Escaneo (\w+) · (\d+) archivos · (\d+) errores$/);
  if (match) return `Scan ${match[1]} · ${match[2]} files · ${match[3]} errors`;

  match = text.match(/^([\d.,\s]+) en la lista$/);
  if (match) return `${match[1]} in the list`;

  match = text.match(/^([\d.,]+ [KMGT]?B) de ([\d.,]+ [KMGT]?B)$/);
  if (match) return `${match[1]} of ${match[2]}`;

  match = text.match(/^([\d.,\s]+)×$/);
  if (match) return `${match[1]}×`;

  match = text.match(/^Abrir (.+)$/);
  if (match) return `Open ${match[1]}`;

  match = text.match(/^Seleccionar (?!página$|cola retirable$)(.+)$/);
  if (match) return `Select ${match[1]}`;

  match = text.match(/^v([\w.-]+) disponible$/);
  if (match) return `v${match[1]} available`;

  match = text.match(/^(\d+)% usado$/);
  if (match) return `${match[1]}% used`;

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

  match = text.match(/^(\d+) disco\(s\) conectado\(s\) disponible\(s\) para descargar\.$/);
  if (match) return `${match[1]} connected drive(s) available for download.`;

  match = text.match(/^Conectado · (.+)$/);
  if (match) return `Connected · ${match[1]}`;

  match = text.match(/^Expira a las (.+)\.$/);
  if (match) return `Expires at ${match[1]}.`;

  match = text.match(/^Orden enviada al companion para (\d+) disco\(s\)\. Los resultados aparecerán aquí\.$/);
  if (match) return `Command sent to the companion for ${match[1]} drive(s). Results will appear here.`;

  match = text.match(/^(\d+) carpeta\(s\) seleccionada\(s\)\.$/);
  if (match) return `${match[1]} selected folder(s).`;

  match = text.match(/^(\d+) descarga\(s\) completada\(s\) eliminadas del historial\.$/);
  if (match) return `${match[1]} completed download(s) removed from history.`;

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

// A node still shows its original when it holds the Spanish source or the English rendering of it,
// whichever language was active before. React-driven updates replace it with a new original.
function isRenderedFrom(original: string, current: string): boolean {
  return current === original || current === translateText(original, "en");
}
const attributeNames = ["title", "aria-label", "placeholder", "data-label"] as const;

function shouldIgnoreElement(element: Element): boolean {
  return ["SCRIPT", "STYLE", "NOSCRIPT", "CODE", "PRE", "SVG"].includes(element.tagName);
}

function localizeTextNode(node: Text, language: Language): void {
  const parent = node.parentElement;
  if (!parent || shouldIgnoreElement(parent)) return;

  const existingOriginal = textOriginals.get(node);
  const current = node.nodeValue ?? "";
  const original = existingOriginal && isRenderedFrom(existingOriginal, current) ? existingOriginal : current;

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
    const original = stored && isRenderedFrom(stored, value) ? stored : value;
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
