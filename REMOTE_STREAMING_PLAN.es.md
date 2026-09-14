# Plan De Streaming Remoto Seguro

[English version](REMOTE_STREAMING_PLAN.md)

## Objetivo

Permitir que un navegador autenticado reproduzca un video ubicado en una PC con VideoCAT Companion, incluso desde otro dispositivo, sin exponer puertos del Companion a la LAN o Internet y sin copiar permanentemente el archivo al servidor.

La primera versión transmitirá el archivo original. La transcodificación se considera una fase posterior porque añade consumo de CPU, compatibilidad de codecs y control de procesos FFmpeg.

## Principios

- El Companion siempre inicia la conexión saliente mediante `wss://`.
- El servidor nunca acepta una ruta arbitraria enviada por el navegador.
- Cada reproducción requiere una sesión temporal, revocable y asociada al usuario, archivo y Companion correctos.
- El Companion valida nuevamente disco, marcador y contención de la ruta antes de leer.
- El canal de streaming es de solo lectura y no comparte permisos con abrir, copiar o borrar.
- Los originales no se almacenan permanentemente en el servidor.
- Se aplican backpressure, límites de memoria y cancelación para evitar otro escenario OOM.

## Arquitectura Propuesta

1. El Companion se empareja con el servidor y conserva una credencial individual protegida con DPAPI.
2. El Companion mantiene un WebSocket saliente autenticado hacia el servidor.
3. El navegador solicita una sesión para un `videoFileId` mediante la API web autenticada.
4. El servidor comprueba permisos, PIN de folders protegidos, presencia del archivo, disco montado y capacidad `stream:read` del Companion.
5. El servidor crea una sesión opaca de corta duración y envía al Companion una orden firmada que contiene identificadores, nunca una ruta elegida por el navegador.
6. El elemento `<video>` solicita el contenido al mismo origen de VideoCAT utilizando HTTP Range.
7. El servidor traduce cada rango validado a mensajes binarios sobre el WebSocket. El Companion lee únicamente ese rango y lo devuelve con backpressure.
8. Al cerrar, expirar o perder la conexión, ambos extremos cancelan handles, buffers y solicitudes pendientes.

## Endpoints Y Mensajes

API web propuesta:

- `POST /api/stream-sessions`: crea una sesión temporal para un archivo.
- `GET /api/stream-sessions/:id`: devuelve estado y capacidades.
- `DELETE /api/stream-sessions/:id`: cancela la sesión.
- `GET|HEAD /api/streams/:id/content`: responde con `Accept-Ranges`, `Content-Range`, `Content-Length` y MIME validado.

Mensajes del túnel:

- `stream.open`: prepara y valida el archivo.
- `stream.ready`: informa tamaño, MIME y disponibilidad.
- `stream.range`: solicita offset y longitud acotados.
- `stream.chunk`: devuelve datos binarios numerados.
- `stream.cancel`: libera una solicitud o sesión.
- `stream.error`: devuelve un código saneado sin filtrar rutas locales.

Cada mensaje lleva `requestId`, `sessionId`, número de secuencia y un límite explícito. Las órdenes deben ser idempotentes y rechazarse después de expirar.

## Controles De Seguridad

- Completar primero credenciales por agente y revocación de la Fase 2 de la hoja de ruta.
- Guardar únicamente hashes de tokens de sesión; usar al menos 128 bits aleatorios y expiración breve.
- Usar cookies web `HttpOnly`, `Secure` y `SameSite`, sin colocar secretos persistentes en URLs.
- Atar la sesión al usuario autenticado y al Companion seleccionado.
- Volver a aplicar la autorización de folders protegidos al crear y consumir la sesión.
- Resolver la ruta desde los datos catalogados y exigir contención canónica dentro de un root monitoreado.
- Rechazar enlaces simbólicos, dispositivos, pipes, rutas UNC no monitoreadas y archivos que cambien durante la sesión.
- Permitir solo extensiones/MIME de video configurados; incluir `X-Content-Type-Options: nosniff`.
- Limitar sesiones simultáneas por usuario y Companion, bytes por rango, ancho de banda y tiempo inactivo.
- Registrar creación, inicio, finalización, cancelación y error sin almacenar tokens ni rutas absolutas innecesarias.
- Separar la capacidad `stream:read` de `file:delete`, `file:copy` y acciones administrativas.

