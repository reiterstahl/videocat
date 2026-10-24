# VideoCAT Companion para Windows

Esta app ejecuta VideoCAT desde la bandeja de Windows. Mantiene el companion local activo y permite lanzar tareas del agente sin abrir una terminal.

## Funciones iniciales

- Arranca el companion local en segundo plano.
- Su interfaz (menú, ventanas, avisos y tooltip) está en español o inglés según el idioma de Windows, o el elegido en **Avanzado › Idioma** (`COMPANION_LANGUAGE`). Los textos se escriben en español y el inglés sale de `src/tray-i18n-en.ts`; el registro de actividad deja las líneas del agente como están.
- Mientras trabaja, el color de acento elegido en la web (Tema) recorre el borde blanco del ícono de la bandeja; sin tareas, el ícono queda blanco y quieto. Al pasar el cursor, el tooltip muestra la tarea, el archivo, el avance y cuánto falta.
- Si una lectura de un archivo (sus metadatos o un fotograma) no responde en 30 s o da un error de lectura del disco, el archivo se deja enseguida, sin reintentos, y queda en riesgo; lo mismo si no termina en **Tiempo máximo por archivo** (`COMPANION_FILE_TIMEOUT_SECONDS`, 180 s por defecto). El escaneo sigue con el siguiente y los próximos escaneos no lo tocan durante 30 días, salvo que en la web se pida **Volver a leerlo**: el índice del disco que el Companion pide al empezar cada escaneo trae esos archivos, que salen de la lista de riesgo y se leen completos.
- Los traslados abandonan un archivo cuyo disco deja de entregar datos durante 30 s, y un borrado que no puede leer el archivo para confirmar que es el catalogado no lo borra: lo informa para borrarlo a mano.
- **Salud de discos** (Configuración › Rutas monitoreadas): lee el SMART de los discos conectados con smartctl (smartmontools 7.5, que viene incluido) al conectar cada disco y cada 6 horas, y lo manda a la web (Administración › Discos y un aviso descartable si un disco está por fallar). Windows solo deja leer SMART con permiso de administrador, así que **Activar…** pide ese permiso una vez: copia smartctl y su script a `C:\Program Files\VideoCAT SMART` y crea la tarea `\VideoCAT\Salud de discos`, que los ejecuta con privilegios y deja el resultado en `C:\ProgramData\VideoCAT\smart` (los usuarios solo pueden leerlo). El Companion nunca corre como administrador: solo inicia la tarea. **Desactivar…** las quita, también con permiso. Hace falta una cuenta de Windows que pueda ser administradora; algunos adaptadores USB no dejan pasar SMART y el disco sale como «Sin datos SMART». Antes de desinstalar el Companion conviene desactivarla.
- Detecta discos montados con `.videocat-disk.json`.
- Permite añadir carpetas locales o de red como rutas monitoreadas. Una unidad completa se añade con **Añadir unidad… › Convertir…**, que le escribe su `.videocat-disk.json`: así se reconoce aunque cambie la letra.
- Las unidades que versiones anteriores seguían por letra muestran **sigue la letra** y **Fijar identidad…**, que compara una muestra del catálogo con la unidad elegida antes de escribir el marcador con el mismo id.
- Cuando un disco se renombra en Administración, el nombre nuevo se guarda en su marcador en el siguiente latido.
- Permite quitar rutas manuales y marcar discos VideoCAT detectados como ignorados temporalmente.
- Permite escanear un disco detectado desde el menú de bandeja.
- Permite procesar borrados pendientes manualmente.
- Permite emparejar cada instalación mediante un código de un solo uso y guardar su credencial cifrada por Windows.
- Mantiene un túnel de control saliente autenticado con el servidor después de emparejarse, sin abrir puertos entrantes de Windows.
- Permite configurar `SERVER_URL`, `WEB_URL`, el `AGENT_TOKEN` heredado opcional y las opciones del companion desde el menú de bandeja.
- Informa a la web lo que está haciendo en cada momento (indicador de actividad del encabezado) y el espacio libre real de los discos conectados.
- Permite abrir `Ver actividad...` para revisar logs en vivo del companion, escaneos, borrados y traslados.
- Mueve los archivos de **Traslados** (consolidar carpetas y agrupar archivos) a través de la carpeta temporal `COMPANION_STAGING_DIR`: copia con SHA-256, verifica releyendo, borra del origen solo después de verificar y registrar, y deja libre siempre el 5 % de esa unidad.
- Mantiene las tareas periódicas existentes del companion:
  - detección de discos,
  - borrado automático de archivos marcados,
  - apertura de archivos/carpetas desde la web.
- Abre VideoCAT en el navegador desde el ícono.

## Probar en desarrollo

Desde la raíz del repo:

```powershell
npm install
npm run tray -w @videocat/agent-windows
```

