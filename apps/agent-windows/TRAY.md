# VideoCAT Companion para Windows

Esta app ejecuta VideoCAT desde la bandeja de Windows. Mantiene el companion local activo y permite lanzar tareas del agente sin abrir una terminal.

## Funciones iniciales

- Arranca el companion local en segundo plano.
- Detecta discos montados con `.videocat-disk.json`.
- Permite añadir unidades completas y carpetas locales o de red como rutas monitoreadas.
- Permite quitar rutas manuales y marcar discos VideoCAT detectados como ignorados temporalmente.
- Permite escanear un disco detectado desde el menú de bandeja.
- Permite procesar borrados pendientes manualmente.
- Permite configurar `SERVER_URL`, `WEB_URL`, `AGENT_TOKEN` y opciones del companion desde el menú de bandeja.
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

En el menú usa `Configuración...` para guardar el token del agente y la URL del servidor. Al guardar, el companion se reinicia automáticamente.

## Generar ejecutable

En Windows:

```powershell
npm install
npm run package:tray -w @videocat/agent-windows
```

El portable queda en:

```text
apps\agent-windows\release\VideoCAT-Companion-0.1.0.exe
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
AGENT_TOKEN=change-me-agent-token
COMPANION_PORT=29429
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

- `ffmpeg` y `ffprobe` deben estar disponibles en el `PATH` de Windows para generar metadatos y miniaturas.
- El escaneo sigue respetando `.videocat-disk.json` y sus `scanRoots`.
- La app no se configura para iniciar con Windows automáticamente todavía.