## Fases De Implementación

Estado actual: el emparejamiento, las credenciales individuales cifradas, la revocación, el túnel saliente, la lectura HTTP Range y la experiencia inicial de reproducción web están implementados en `v0.1.16`. El siguiente incremento es la compatibilidad de codecs.

### Fase 0: Protocolo Y Modelo De Amenazas — Completada En v0.1.14

- Documentar activos, atacantes, límites de confianza y comportamiento ante desconexiones.
- Definir estados, tamaños máximos, códigos de error y versión negociada del protocolo.
- Crear pruebas para tokens, autorización, HTTP Range y contención de rutas.

### Fase 1: Identidad Y Túnel De Control — Completada En v0.1.14

- Emparejamiento por Companion, credenciales individuales cifradas y revocación completados.
- WebSocket saliente con autenticación por mensaje inicial, límite de 16 KB, timeout de handshake, ping/pong y reconexión con backoff.
- Administración muestra el estado del túnel seguro de cada Companion.
- Heartbeats y órdenes existentes continúan compatibles; el túnel no acepta aún lectura de archivos ni acciones de escritura.

### Fase 2: Streaming Directo Con HTTP Range — Completada En v0.1.15

- Sesiones temporales asociadas al archivo, Companion y sesión web autenticada.
- Puente Range/WebSocket limitado a 512 KiB por solicitud, con timeout y cancelación inmediata.
- `GET` y `HEAD` devuelven cabeceras HTTP Range válidas; los saltos no cargan el video completo en memoria.
- Una reproducción activa por Companion y revalidación de disco, ruta canónica, extensión y tamaño en Windows.

### Fase 3: Experiencia Web — Completada En v0.1.16

- El modal activa Reproducir remotamente solo cuando el Companion y el disco reportan conexión.
- La apertura local conserva prioridad visual y sigue disponible desde la PC que ejecuta el Companion.
- El reproductor muestra conexión, buffering, reproducción, detención y desconexión sin revelar rutas locales.
- Las acciones locales continúan separadas y no se habilitan desde móvil si el listener local no existe.

### Fase 4: Compatibilidad De Codecs

- Detectar previamente si el navegador puede reproducir el codec original.
- Añadir, como opción, remux o transcodificación temporal a HLS/fMP4 mediante FFmpeg.
- Aplicar límites de CPU, procesos, resolución y duración; cancelar FFmpeg al cerrar la sesión.
- No habilitar transcodificación automática en instalaciones pequeñas sin consentimiento.

### Fase 5: Endurecimiento Y Publicación

- Probar replay, traversal, sesiones cruzadas, Companion revocado y conexiones lentas.
- Medir memoria con archivos grandes, múltiples saltos y clientes que dejan de leer.
- Añadir límites configurables, métricas y auditoría con IDs de correlación.
- Publicar la función inicialmente como opt-in y documentar cómo desactivarla.

## Criterios De Finalización

- Ningún puerto entrante del Companion es necesario.
- El navegador nunca recibe ni envía una ruta absoluta de Windows.
- Un token capturado no puede reutilizarse ni reproducir otro archivo.
- La reproducción permite seek mediante HTTP Range y no carga el video completo en memoria.
- Desconectar el navegador, el disco o el Companion libera los recursos en un tiempo acotado.
- Los folders protegidos conservan la misma política de PIN.
- Las operaciones de lectura remota quedan auditadas y pueden revocarse por Companion.
- La suite automatizada cubre autorización, rutas, rangos, reconexión y límites de memoria.

## Decisión Recomendada

No enlazar el listener local actual a `0.0.0.0`. Ese listener contiene operaciones sensibles y, además, una página HTTPS no puede depender de HTTP local sin problemas de contenido mixto. El túnel saliente autenticado mantiene una sola frontera de acceso: el servidor VideoCAT.
