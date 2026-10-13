# Plan: traslados seguros, consolidar carpetas y agrupar archivos

Estado: **las 4 fases terminadas**. Motor y Consolidar carpetas en `v0.2.14` (Companion `0.2.6`), Agrupar archivos en `v0.2.15` y cierre en `v0.2.16`.

## Objetivo

1. **Consolidar carpetas**: llevar el contenido de las carpetas pequeñas de un grupo (ej. `Testing` de 230 GB en `F:`) a la carpeta más grande del grupo (ej. `Testing` de 1.7 TB en `E:`).
2. **Agrupar archivos**: partir de una carpeta (ej. `testing001`), encontrar archivos con nombres parecidos en cualquier disco y decidir uno por uno, como en Review: **F agrupar** (se mueven a esa carpeta) o **J ignorar** (no se tocan).

En los dos casos los discos casi nunca están conectados a la vez, así que los archivos pasan por una **carpeta temporal local** del Companion: salen del disco de origen, esperan ahí y llegan al disco de destino cuando el usuario lo conecta.

## Principio de seguridad (no negociable)

Un archivo **nunca existe en menos de un lugar verificado**:

1. Origen → temporal: se copia a un nombre provisional (`.vcpart`), se calcula SHA-256 **mientras se copia**, se renombra, se **vuelve a leer la copia entera** y se compara el hash. Solo si coincide, y si el origen sigue siendo el mismo archivo (tamaño, fecha y huella visual, igual que los borrados actuales), se borra del origen.
2. Temporal → destino: igual. Se copia a `.vcpart`, se verifica releyendo, se renombra, se actualiza el catálogo y **recién entonces** se borra la copia temporal.
3. Cada paso se anota en un **diario local** del Companion antes y después de hacerlo. Si Windows se reinicia o se desconecta un disco a mitad de camino, al volver el Companion retoma desde el último paso confirmado y nunca borra algo cuya copia no esté verificada.
4. Nada se sobrescribe. Si en el destino existe un archivo con el mismo nombre:
   - con el mismo contenido (mismo tamaño y SHA-256): no se mueve; el original queda marcado como **duplicado probable** para tu revisión en Duplicados;
   - distinto: se guarda como `nombre (2).ext`.
5. Las rutas se validan de forma canónica (sin escapes por enlaces o junctions), como hoy en borrados y descargas.

## Espacio

- **Carpeta temporal**: se configura en el Companion (Configuración › Archivos). Siempre debe quedar libre al menos el **5 % del disco local**; el Companion no empieza un archivo si al terminar quedaría por debajo.
- **Disco de destino**: la falta de espacio **no impide crear el traslado** (cambio de `0.2.19`, a pedido): los archivos salen de su disco y esperan en la carpeta temporal. Con el espacio del **último escaneo**, descontando lo que ya va en camino, la web avisa *Faltará espacio en…* y cuánto liberar. Al conectar el destino, el Companion vuelve a medir en vivo; si no alcanza, el archivo queda en *Sin espacio* y la web pide **liberar espacio en ese disco**; se entrega cuando hay lugar.

## Modelo

- `TransferJob`: tipo (`consolidar` / `agrupar`), carpeta de destino (disco + ruta), estado, creado por, fechas.
- `TransferItem`: archivo, origen (disco + ruta), destino final, tamaño, SHA-256, estado y error.
- Estados de un archivo: `pendiente → copiando al temporal → en temporal (verificado) → origen borrado → esperando destino → copiando al destino → en destino (verificado) → temporal borrado → listo`, más `pausado por espacio`, `duplicado probable`, `falló (reintentable)` y `cancelado`.
- Mientras un archivo está en tránsito sigue visible en el catálogo con la marca **"En tránsito"** y su disco de destino; no se puede reproducir ni borrar hasta que llegue.
- Cancelar un traslado nunca borra nada: lo que está en la carpeta temporal se devuelve al origen o se deja listo para el destino, según elijas.

## Interfaz

