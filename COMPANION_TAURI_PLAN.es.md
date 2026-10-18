# Companion más liviano: de Electron a Tauri

Plan para bajar el instalador del Companion de Windows de **~158 MB a ~35–45 MB** sin reescribir la lógica que cuida los archivos. Medido el 2026-10-18 sobre la 0.2.17.

## Por qué pesa tanto hoy

| Parte | Descomprimido | En el instalador |
| --- | --- | --- |
| Electron/Chromium (ejecutable, gráficos, idiomas, licencias) | ~362 MB | ~145 MB |
| Código de VideoCAT (agente, bandeja, ventanas) | ~6 MB | ~2 MB |

El 97 % es el navegador que trae Electron. Solo se usa para la bandeja y para dos ventanas (Configuración y Actividad). El agente que hace el trabajo es Node puro: hoy corre con el mismo ejecutable de Electron en modo Node (`ELECTRON_RUN_AS_NODE`).

## La idea

- **Envoltorio Tauri** (Rust), pequeño (~5–8 MB). Se encarga del ícono de bandeja con su animación y tooltip, del menú, de las ventanas y de las actualizaciones. Las ventanas usan **WebView2**, el motor web que Windows 10/11 ya trae, en vez de un Chromium propio.
- **El agente sigue siendo el mismo código de Node**, empaquetado como un único ejecutable (Node SEA). El escaneo, los traslados con SHA-256, los borrados seguros, las descargas, el túnel de reproducción y sus tests no se reescriben.
- **El agente pasa a ser quien manda.** Lo que hoy hace `tray.ts` en Electron pasa al agente y se expone por su API local con token, que ya existe en el puerto 29429. Incluye descubrir discos, rutas monitoreadas, tareas manuales, configuración, emparejamiento y registro. El envoltorio Tauri queda fino: casi todo lo que hace es pedirle cosas al agente.
- **Las ventanas son las mismas páginas HTML.** Las sirve el agente y Tauri las muestra; una capa de compatibilidad reemplaza al `preload` de Electron, así que casi no cambian.

## Resultado esperado

| | Hoy (Electron) | Con Tauri |
| --- | --- | --- |
| Instalador | ~158 MB | ~35–45 MB (unos 30 MB son el runtime de Node) |
| Instalado | ~368 MB | ~100 MB |
| Memoria de la bandeja en reposo | 100–150 MB | 20–30 MB (más el agente, igual que hoy) |
| Actualizaciones | Deltas de Velopack | Igual: deltas de Velopack |

Si más adelante Node llegara a molestar, el agente se podría portar a Rust por partes. Bajaría a ~10 MB, pero no es parte de este plan.

## Fases

### Fase 0 · Prueba de concepto y medición

- Un Tauri mínimo con el ícono en la bandeja y un menú que arranque el agente actual como Node SEA.
- Medir el tamaño real del instalador, el arranque y la memoria.
- Comprobar que Velopack (crate de Rust) actualiza una instalación de Electron a la nueva, con el mismo `packId` y el mismo nombre de ejecutable, en un canal de prueba.
- **Decisión:** seguir solo si el instalador queda por debajo de ~50 MB y la actualización desde Electron funciona.

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
- Pendiente de confirmar en tu PC, en la fase 5: que el antivirus de Windows no desconfíe del ejecutable del agente (en el runner no hubo avisos).

### Fase 1 · El agente se vuelve autónomo (todavía en Electron)

- Pasar al agente lo que hoy vive en `tray.ts`:
  - descubrir discos y marcadores;
  - rutas monitoreadas y discos ignorados;
  - escaneo y borrados a pedido;
  - leer y guardar la configuración (`.env`);
  - emparejamiento (la llamada al servidor);
  - registro de actividad;
  - estado de actualizaciones.
- Exponer todo eso por la API local con token.
- Que el agente sirva las páginas de Configuración y Actividad, con la capa de compatibilidad.
- Se publica como un **release normal de Electron**: así se valida el cambio grande sin cambiar a la vez el envoltorio.

### Fase 2 · Envoltorio Tauri

