# Hoja De Ruta De Seguridad Y Fiabilidad De VideoCAT

[English version](ROADMAP.md)

Esta hoja de ruta convierte los hallazgos pendientes de la auditoría en trabajo incremental. No establece fechas deliberadamente: cada cambio debe publicarse cuando estén comprobadas su compatibilidad y su vía de recuperación.

## Base Actual

Completado en septiembre de 2026:

- La auditoría de dependencias no reporta vulnerabilidades npm conocidas.
- CI realiza instalación limpia, migraciones y pruebas con PostgreSQL temporal, auditoría de dependencias de producción, typecheck y build.
- Dependabot supervisa npm, imágenes base de Docker y GitHub Actions.
- Las operaciones web validan el origen configurado y utilizan cabeceras seguras.
- Algoritmos JWT, tamaños de entrada, tipos de subida y tiempos de solicitud tienen límites explícitos.
- El companion usa rutas canónicas y copias sin sobrescritura accidental.
- Las imágenes Docker usan Node.js 24, una versión mantenida de Nginx y healthchecks.
- `SECURITY.md` documenta cómo reportar vulnerabilidades de forma privada.

## Principios De Implementación

- Conservar bases de datos, miniaturas, categorías y configuraciones existentes.
- Acompañar las migraciones con respaldo y una ruta de reversión probada.
- Hacer explícitas, idempotentes y auditables las operaciones destructivas.
- Mantener compatibilidad durante una versión al sustituir tokens o configuración.
- Añadir pruebas antes de cambiar autenticación o el ciclo de vida de archivos.

## Fase 1: Red De Seguridad Automatizada

Prioridad: alta. Debe completarse antes de los cambios arquitectónicos de seguridad.

- [x] Añadir pruebas unitarias para orígenes, JWT, hashes del PIN, rutas protegidas y esquemas compartidos.
- [x] Añadir pruebas de integración API para login, autenticación del agente, categorías, colas y conciliación.
- [x] Probar en el companion la contención de rutas canónicas, roots monitoreados, colisiones y copias estancadas.
- [x] Incorporar PostgreSQL temporal en CI y ejecutar las migraciones de Prisma en las pruebas.
- [x] Definir cobertura mínima para módulos sensibles y bloquear regresiones desde CI.

Fase completada: la suite cubre seguridad, autenticación, PIN persistido, rutas, transferencias, categorías, colas y conciliación. CI ejecuta `npm test` con PostgreSQL temporal y exige al menos 90% de líneas, 70% de ramas y 95% de funciones en los helpers sensibles seleccionados.

Criterio de finalización: autenticación, folders protegidos, transiciones de cola y rutas destructivas tienen pruebas reproducibles en cada pull request.

## Fase 2: Emparejamiento E Identidad Del Companion

Prioridad: alta. Resuelve el token local opcional y el `AGENT_TOKEN` compartido.

- [x] Generar y persistir una identidad criptográficamente aleatoria para cada instalación del companion.
- [x] Emparejar mediante un código temporal de un solo uso (10 minutos, con límite de intentos por IP).
- [x] Guardar únicamente hashes de credenciales en el servidor y proteger los secretos locales con DPAPI (`safeStorage` de Electron).
- [x] Dar a cada agente nombre, última conexión, capacidades permitidas y controles de revocación.
- [x] Sustituir `AGENT_TOKEN` por credenciales por agente, aceptando el token anterior durante la transición.
- [ ] Retirar la autenticación heredada con `AGENT_TOKEN` una vez que todos los companions estén emparejados.
- [x] Exigir autenticación en todos los endpoints locales salvo `/health`. Desde `v0.2.0` `COMPANION_TOKEN` es obligatorio: la app de bandeja lo genera y la web lo guarda desde Perfil.
- [ ] Evaluar una cola de acciones firmadas en el servidor para órdenes iniciadas desde otro dispositivo. El túnel saliente ya transporta órdenes de streaming; abrir, copiar y borrar siguen usando el listener local o el sondeo.

