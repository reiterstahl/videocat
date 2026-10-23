# Companion más liviano: de Electron a Tauri

Plan para bajar el instalador del Companion de Windows de **194 MB a ~45–50 MB** sin reescribir la lógica que cuida los archivos, y de paso dejar todo el Companion sobre un Node parchado. Medido el 2026-10-18 sobre la 0.2.17 y actualizado el 2026-10-23 con la 0.2.22 y la beta 0.2.23.

## Por qué pesa tanto hoy

| Parte (0.2.22) | En el instalador |
| --- | --- |
| Electron/Chromium: bandeja y ventanas | ~145 MB |
| Agente como ejecutable propio (Node SEA, Node 24.22.1) | ~40 MB |
| Código de VideoCAT, scripts de salud de discos | ~2 MB |
| **Total (`Setup.exe`)** | **194 MB** |

Desde la 0.2.21 el Companion trae **dos runtimes de Node**: el del agente, parchado, y el de Electron, que solo usan la bandeja y sus ventanas. Ese segundo sigue en Node 24.22.0, sin las correcciones de octubre de 2026, porque ninguna versión de Electron las trae todavía; por eso cada release necesita la excepción `tray_node_exception`.

## La idea

- **Envoltorio Tauri** (Rust), pequeño (~4 MB). Se encarga del ícono de bandeja con su animación y tooltip, del menú, de las ventanas y de las actualizaciones. Las ventanas usan **WebView2**, el motor web que Windows 10/11 ya trae.
- **El agente sigue siendo el mismo código de Node**, ya empaquetado como ejecutable propio desde la 0.2.21. El escaneo, los traslados con SHA-256, los borrados seguros, las descargas, el túnel de reproducción, los buckets S3, la salud de discos y sus tests no se reescriben.
- **El agente pasa a ser quien manda.** Casi todo lo que hoy hace `tray.ts` pasa al agente y se expone por su API local con token (puerto 29429). El envoltorio Tauri queda fino: lo que necesita al sistema operativo (bandeja, ventanas, diálogos, notificaciones, credencial, actualizaciones) y nada más.
- **Las ventanas son las mismas páginas HTML.** Las sirve el agente y el envoltorio las muestra; una capa de compatibilidad reemplaza al `preload` de Electron, así que casi no cambian.
- **Un solo Node, parchado.** Al irse Electron, el único Node del Companion es el del agente: se acaba la excepción `tray_node_exception`.

## Resultado esperado

| | Hoy (Electron 0.2.22) | Con Tauri |
| --- | --- | --- |
| Instalador | 194 MB | ~45–50 MB |
| Instalado | ~460 MB | ~95 MB |
| Memoria en marcha | 238 MB (medido con la 0.2.17) | ~58 MB (medido en la fase 0) |
| Node sin parchar | Sí (bandeja) | No |
| Actualizaciones | Deltas de Velopack | Igual: deltas de Velopack |

## Inventario de la bandeja (0.2.23, `tray.ts`: ~2.500 líneas, 21 funciones expuestas a las ventanas)

| Área | Qué hace hoy | Dónde va |
| --- | --- | --- |
| Bandeja y menú | Ícono animado con el acento y tooltip (líneas `@@videocat-status` del agente), menú dinámico (discos conectados con *Escanear y reparar miniaturas* y *Procesar borrados pendientes*, *Abrir VideoCAT*, *Configuración…*, *Ver actividad…*, *Actualizar discos*, *Buscar actualizaciones*, *Salir*), acción al hacer clic (`TRAY_CLICK_ACTION`), notificaciones, una sola instancia | **Envoltorio** |
| Supervisión del agente | Arranca `videocat-agent.exe`, lo reinicia con espera creciente, el vigía que lo cierra si la bandeja desaparece; tareas a pedido (escaneo, borrados) como procesos aparte | **Envoltorio** (las tareas a pedido pasan a ser llamadas a la API del agente) |
| Configuración | Leer, validar y guardar el `.env`; generar `COMPANION_TOKEN` si falta; copiar el token; elegir carpetas; listar unidades | **Agente** (elegir carpetas y copiar al portapapeles quedan en el envoltorio) |
| Emparejamiento y credencial | Emparejar con un código (llamada al servidor), guardar la credencial con `safeStorage`, estado del emparejamiento | La llamada, **agente**; guardar la credencial con DPAPI, **envoltorio** |
| Discos e identidad | Descubrir marcadores y unidades, rutas manuales, *Convertir…* (escribe el marcador), comprobar la identidad con una muestra del catálogo, *Fijar identidad…*, retirar rutas por letra | **Agente** |
| Salud de discos (SMART) | Estado, activar (ejecuta `smart-setup.ps1` con permiso de administrador: smartctl, la carpeta en Program Files y la tarea programada), desactivar, revisar ahora | **Agente** (la elevación es una llamada a PowerShell, igual que hoy) |
| Actualizaciones | Velopack: buscar, descargar, aplicar al reiniciar, estado | **Envoltorio** (crate de Rust) |
| Registro | Registro en memoria, ventana *Actividad*, limpiar | **Agente** (junta su propio registro con el del envoltorio) |
| Ventanas | *Configuración* (con pestañas) y *Actividad*, HTML generado en `tray.ts` con 21 canales IPC | Páginas servidas por el **agente**; el envoltorio las muestra |