- **Uso por carpeta → Consolidar**: en cada grupo repetido, un botón **Consolidar** muestra el plan antes de empezar: destino propuesto (la ubicación más grande, editable), qué se mueve desde cada disco, cuánto ocupa y si cabe en el destino y en la carpeta temporal.
- **Agrupar archivos** (desde un bloque de Uso por carpeta o desde el árbol de carpetas del catálogo: *Buscar archivos de esta carpeta*): busca en todos los discos los archivos cuyo nombre contiene el de la carpeta, ignorando mayúsculas, acentos, puntos y separadores (`testing001`, `Testing001`, `.Testing001`, `testing_001`, `Testing 001`…), excluyendo los que ya están dentro. Abre una sesión **reutilizando Review**: `F` agrupar, `J` ignorar (no vuelve a proponerse para esa carpeta), `S` saltar, `Z` deshacer, con la misma confirmación animada.
- **Traslados** (sección nueva): lista de traslados con progreso, espacio usado en la carpeta temporal, y el aviso principal **"Conecta *WD Elements* para continuar: 230 GB esperando"**. También muestra errores y permite pausar, reanudar o cancelar.
- **Companion**: ruta de la carpeta temporal con su espacio libre y el 5 % reservado; actividad de los traslados en *Ver actividad*.

## Fases

1. **Motor de traslados** (servidor + Companion): modelos, API, diario local, copia con hash, verificación, reanudación tras cortes y pruebas que simulan cortes en cada paso. Sin interfaz salvo lo mínimo para probar.
2. **Consolidar carpetas**: botón y plan en Uso por carpeta, sección Traslados, avisos de "conecta el disco" y de espacio.
3. **Agrupar archivos**: búsqueda por nombre, sesión estilo Review con F/J y su traslado.
4. **Cierre**: pruebas e2e del flujo completo con un Companion simulado, documentación (README, OPERATIONS) y versión nueva del Companion (se actualiza solo).

## Decisiones confirmadas

1. **Carpeta destino con estrella ⭐**: solo una carpeta marcada puede recibir archivos. Debe ser la ubicación más grande de su grupo; si hay otra más grande, la interfaz lo avisa.
2. **Agrupar archivos** encuentra también nombres con una letra distinta (`testng001`), además de las variantes de mayúsculas, acentos, puntos y separadores.
3. **Traslados** es la sección principal y agrupa **Consolidar** y **Agrupar**, cada una con una explicación breve de lo que hace.

## Avance

- [x] **Fase 1 — Motor de traslados**
  - Servidor: tablas `TransferDestination`, `TransferJob` y `TransferItem` (migración `0021_transfers`), con un índice que impide que un archivo esté en dos traslados activos; máquina de estados en `transfer-states.ts`; rutas para el Companion (`/api/agent/transfers/work`, `transition`, `lookup`) y para la web (carpetas con estrella, crear, listar, pausar, reanudar y cancelar traslados), con control de espacio del destino (último escaneo menos lo que ya está en camino, dejando libre el 1 %, mínimo 1 GB) y archivos idénticos ya presentes en el destino excluidos.
  - Los escaneos no ocultan un archivo que está en la carpeta temporal y la cola de borrados no toca archivos en traslado.
  - Companion: `transfer-engine.ts` (copia con SHA-256, verificación releyendo, borrado solo tras verificar y registrar, reanudación desde cualquier estado, nombres `(2)`, duplicados idénticos, espacio del 5 % en la carpeta temporal y del destino, limpieza de copias de traslados terminados). Carpeta temporal en Configuración › Archivos (`COMPANION_STAGING_DIR`).
  - Pruebas: 16 del motor (incluidos 7 cortes simulados en cada paso), 4 de la máquina de estados y 3 de API.
- [x] **Fase 2 — Consolidar carpetas**
  - Uso por carpeta › Carpetas repetidas: estrella por ubicación (solo carpetas visibles; las protegidas con PIN bloqueado no pueden ser destino), aviso si hay una ubicación más grande que la marcada y botón **Consolidar en …**.
  - Diálogo con el plan antes de crear nada (`POST /api/transfers/consolidate/preview`): qué sale de cada carpeta, cuánto ocupa, espacio libre en el destino (último escaneo, menos lo que ya va en camino y la reserva), archivos idénticos que se quedan para Duplicados y aviso si falta la carpeta temporal o si pasará por partes por el 5 % reservado.
  - Sección **Traslados** (`/traslados`, con contador en el menú): explicación de Consolidar y Agrupar, avisos "Conecta *disco* para continuar" y "Libera espacio en *disco*" (`GET /api/transfers/summary`), estado de la carpeta temporal que el Companion informa en su heartbeat, carpetas con estrella, y traslados con progreso, detalle por archivo, pausar, reanudar y cancelar.
  - Catálogo: marca **Por trasladar / En tránsito / Sin espacio** en tarjetas y detalle.
  - Pruebas: 3 unitarias del resumen, 1 de API (plan, creación, catálogo, heartbeat y avisos) y 1 e2e (estrella → plan → Traslados → pausa → cancelación).