Estado: el emparejamiento, las credenciales individuales cifradas, las capacidades y la revocación están entregados desde `v0.1.14` (ver [REMOTE_STREAMING_PLAN.es.md](REMOTE_STREAMING_PLAN.es.md)). Desde `v0.2.0` el listener local exige token; queda retirar el token compartido.

Criterio de finalización: un administrador puede emparejar, inspeccionar y revocar un companion sin rotar las credenciales de los demás, y ningún endpoint destructivo depende únicamente del origen del navegador.

## Fase 3: Auditoría Persistente De Acciones

Prioridad: alta para operaciones destructivas.

- [x] Crear el registro anexable `ActionAudit`. Ya registra borrado de archivos, fin de escaneo, vaciado de cola/historial de descargas y limpieza de mantenimiento.
- [ ] Extender el registro a copia, cancelación, reparación de miniaturas y eliminación del catálogo.
- [x] Registrar actor, agente, ID de solicitud, objetivo, fechas, resultado y error saneado.
- [x] Incorporar claves de idempotencia para las limpiezas destructivas de cola.
- [ ] Extender las claves de idempotencia al resto de operaciones destructivas.
- [x] Retención configurable (`ACTION_AUDIT_RETENTION_DAYS`) con limpieza administrativa.
- [ ] Añadir búsqueda y exportación del registro en una pestaña de la interfaz.
- [ ] No almacenar secretos ni rutas personales absolutas cuando no sean necesarias. Pendiente revisar: el objetivo de `scan.finish` guarda la ruta raíz escaneada.

Criterio de finalización: cada operación física o destructiva del catálogo puede seguirse desde la solicitud hasta el resultado final y admite reintentos seguros.

## Fase 4: Concesiones De Escaneo Y Conciliación

Prioridad: media-alta. Protege la integridad del catálogo cuando coinciden escaneos.

- [x] Permitir una sola concesión activa de conciliación por disco y root monitoreado.
- [x] Añadir propietario, generación y caducidad de la concesión al escaneo.
- [x] Renovar concesiones durante escaneos largos y recuperar de forma segura las abandonadas.
- [x] Permitir que únicamente la generación más reciente marque archivos como ausentes.
- [ ] Probar escaneos concurrentes, interrumpidos y reanudados.

Criterio de finalización: un escaneo antiguo o interrumpido no puede ocultar archivos reportados por uno más reciente.

## Fase 5: Contenedores Sin Root

Prioridad: media-alta. Requiere una migración cuidadosa de volúmenes.

- [x] Ejecutar la API como usuario sin privilegios (`node`) y con filesystem raíz de solo lectura.
- [x] Ejecutar la imagen web con Nginx sin privilegios en un puerto interno alto (`8080`).
- [x] Permitir escritura únicamente en miniaturas y directorios temporales necesarios.
- [x] Eliminar capabilities, activar `no-new-privileges` y documentar ajustes compatibles con Portainer.
- [x] Permitir direcciones o CIDR explícitos de proxies confiables (`TRUST_PROXY_CIDRS`).
- [ ] Automatizar y probar la migración de permisos para volúmenes de miniaturas existentes. Hoy se documenta un `chown` manual en [OPERATIONS.md](OPERATIONS.md).

Criterio de finalización: ambos contenedores funcionan sin root, las instalaciones existentes conservan sus miniaturas y los healthchecks continúan pasando.

## Fase 6: Escalabilidad De Indexado Y Consultas

Prioridad: media.

