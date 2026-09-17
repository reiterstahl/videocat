# VideoCAT: briefing completo para el website

Este documento es una fuente de contexto para diseñar, redactar o actualizar el website oficial de VideoCAT mediante otro LLM. Debe usarse junto con capturas reales del producto. No inventar funciones, métricas de adopción, testimonios ni compatibilidades que no aparezcan aquí.

## Datos oficiales

- Nombre: `VideoCAT`
- Categoría: catálogo de video self-hosted para discos externos y rutas de Windows
- Website: <https://videocat.centeran.com>
- Código fuente: <https://github.com/reiterstahl/videocat>
- Releases y Companion Windows: <https://github.com/reiterstahl/videocat/releases/latest>
- Docker Hub web: <https://hub.docker.com/r/reiterstahl/videocat-web>
- Docker Hub server: <https://hub.docker.com/r/reiterstahl/videocat-server>
- Perfil del autor: <https://github.com/reiterstahl>
- GitHub Sponsors: <https://github.com/sponsors/reiterstahl>
- PayPal: <https://www.paypal.com/donate/?hosted_button_id=2A4K45LJRACCY>
- Licencia: `AGPL-3.0-or-later`
- Stack Docker actual: `0.1.22`
- Companion Windows actual: `0.1.20`
- Color principal: `#FC6121`
- Logo principal del repositorio: `logo_orange.png`

## Definición breve

VideoCAT es una aplicación libre y self-hosted para catalogar, explorar y gestionar colecciones de video distribuidas entre discos duros externos, unidades locales y carpetas de red. Mantiene en el servidor el catálogo, los metadatos, las miniaturas, las etiquetas y las decisiones del usuario; los archivos originales permanecen en Windows bajo control del usuario.

Un Companion portable para Windows identifica las unidades aunque cambien de letra, realiza los escaneos, crea miniaturas y huellas visuales, abre archivos localmente, copia videos solicitados, procesa borrados pendientes y permite reproducción remota mediante un túnel saliente autenticado.

## Propuesta de valor

VideoCAT responde a una situación que los media servers tradicionales no resuelven bien: una colección grande repartida entre muchos discos que no pueden estar conectados todos al mismo tiempo.

El usuario puede:

- Saber qué tiene y en qué disco se encuentra sin conectar toda la colección.
- Ver miniaturas y metadatos sin copiar los videos originales al servidor.
- Encontrar contenido mediante nombre, ruta, carpeta, formato, disco, etiqueta o categoría.
- Revisar contenido aleatoriamente y tomar decisiones de conservación o borrado.
- Detectar copias potenciales incluso cuando difieren en resolución o compresión.
- Decidir qué discos conectar primero para recuperar más espacio.
- Preparar una cola de videos para copiar al equipo Windows.
- Reproducir desde un teléfono los videos de los discos conectados a la PC.
- Conservar control local y evitar entregar la biblioteca a un servicio cloud.

## Audiencias principales

- Personas con colecciones de video grandes distribuidas en varios discos externos.
- Usuarios que archivan material y necesitan recordar ubicación, tamaño y estado.
- Personas que quieren revisar, etiquetar y depurar una biblioteca con calma.
- Usuarios self-hosted que prefieren Docker, almacenamiento local y control de sus datos.
- Coleccionistas que no necesitan tener todas las unidades conectadas permanentemente.

## Cómo funciona

```text
Navegador
   |
   | HTTPS / API / HTTP Range
   v
VideoCAT Web + Server + PostgreSQL
   ^
   | túnel saliente autenticado
   |
Companion Windows -> discos externos / carpetas locales / rutas de red
```

1. La plataforma web se despliega con Docker Compose.
2. El Companion se ejecuta desde la bandeja de Windows.
3. El Companion se empareja con un código de un solo uso generado en Administración.
4. Las unidades VideoCAT usan `.videocat-disk.json` como identidad estable.
5. El Companion indexa archivos y envía metadatos, miniaturas, huellas visuales y errores.
6. Los videos originales permanecen en sus unidades.
7. Las acciones físicas se ejecutan únicamente desde Windows cuando la ruta correcta está disponible.