- [x] **Fase 3 — Agrupar archivos**
  - Comparación de nombres (`name-match.ts`): ignora mayúsculas, acentos, puntos, espacios y separadores, y acepta **una letra de diferencia** desde 5 caracteres. La letra distinta nunca es un número: `testng001` es parecido a `testing001`, pero `testing002` no (suele ser otro proyecto). La extensión no cuenta.
  - Entrada desde **Traslados › Agrupar archivos** (buscar la carpeta por nombre; la elegida queda con estrella y avisa si hay otra más grande con el mismo nombre), desde **Carpetas con estrella** y desde **Uso por carpeta** (botón *Agrupar archivos* junto a *Consolidar*).
  - Sesión que **reutiliza Review** (`ReviewSession` ahora acepta textos, íconos y estadísticas): `F` agrupar en la carpeta, `J` ignorar (no vuelve a proponerse para esa carpeta; tabla `TransferGroupIgnore`, migración `0022`), `S` saltar, `Z` deshacer, con la misma animación. Primero los que contienen el nombre, después los parecidos, cada uno marcado.
  - Cada `F` suma el archivo a un único traslado de tipo *Agrupar* por carpeta, con el mismo control de espacio; deshacer lo saca mientras siga pendiente (si el Companion ya lo tomó, termina su camino). Se excluyen los que ya están en la carpeta, en otro traslado, ignorados o con una copia idéntica en el destino (quedan para Duplicados).
  - Pruebas: 4 unitarias de nombres, 1 de API (búsqueda, candidatos, F, J, Z y carpetas protegidas) y 1 e2e de la sesión.
  - El acceso desde el árbol de carpetas del catálogo llegó en la fase 4.
  - `0.2.22`: **palabras clave** opcionales por carpeta con estrella (hasta 20, mínimo 3 letras o números, sin repetir el nombre); la búsqueda usa la mejor coincidencia entre el nombre y las palabras, y la sesión indica cuál coincidió.
- [x] **Fase 4 — Cierre**
  - e2e del flujo completo con un **Companion simulado**: el motor real de traslados trabajando sobre carpetas temporales y la API real. Registra dos discos, consolida desde la web y comprueba que el archivo sale del origen solo con la copia verificada en la carpeta temporal, que la web pide conectar el destino, y que al conectarlo llega con el mismo SHA-256, se vacía la carpeta temporal y el catálogo apunta al disco nuevo.
  - Árbol de carpetas del catálogo: ícono **Agrupar archivos** en cada carpeta, que abre Traslados con la búsqueda cargada.
  - Revisión de seguridad: cada cambio de estado que informa el Companion ahora se aplica de forma **atómica**, condicionado al estado y al Companion que lo tenía (y, al tomar un archivo, a que el traslado siga activo). Una cancelación desde la web o dos Companions a la vez ya no pueden pisarse. Prueba de API incluida.
  - Documentación: README en español e inglés (sección *Traslados seguros*, teclas, variables y capturas), OPERATIONS, Docker Hub, TRAY.md y brief del sitio. El demo trae una carpeta temporal ficticia.
  - Resuelto distinto a lo planeado: el espacio libre de la carpeta temporal se muestra en la web (Traslados), no en el Companion; la actividad de los traslados ya aparece en *Ver actividad*. No hizo falta otra versión del Companion: la `0.2.6` ya trae todo lo necesario.

## Pendientes conocidos (menores)

- 🟡 Dos traslados creados al mismo tiempo hacia el mismo disco podrían, entre los dos, pedir más espacio del que hay. No hay riesgo para los datos: el Companion vuelve a medir el destino al conectarlo y pausa con "Libera espacio".
- 🟡 Si se cancela un traslado y después se quita la estrella, los registros terminados de ese traslado se borran junto con la carpeta destino; el historial de acciones (Auditoría) los conserva.