## Fases

### Fase 0 · Prueba de concepto y medición ✅

- Un Tauri mínimo con el ícono en la bandeja y un menú que arranque el agente como Node SEA.
- Medir el tamaño real del instalador, el arranque y la memoria.
- Comprobar que Velopack (crate de Rust) actualiza una instalación de Electron a la nueva, con el mismo `packId` y el mismo nombre de ejecutable, en un canal de prueba.

**Resultado (2026-10-18, runner `windows-2025`, workflow `companion-tauri-poc.yml`): aprobada.**

| | Electron 0.2.17 | Prueba Tauri 0.3.0-poc |
| --- | --- | --- |
| Instalador (`Setup.exe`) | 158 MB | **45,2 MB** |
| Paquete completo de actualización | 150 MB | 38 MB |
| Instalado | 368 MB | 93 MB (bandeja 3,4 MB + agente 89,8 MB) |
| Memoria en marcha (todos sus procesos) | 238 MB (4 procesos) | **58 MB** (bandeja 13 MB + agente 45 MB) |

- Velopack actualizó una instalación de Electron a Tauri con el mismo `packId` (`Update.exe apply`, código 0), cambió el contenido de `current`, mantuvo los accesos directos del escritorio y del menú Inicio, y desinstaló limpio.
- El agente empaquetado como ejecutable único (Node SEA) arranca completo dentro de Tauri: detector de discos, revisiones, latido y API local.
- Si se termina la bandeja a la fuerza, el agente se cierra solo.

**Ya adelantado fuera del plan:** desde la 0.2.21 el Companion real usa el agente como ejecutable propio (`build-agent-sea.mjs`, `check-node-security.mjs`, `verify-package.mjs`). Lo que la fase 4 pensaba armar para el agente ya está en producción.

### Fase 1a · La lógica de la bandeja pasa al agente (todavía en Electron)

- Pasar al agente, con tests de Node para cada parte: configuración (`.env` y token), emparejamiento (la llamada), discos e identidad (descubrir, convertir, comprobar y fijar identidad, retirar rutas por letra), salud de discos (estado, activar con elevación, desactivar, revisar) y registro.
- Exponerlo por la API local con token, junto con las tareas a pedido (escaneo, borrados, actualizar discos).
- La bandeja de Electron deja de hacer todo eso y le pide cada cosa al agente.
- Se publica como un **release normal de Electron** (beta primero): se valida el cambio grande sin cambiar a la vez el envoltorio.

### Fase 1b · Las ventanas las sirve el agente (todavía en Electron)

- *Configuración* y *Actividad* se sirven desde el agente (`/ui/…`, abiertas con un enlace de un solo uso para no exponer el token).
- Una capa de compatibilidad reemplaza al `preload`: lo que hoy son los 21 canales IPC pasa a ser la API del agente; lo que necesita al sistema (elegir carpeta, copiar, abrir el navegador, notificaciones) lo resuelve el envoltorio por un puente pequeño, el mismo que usará Tauri.
- Release normal de Electron (beta primero).

### Fase 2 · Envoltorio Tauri

- **Bandeja:** ícono con la animación del acento y tooltip (el mismo algoritmo de `tray-animation.ts`, portado a Rust con un test que compara ambos con la misma imagen), menú dinámico con los discos y las acciones, `TRAY_CLICK_ACTION`.
- **Ventanas:** WebView2 que cargan las páginas del agente, y el puente para carpetas, portapapeles, navegador y notificaciones.
- **Agente:** supervisión (reinicio con espera creciente, como hoy) y el vigía que lo cierra si la bandeja desaparece.
- **Sistema:** una sola instancia y notificaciones de Windows.

### Fase 3 · Credenciales y datos

