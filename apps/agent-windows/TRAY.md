# VideoCAT Companion para Windows

Esta app ejecuta VideoCAT desde la bandeja de Windows. Mantiene el companion local activo y permite lanzar tareas del agente sin abrir una terminal.

## Funciones iniciales

- Arranca el companion local en segundo plano.
- Detecta discos montados con `.videocat-disk.json`.
- Permite añadir unidades completas y carpetas locales o de red como rutas monitoreadas.
- Permite quitar rutas manuales y marcar discos VideoCAT detectados como ignorados temporalmente.
- Permite escanear un disco detectado desde el menú de bandeja.
- Permite procesar borrados pendientes manualmente.
- Permite emparejar cada instalación mediante un código de un solo uso y guardar su credencial cifrada por Windows.
- Mantiene un túnel de control saliente autenticado con el servidor después de emparejarse, sin abrir puertos entrantes de Windows.
- Permite configurar `SERVER_URL`, `WEB_URL`, el `AGENT_TOKEN` heredado opcional y las opciones del companion desde el menú de bandeja.
- Permite abrir `Ver actividad...` para revisar logs en vivo del companion, escaneos y borrados.
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

Para publicar una versión: sube `version` en `package.json`, haz commit y push a `main`, y ejecuta en Windows:

```powershell
powershell -ExecutionPolicy Bypass -File .\package-companion.ps1 -PublishRelease
```

El script empuja el tag `vX.Y.Z` y el workflow `release-companion.yml` compila, empaqueta con Velopack y publica el release.

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
TRAY_DISK_POLL_MS=10000
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
