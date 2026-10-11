# Plan: traslados seguros, consolidar carpetas y agrupar archivos

Estado: **fase 1 de 4 terminada** (motor de traslados). "Uso por carpeta" (solo lectura) está entregado en `v0.2.13`.

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
- **Disco de destino**: al crear el traslado se usa el espacio libre de su **último escaneo**, descontando lo que ya está en camino hacia él. Al conectarlo se vuelve a medir en vivo; si no alcanza, el traslado se pausa y la web pide **liberar espacio en ese disco** (con acceso directo a Review y Duplicados filtrados por ese disco).

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
- [ ] **Fase 2 — Consolidar carpetas**: estrella en Uso por carpeta, plan previo con espacio, sección Traslados con progreso y avisos de "conecta el disco" y de espacio.
- [ ] **Fase 3 — Agrupar archivos**: búsqueda por nombre con parecidos de una letra, sesión estilo Review con F/J.
- [ ] **Fase 4 — Cierre**: flujo completo e2e con un Companion simulado, documentación y nueva versión del stack y del Companion.