## Componentes

### Plataforma web

- `videocat-web`: React, Vite y Nginx.
- `videocat-server`: Fastify, Prisma y API autenticada.
- `postgres`: catálogo persistente.
- `thumbnails_data`: volumen persistente para miniaturas.

### Companion Windows

- App portable basada en Electron y Node.js.
- Vive en la bandeja y no necesita instalarse como servicio.
- Impide abrir dos instancias simultáneas.
- Reinicia su proceso de trabajo con espera progresiva tras una salida inesperada.
- Usa FFmpeg y FFprobe; detecta instalaciones comunes de WinGet, Scoop y Chocolatey.
- Guarda estado local en `%LOCALAPPDATA%\VideoCAT\agent-state` por defecto.
- Cifra su credencial individual mediante la protección del usuario de Windows.

## Funciones de la plataforma web

### Catálogo

- Login con usuario y contraseña.
- Interfaz responsive en español e inglés.
- Modo claro y oscuro.
- Menú sticky de una sola línea y menú compacto en móvil.
- URLs independientes para cada sección.
- Selección rápida de discos y filtro de discos conectados.
- Búsqueda parcial y tolerante a acentos en nombre y ruta.
- Árbol de carpetas colapsable y búsqueda de folders.
- Filtros por extensión, carpetas, etiquetas, categorías y duplicados.
- Columnas ordenables, paginación y cantidad de resultados persistente.
- Selección de uno o varios archivos para acciones en lote.
- Fecha de última indexación, tamaño, duración, resolución, codec, ruta y disco.

### Miniaturas y detalle

- Hasta 15 fotogramas distribuidos a lo largo de cada video.
- Galería de capturas y vista de imagen ampliada.
- Navegación entre videos y cierre mediante Escape o clic fuera del modal.
- Regeneración automática de miniaturas faltantes.
- Regeneración manual en lote para los videos seleccionados.
- Apertura del archivo o de su carpeta cuando la web se usa en la misma PC del Companion.

### Review

- Selección aleatoria de videos sin decisión.
- Restricción opcional a discos seleccionados o conectados.
- Decisiones `Mantener` y `Marcado para borrar`.
- Asignación simultánea de otras categorías.
- Indicadores de pendientes, marcados hoy, racha semanal y GB liberados.
- Historial tabulado de borrados y errores.
- Procesamiento manual de borrados pendientes.
- Recomendación de discos por espacio marcado para recuperar.
- Precarga del siguiente video y sus capturas para reducir esperas.

### Duplicados

- Coincidencia exacta por tamaño cuando todavía no existen huellas visuales.
- Huellas perceptuales tomadas en 15 posiciones del video.
- Detección de copias potenciales con diferente resolución, codec, bitrate o compresión.
- Nivel de confianza, motivos de coincidencia y espacio recuperable.
- Exclusión de folders protegidos por PIN.
- Modo asistido de comparación lado a lado.
- Una única recomendación para conservar, priorizando resolución, tamaño y duración.
- El candidato recomendado aparece primero.
- Los fotogramas cambian automáticamente al posar el cursor sobre cada video.
- Una decisión marca de forma atómica uno para mantener y el otro para borrar.
- Caché temporal de grupos y precarga de los pares siguientes.
- Ranking de discos que conviene conectar primero para resolver duplicados y liberar espacio.

### A descargar

- Cola para copiar videos desde discos conectados hacia una carpeta local de Windows.
- Procesamiento secuencial, un archivo a la vez.
- Progreso individual y vista general con porcentaje, velocidad y tiempo estimado.
- Pausa segura: termina la copia actual y detiene las siguientes.
- Inicio manual, reanudación, eliminación de pendientes y limpieza del historial procesado.
- Selección aleatoria por un objetivo aproximado en GB.
- Restricción por discos conectados y carpetas elegidas.
- Posibilidad de retirar videos de la cola antes de copiarlos.
- Detección de copias estancadas para marcar error y continuar con el siguiente archivo.
- Etiquetas de año/mes para no repetir selecciones ya descargadas.

### Esquema de uso, auditoría y administración