- [ ] Sustituir consultas por archivo con transacciones acotadas y upserts en lote. La ingesta aún crea o actualiza cada video individualmente.
- [x] Añadir índices para Review.
- [ ] Añadir índices basados en planes de ejecución medidos para folders, categorías y duplicados.
- [ ] Llevar el cálculo costoso de facets a SQL o resúmenes en caché.
- [x] Sustituir `ORDER BY random()` por muestreo con pivote UUID indexado en Review.
- [ ] Aplicar el mismo muestreo a la selección aleatoria de `A descargar`, que todavía usa `ORDER BY random() LIMIT 2000`.
- [ ] Crear datos de prueba y presupuestos de rendimiento para 25k, 100k y 500k archivos.

Criterio de finalización: el escaneo y las consultas principales cumplen límites documentados sin crecimiento de memoria no acotado.

## Fase 7: Retención De Errores Y Observabilidad

Prioridad: media.

- [x] Definir retención independiente para errores del agente, historial de escaneos y acciones (`AGENT_ERROR_RETENTION_DAYS`, `SCAN_RETENTION_DAYS`, `ACTION_AUDIT_RETENTION_DAYS`).
- [x] Limpieza administrativa mediante `POST /api/admin/maintenance/prune`.
- [ ] Añadir paginación y filtros por edad/categoría en la vista de auditoría.
- [ ] Agrupar errores repetidos conservando primera fecha, última fecha y cantidad.
- [ ] Usar IDs estructurados de solicitud y correlación entre servidor y companion. Hoy solo el streaming remoto correlaciona `requestId`.
- [ ] Publicar diagnóstico de salud y colas sin exponer secretos ni contenido de archivos. `GET /api/health` solo devuelve `ok`.

Criterio de finalización: los datos de diagnóstico siguen siendo útiles y el crecimiento de la base es predecible y controlable.

## Fase 8: Garantía De Respaldo Y Restauración

Prioridad: media y necesaria antes de declarar preparación para producción.

- [x] Proveer scripts soportados para PostgreSQL, miniaturas y configuración del despliegue (`scripts/backup.sh`, `backup.ps1`, `restore.sh`).
- [ ] Cifrar respaldos que contengan rutas o metadatos privados. Los scripts no cifran; hoy se delega al administrador.
- [x] Documentar procedimientos para Portainer y Docker Compose convencional.
- [x] Añadir un comando para validar respaldos (`scripts/verify-backup.sh`, con checksums).
- [ ] Añadir verificación de compatibilidad de versión al restaurar.
- [x] Generar SBOM con atestación de artefactos desde el flujo de tags.
- [ ] Firmar imágenes de contenedor desde el flujo de publicación.
- [ ] Ejecutar y documentar una restauración limpia antes de cada release estable.

Criterio de finalización: un procedimiento documentado y probado restaura en una instalación nueva la base, miniaturas y configuración de VideoCAT.

## Consolidación Entregada

La consolidación de septiembre de 2026 implementa el libro `ActionAudit`, claves de idempotencia para limpiezas de cola, leases con generación por disco/root, renovación de lease en lotes, índices de Review, muestreo UUID indexado, retención configurable, scripts de respaldo/verificación/restauración, SBOM con atestación y contenedores de aplicación sin root. La referencia operativa está en [OPERATIONS.md](OPERATIONS.md).

Lo pendiente queda marcado en cada fase. Los puntos más relevantes son la pestaña de auditoría en la interfaz, las pruebas de escaneos concurrentes, la ingesta en lote, los presupuestos de rendimiento con 100k/500k videos, la agrupación de errores, el cifrado de respaldos y un simulacro de restauración antes de cada release estable.

## Orden Recomendado

1. Red de seguridad automatizada.
2. Auditoría persistente e idempotencia.
3. Emparejamiento y credenciales por agente.
4. Concesiones de escaneo y conciliación.
5. Migración a contenedores sin root.
6. Escalabilidad de indexado y consultas.
7. Retención y observabilidad.
8. Automatización de respaldo y restauración.

Los reportes de seguridad deben seguir [SECURITY.md](SECURITY.md). El trabajo público puede organizarse mediante issues y pull requests enlazados con la fase correspondiente.