- La credencial del Companion se guarda con **DPAPI** de Windows desde Rust. El agente hace la llamada de emparejamiento y le pasa la credencial al envoltorio por el canal del proceso (nunca en claro a disco); el envoltorio se la entrega al agente al arrancarlo, como hoy.
- **Migración de la credencial actual:** Electron la cifró con su propio formato (OSCrypt, una clave AES guardada con DPAPI en `Local State`). El nuevo envoltorio la lee una vez y la vuelve a guardar en DPAPI. Si no pudiera leerla, el Companion pide reemparejar con un código: no se pierde nada, solo hay que generar uno nuevo en Administración.
- Se mantienen las rutas de siempre: configuración en `.env`, estado de escaneos y lista de archivos en riesgo en `%LOCALAPPDATA%\VideoCAT\agent-state`, carpeta temporal y de descargas, marcadores de los discos. La salud de discos no cambia: smartctl y su tarea viven en `C:\Program Files\VideoCAT SMART` y `C:\ProgramData\VideoCAT\smart`, fuera de la carpeta de la app.

### Fase 4 · Actualizaciones y CI

- **Actualizaciones:** Velopack en Rust con el **mismo `packId`** y el **mismo ejecutable** (`VideoCAT Companion.exe`). Así las instalaciones actuales pasan solas a Tauri, y los accesos directos y el arranque siguen funcionando.
- **Workflow de release:** toolchain de Rust con caché, `cargo build --release`, el agente con `build-agent-sea.mjs` (ya existe), smartctl con `fetch-smartctl.mjs` (ya existe), `vpk pack` y `vpk upload`. Sale la excepción `tray_node_exception`: `check-node-security` vuelve a ser estricto porque solo queda el Node del agente.
- **SBOM:** se mantiene y suma las dependencias de Rust.
- **Tests:** los del agente siguen igual; tests en Rust (DPAPI, lector de la credencial vieja, cuadros de la animación); prueba de humo en el runner de Windows como en la fase 0 (instalar, actualizar desde Electron, arrancar, el agente responde `/health`, cerrar, desinstalar).

### Fase 5 · Prueba en tu PC y paso a estable

- Publicar primero como **beta** (prerelease de GitHub), solo para tu PC.
- Lista de comprobación:
  - bandeja: animación, tooltip, menú y clic;
  - *Configuración* y *Actividad*, incluido elegir carpetas y copiar el token;
  - emparejamiento y credencial migrada;
  - discos: convertir uno, fijar identidad de una ruta por letra;
  - salud de discos: activar (aviso de administrador), revisar ahora, desactivar;
  - un escaneo, un archivo en riesgo o con problema de lectura, un traslado completo, descargas con prioridad (también de un bucket S3), detener y reanudar traslados, reproducción remota y un borrado;
  - que el antivirus no desconfíe del ejecutable del agente ni del envoltorio;
  - actualizaciones de Electron a Tauri y de Tauri a Tauri;
  - desinstalar.
- Con todo en verde: release estable y documentación (README, TRAY.md, OPERATIONS, SECURITY y el sitio).

## Cuándo empezar

Después de que la **0.2.23** (salud de discos) pase de beta a estable, para que la fase 1a mueva una función ya probada en tu PC y no un blanco en movimiento.

## Riesgos y cómo se cubren

| Riesgo | Mitigación |
| --- | --- |
| WebView2 ausente (Windows 10 viejo o recortado) | El instalador de Tauri trae el bootstrapper de WebView2 (~2 MB) y lo instala si falta. |
| Credencial de Electron ilegible | Reemparejar con un código: dos minutos, sin pérdida de datos. |
| El paso Electron → Tauri con Velopack | Probado en la fase 0; se repite en beta antes del release estable. |
| La elevación para la salud de discos | Hoy ya la hace PowerShell (`Start-Process -Verb RunAs`), no Electron: pasa al agente sin cambios y la tarea queda fuera de la carpeta de la app. Se prueba en la fase 5. |
| Mover la lógica de la bandeja rompe algo en Electron | Las fases 1a y 1b salen primero como beta de Electron, cada una por separado. |
| Antivirus que desconfía de un ejecutable nuevo | El agente ya se distribuye así desde la 0.2.21; el envoltorio nuevo se prueba en la fase 5. Firmar el código ayudaría, pero hoy no se firma. |
| No puedo probar Windows de forma interactiva desde aquí | El CI compila y hace la prueba de humo en Windows; la validación visual y de uso real va en la fase 5, en tu PC. |

## Qué no cambia para quien lo usa

Mismo ícono, mismo menú, mismas ventanas, misma configuración, mismos discos, rutas y marcadores, misma salud de discos, mismas prioridades (descargas antes que traslados, detener traslados) y actualizaciones automáticas. Lo que se nota: el instalador pesa un cuarto, la bandeja usa mucha menos memoria y todo el Companion corre sobre un Node parchado.