- Visualización proporcional del espacio catalogado por folder.
- Auditoría de errores de acceso, metadatos, miniaturas, escaneo y borrado.
- Mensajes largos truncados en tabla y disponibles completos bajo solicitud.
- Administración por unidad con capacidad total, usada y libre.
- Tamaño catalogado, cantidad de videos, escaneos y actividad reciente.
- Eliminación administrativa del catálogo de una unidad sin borrar el disco físico.
- Gestión y revocación de Companions emparejados.
- Indicador global de Companion conectado.
- Aviso de una versión estable más reciente publicada en Docker Hub.

### Perfil y privacidad

- Cambio del PIN de cuatro dígitos.
- Patrones configurables de nombres de folder protegidos.
- Los patrones son fragmentos, case-insensitive, y no deben estar codificados en el proyecto público.
- Activación voluntaria de Chromecast.
- Selector de idioma con detección inicial del idioma del sistema.

## Reproducción remota

La reproducción remota está pensada principalmente para un navegador móvil en la misma red o con acceso HTTPS al servidor.

- El navegador solicita una sesión temporal al servidor.
- El servidor elige un Companion emparejado que reporte el disco correcto.
- El Companion lee el archivo y responde mediante su túnel saliente.
- El servidor entrega HTTP Range al navegador sin revelar la ruta local.
- No se copia ni conserva permanentemente el video en el servidor.
- El reproductor intenta entrar en pantalla completa en móvil.
- Los controles permanecen ocultos hasta tocar el video.
- Doble toque a la izquierda o derecha para retroceder o adelantar.
- Botón para saltar directamente a otro video.
- Reproducción aleatoria persistente entre videos presentes en discos conectados.
- El cambio de video reemplaza la sesión anterior para evitar conflictos por reproducción simultánea.
- Los estados de preparación, buffer y desconexión tienen feedback visual.

Compatibilidad:

- La reproducción directa depende del contenedor, codecs y navegador.
- Existe remux temporal opcional a MP4 para combinaciones compatibles de H.264/AAC o MP3.
- El remux copia streams; no recodifica.
- VideoCAT no activa automáticamente transcodificación completa de H.265, AV1 u otros codecs.
- Chromecast es opt-in y utiliza una URL firmada temporal ligada a la sesión.

## Identidad resiliente y conciliación

- Cada disco marcado contiene `.videocat-disk.json` con UUID, nombre y rutas de escaneo.
- La identidad no depende de la letra asignada por Windows.
- También pueden monitorearse unidades, carpetas locales y rutas de red desde Companion.
- El detector busca nuevos discos periódicamente.
- Las rutas monitoreadas se reescanean periódicamente.
- El estado ligero se reconstruye desde el servidor para omitir archivos sin cambios.
- Tras una pasada completa y confiable, los archivos ausentes se ocultan del catálogo sin borrar etiquetas, historial ni miniaturas.
- Si reaparecen, se reactivan automáticamente.
- La conciliación se omite cuando el escaneo tiene errores de acceso o del sistema de archivos.
- Esto reduce duplicados temporales cuando se mueven archivos entre unidades supervisadas.

## Borrado seguro

El servidor nunca borra directamente archivos de Windows.

1. El usuario marca un video como `Marcado para borrar`.
2. El servidor conserva la intención y el historial.
3. El Companion comprueba que el disco correspondiente está conectado.
4. Resuelve y valida la ruta canónica dentro de una raíz monitoreada.
5. Verifica tamaño, fecha de modificación y, cuando existe, huella visual.
6. Si el archivo fue reemplazado o la identidad no coincide, cancela el borrado y evita una eliminación peligrosa.
7. Si todo coincide, elimina el archivo y reporta el resultado.

La marca del usuario funciona como confirmación del borrado diferido. Esta función debe presentarse con claridad: el borrado físico es irreversible salvo que exista un respaldo externo.

## Seguridad