El ícono queda en la bandeja. Clic izquierdo abre VideoCAT; clic derecho muestra el menú.

En VideoCAT web abre `Administración` y genera un código. Luego usa `Configuración...` en el Companion para indicar la URL del servidor y emparejarlo. Al completar el proceso, la credencial individual se guarda cifrada, se retira el token compartido de la configuración local y el Companion se reinicia automáticamente.

## Instalar y actualizar

Instala con `VideoCAT-Companion-win-Setup.exe` desde el último release de GitHub. Se instala para el usuario actual, sin permisos de administrador, y crea un acceso en el menú Inicio.

El Companion busca versiones nuevas un minuto después de iniciar y luego cada 6 horas. Cuando encuentra una, la descarga en segundo plano (con deltas cuando es posible) y muestra una notificación. Para aplicarla:

- clic en la notificación,
- `Reiniciar para actualizar a vX.Y.Z` en el menú de la bandeja,
- o el botón `Actualizar a vX.Y.Z` en la configuración.

Si no la aplicas, se instala sola en el siguiente arranque. `Buscar actualizaciones` en la bandeja fuerza una consulta. La configuración y la credencial se guardan en `%APPDATA%\VideoCAT Companion` y se conservan entre versiones.

## Generar instalador

Para publicar una versión basta con subir `version` en `package.json`, hacer commit y push a `main`: el workflow `release-companion.yml` compila, empaqueta con Velopack, crea el tag `vX.Y.Z` y publica el release. Una versión que ya tiene tag no se vuelve a publicar.

Build local sin publicar (requiere `dotnet tool install -g vpk --version 1.2.161` para generar Setup.exe):

```powershell
powershell -ExecutionPolicy Bypass -File .\package-companion.ps1
```

El instalador queda en:

```text
apps\agent-windows\release\velopack\VideoCAT-Companion-win-Setup.exe
companion\VideoCAT-Companion-win-Setup.exe
```

## Configuración

La app lee `.env` desde:

- el folder desde donde se ejecuta,
- el directorio de datos de la app,
- la raíz del repo si se ejecuta en desarrollo.

Variables útiles:

```env
SERVER_URL=http://192.168.1.x:8081
WEB_URL=https://videocat.example.com
# Opcional para clientes heredados; el emparejamiento individual es preferible.
AGENT_TOKEN=
AGENT_STATE_DIR=
FFMPEG_PATH=
FFPROBE_PATH=
COMPANION_PORT=29429
COMPANION_NAME=
COMPANION_ALLOWED_ORIGINS=https://videocat.example.com,http://192.168.1.x:8081,http://localhost:5173,http://127.0.0.1:5173
COMPANION_DISK_POLL_MS=5000
COMPANION_SCAN_POLL_MS=900000
COMPANION_DELETE_POLL_MS=60000
# Carpeta temporal de traslados; vacía desactiva los traslados.
COMPANION_STAGING_DIR=
COMPANION_TRANSFER_POLL_MS=60000
TRAY_DISK_POLL_MS=10000
# Clic o doble clic en el ícono: open (abrir VideoCAT), activity (ver actividad) o settings (configuración).
TRAY_CLICK_ACTION=open
COMPANION_AUTO_DELETE_MARKED=true
COMPANION_MONITORED_TARGETS=[]
COMPANION_DISABLED_DISK_IDS=
```

`WEB_URL` controla qué sitio abre la opción `Abrir VideoCAT`. `SERVER_URL` es el endpoint real usado por el agente para subir datos.

## Notas

- El Companion busca `ffmpeg` y `ffprobe` en el `PATH` y en ubicaciones comunes de WinGet, Scoop y Chocolatey. Si no los encuentra, configura `FFMPEG_PATH` y `FFPROBE_PATH`.
- El Companion usa FFmpeg para generar huellas visuales de 15 fotogramas. Los videos antiguos se analizan progresivamente, hasta 100 por cada revisión del disco.
- El estado persistente del agente se guarda por defecto en `%LOCALAPPDATA%\VideoCAT\agent-state`; `AGENT_STATE_DIR` permite cambiarlo.
- El Companion crea `companion-identity.json` en ese directorio para mantener una identidad UUID estable por instalación. No copies ese archivo a otro equipo.
- La credencial individual se cifra mediante Electron `safeStorage` para el usuario actual de Windows. El servidor conserva solo su hash y puede revocarla desde `Administración`.
- El túnel saliente emparejado permite control remoto y reproducción remota exclusivamente de lectura. No expone un puerto entrante de Windows ni permite rutas arbitrarias: cada sesión está asociada a un archivo catalogado, una identidad de Companion y una caducidad corta.
- El escaneo sigue respetando `.videocat-disk.json` y sus `scanRoots`.
- La app no se configura para iniciar con Windows automáticamente todavía.