- **Bandeja:** ícono con la animación del acento y tooltip (los cuadros salen de `tray-animation.ts`, ya probado), menú dinámico con los discos y las acciones, y la acción al hacer clic (`TRAY_CLICK_ACTION`).
- **Ventanas:** WebView2 que cargan las páginas del agente.
- **Agente:** supervisión del agente (reinicio con espera creciente, como hoy) y el vigía que lo cierra si la bandeja desaparece (0.2.17).
- **Sistema:** una sola instancia, notificaciones de Windows, abrir VideoCAT en el navegador, elegir carpetas y copiar al portapapeles.

### Fase 3 · Credenciales y datos

- La credencial del Companion se guarda con **DPAPI** de Windows desde Rust.
- **Migración de la credencial actual:** Electron la cifró con su propio formato (OSCrypt, una clave AES guardada con DPAPI en `Local State`). El nuevo envoltorio la lee una vez y la vuelve a guardar en DPAPI. Si no pudiera leerla, el Companion pide reemparejar con un código: no se pierde nada, solo hay que generar uno nuevo en Administración.
- Se mantienen las rutas de siempre: configuración en `.env`, estado de escaneos y lista de archivos en riesgo en `%LOCALAPPDATA%\VideoCAT\agent-state`, y carpeta temporal y de descargas. No se mueve ningún dato.

### Fase 4 · Actualizaciones y CI

- **Actualizaciones:** Velopack en Rust con el **mismo `packId`** y el **mismo ejecutable** (`VideoCAT Companion.exe`). Así las instalaciones actuales pasan solas a Tauri, y los accesos directos y el arranque siguen funcionando.
- **Workflow de release:**
  - toolchain de Rust en el runner de Windows, con caché;
  - `cargo tauri build`;
  - armar el agente con esbuild y empaquetarlo como Node SEA;
  - `vpk pack` y `vpk upload`.
- **SBOM:** se mantiene.
- **Tests:**
  - los del agente siguen igual;
  - se suman unos pocos tests en Rust (DPAPI y el lector de la credencial vieja);
  - una prueba de humo en el runner de Windows: arranca, el agente responde `/health` y se cierra limpio.

### Fase 5 · Prueba en tu PC y paso a estable

- Publicar primero en un **canal beta** de Velopack, solo para tu PC.
- Lista de comprobación manual:
  - bandeja: animación, tooltip y menú;
  - Configuración y Actividad;
  - emparejamiento y credencial migrada;
  - un escaneo, un archivo en riesgo, un traslado completo, descargas con prioridad, detener y reanudar, reproducción remota y un borrado;
  - actualizaciones de Electron a Tauri y de Tauri a Tauri;
  - desinstalar.
- Con todo en verde: canal estable y documentación (README, TRAY.md, OPERATIONS y el sitio).

## Riesgos y cómo se cubren

| Riesgo | Mitigación |
| --- | --- |
| WebView2 ausente (Windows 10 viejo o recortado) | El instalador de Tauri trae el bootstrapper de WebView2 (~2 MB) y lo instala si falta. |
| Credencial de Electron ilegible | Reemparejar con un código: dos minutos, sin pérdida de datos. |
| El paso Electron → Tauri con Velopack | Se prueba en la fase 0 y otra vez en beta antes de tocar el canal estable. |
| Antivirus que desconfía de un ejecutable Node SEA nuevo | Probar en la fase 0; la alternativa es distribuir `node.exe` y el script por separado (mismo tamaño). Firmar el código ayudaría, pero hoy no se firma. |
| No puedo probar Windows de forma interactiva desde aquí | El CI compila y hace la prueba de humo en Windows; la validación visual y de uso real va en la fase 5, en tu PC. |

## Qué no cambia para quien lo usa

Mismo ícono, mismo menú, mismas ventanas, misma configuración, mismos discos y rutas, mismas prioridades (descargas antes que traslados, detener traslados) y actualizaciones automáticas. Lo único que se nota es que el instalador pesa un cuarto y la bandeja usa menos memoria.