- Login obligatorio y cookie de sesión segura.
- JWT con algoritmo explícito y expiración.
- Validación de origen para operaciones web que modifican estado.
- Emparejamiento de Companion con código de un solo uso.
- Credencial individual, revocable y almacenada cifrada en Windows.
- En el servidor se conserva únicamente el hash de la credencial.
- Túnel saliente: no requiere exponer un puerto entrante de la PC Windows.
- Streaming limitado a lectura y a una sesión temporal autorizada.
- Rate limiting, límites de cuerpo/tiempo y respuestas sensibles `no-store`.
- CSP, HSTS bajo HTTPS y otras cabeceras de seguridad.
- Validación JPEG de miniaturas.
- Resolución canónica de rutas para prevenir escapes mediante symlinks o junctions.
- Folders configurables protegidos por PIN en la sesión web.
- PostgreSQL y miniaturas permanecen en volúmenes persistentes del usuario.
- Reporte privado de vulnerabilidades mediante GitHub Security Advisories.

## Instalación rápida

Linux, macOS o WSL:

```bash
curl -fsSL https://raw.githubusercontent.com/reiterstahl/videocat/main/install.sh | sh
```

Windows PowerShell con Docker Desktop:

```powershell
powershell -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/reiterstahl/videocat/main/install.ps1 | iex"
```

Después se abre:

```text
http://localhost:8081
```

El instalador crea la configuración, genera secretos, descarga las imágenes oficiales y levanta PostgreSQL, server y web. Para una instalación pública se recomienda HTTPS, `COOKIE_SECURE=true`, un `WEB_ORIGIN` exacto y exponer únicamente el contenedor web mediante reverse proxy.

## Mensajes principales sugeridos

### Hero en español

**Título:** VideoCAT

**Subtítulo:** Tu colección de videos, localizable aunque sus discos estén desconectados.

**Texto:** Cataloga discos externos, revisa capturas, encuentra duplicados y gestiona archivos desde una plataforma privada y self-hosted. Los videos originales permanecen bajo tu control.

**CTA principal:** Instalar con Docker

**CTA secundario:** Descargar Companion para Windows

### Hero in English

**Title:** VideoCAT

**Subtitle:** Find every video, even when its drive is offline.

**Body:** Catalog external drives, review captured frames, find likely duplicates, and manage files from a private self-hosted interface. Original videos stay under your control.

**Primary CTA:** Install with Docker

**Secondary CTA:** Download the Windows Companion

### Frases breves

- Un catálogo para los discos que no siempre están conectados.
- Metadata y miniaturas en el servidor. Videos originales en tus unidades.
- Revisa, compara, copia, reproduce y depura desde un solo lugar.
- Self-hosted, open source y diseñado para Windows + Docker.

## Estructura recomendada del website

1. Hero con producto visible y dos CTA.
2. Problema: colecciones repartidas entre discos desconectados.
3. Flujo visual de tres pasos: desplegar, emparejar, escanear.
4. Catálogo y búsqueda.
5. Review y decisiones.
6. Duplicados asistidos y recuperación de espacio.
7. Descargas y acciones mediante Companion.
8. Reproducción remota en móvil.
9. Privacidad y seguridad.
10. Instalación con los dos comandos de una línea.
11. Open source, licencia, GitHub y apoyo opcional.
12. Preguntas frecuentes.

La primera pantalla debe mostrar el producto real mediante una captura clara o una composición basada en capturas. Evitar una ilustración genérica de nube o streaming: VideoCAT es una herramienta operativa para administrar una colección local.

## Preguntas frecuentes sugeridas

### ¿VideoCAT sube mis videos al servidor?

No. El catálogo almacena metadatos, rutas relativas, miniaturas, etiquetas e historial. Durante una reproducción remota, el Companion transmite temporalmente los bytes solicitados mediante el servidor, pero el archivo no se conserva allí.

### ¿Todos los discos deben permanecer conectados?

No. Ese es el caso de uso principal: el catálogo sigue siendo consultable aunque una unidad esté guardada. Las acciones físicas requieren conectar el disco correspondiente.

### ¿Qué pasa si Windows cambia la letra de una unidad?

VideoCAT identifica los discos mediante su marcador UUID, no únicamente por la letra actual.

### ¿Puede encontrar el mismo video con otra resolución?

Sí, como posible duplicado. Combina metadatos con huellas visuales perceptuales distribuidas a lo largo del video. La decisión final siempre corresponde al usuario.

### ¿Puede borrar archivos?

Sí, de forma diferida mediante el Companion. Antes de borrar valida disco, ruta e identidad del archivo. El usuario debe entender que un borrado físico confirmado es irreversible.

### ¿Funciona desde Android?

La web es responsive y la reproducción remota está orientada a navegadores móviles modernos. La compatibilidad final depende del navegador, contenedor y codecs del video.

### ¿Es un reemplazo de Plex o Jellyfin?

No exactamente. VideoCAT prioriza catalogar colecciones distribuidas en unidades que suelen estar desconectadas, revisar capturas, detectar duplicados y ejecutar acciones locales. No pretende ser un servidor de transcodificación permanente.

### ¿Es obligatorio donar?

No. VideoCAT es software libre bajo AGPL. La distribución oficial incluye enlaces opcionales para apoyar al autor; los forks pueden quitarlos o reemplazarlos respetando la licencia y la atribución requerida.

## Identidad y tono

- Escribir siempre `VideoCAT`, respetando mayúsculas.
- Color de acento: naranja `#FC6121`.
- Identidad visual: gato blanco/naranja, fondos oscuros y superficies de herramienta profesional.
- Personalidad: directa, técnica pero accesible, privada, honesta y práctica.
- Evitar lenguaje corporativo vacío, promesas absolutas o estética de servicio cloud genérico.
- Mostrar datos, tablas, miniaturas, discos, progreso y decisiones reales del producto.
- Las donaciones deben ser visibles pero discretas y nunca bloquear la experiencia.

## SEO sugerido

Título:

```text
VideoCAT — Self-hosted video catalog for external drives
```

Descripción:

```text
Catalog external hard drives, browse thumbnails, review videos, find likely duplicates and manage local files with a private open-source web app and Windows Companion.
```

Conceptos relevantes:

- self-hosted video catalog
- external hard drive catalog
- local video library manager
- video duplicate finder
- Windows companion app
- Docker video catalog
- offline drive catalog
- private media catalog

## Capturas recomendadas

- Catálogo completo en escritorio.
- Catálogo responsive en móvil.
- Modal de detalle con galería de 15 fotogramas.
- Review con sus indicadores.
- Asistente de duplicados comparando dos videos.
- Ranking de discos por espacio recuperable.
- Cola `A descargar` con progreso y velocidad.
- Reproductor remoto en Android.
- Administración con capacidad de unidades y Companions.
- Menú de bandeja y ventana de actividad del Companion.

Antes de publicar capturas, ocultar nombres de archivo privados, rutas personales, dominios internos, tokens, IP privadas y patrones reales de folders protegidos.

## Límites y afirmaciones que deben evitarse

- No afirmar que VideoCAT reconoce contenido mediante IA; usa metadatos y huellas perceptuales deterministas.
- No afirmar que garantiza duplicados exactos; presenta candidatos y confianza para decisión humana.
- No afirmar que los videos nunca pasan por el servidor: en reproducción remota los bytes se retransmiten temporalmente, aunque no se almacenan.
- No afirmar que reproduce todos los codecs; depende del navegador y ofrece remux limitado, no transcodificación universal.
- No afirmar que reproduce desde un disco desconectado.
- No afirmar que el Companion funciona en macOS o Linux; actualmente es para Windows.
- No afirmar soporte multiusuario avanzado; la instalación actual parte de una cuenta administrativa configurada por entorno.
- No publicar secretos, rutas privadas ni nombres privados usados por una instalación concreta.
- No exigir conservar botones de donación en forks; la obligación proviene de AGPL y de los avisos de copyright aplicables, no de los enlaces de apoyo.

## Prioridad de enlaces y CTA

1. Website / demo visual: <https://videocat.centeran.com>
2. Instalación Docker de una línea.
3. Companion Windows: <https://github.com/reiterstahl/videocat/releases/latest>
4. Código fuente: <https://github.com/reiterstahl/videocat>
5. Documentación y seguridad dentro del repositorio.
6. GitHub Sponsors y PayPal como acciones secundarias.
