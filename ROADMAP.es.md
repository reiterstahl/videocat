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

- [ ] Generar una identidad criptográficamente aleatoria para cada instalación del companion.
- [ ] Mostrar desde el companion un código de emparejamiento temporal y de un solo uso.
- [ ] Guardar únicamente hashes de credenciales en el servidor y proteger los secretos locales con Windows Credential Manager o DPAPI.
- [ ] Dar a cada agente nombre, última conexión, capacidades permitidas y controles de revocación.
- [ ] Sustituir `AGENT_TOKEN` por credenciales por agente, aceptando el token anterior durante una versión de transición.
- [ ] Exigir autenticación en todos los endpoints locales salvo el mínimo necesario para descubrir el estado.
- [ ] Evaluar una cola de acciones firmadas en el servidor para órdenes iniciadas desde otro dispositivo.

Criterio de finalización: un administrador puede emparejar, inspeccionar y revocar un companion sin rotar las credenciales de los demás, y ningún endpoint destructivo depende únicamente del origen del navegador.

## Fase 3: Auditoría Persistente De Acciones

Prioridad: alta para operaciones destructivas.

- [ ] Crear un registro anexable para borrado, copia, cancelación, reparación de miniaturas y eliminación del catálogo.
- [ ] Registrar actor, agente, ID de solicitud, objetivo, fechas, resultado y error saneado.
- [ ] Incorporar claves de idempotencia para que un reintento no ejecute dos veces una operación destructiva.
- [ ] Añadir búsqueda, exportación y retención configurables en la vista de auditoría.
- [ ] No almacenar secretos ni rutas personales absolutas cuando no sean necesarias.

Criterio de finalización: cada operación física o destructiva del catálogo puede seguirse desde la solicitud hasta el resultado final y admite reintentos seguros.

## Fase 4: Concesiones De Escaneo Y Conciliación

Prioridad: media-alta. Protege la integridad del catálogo cuando coinciden escaneos.

- [ ] Permitir una sola concesión activa de conciliación por disco y root monitoreado.
- [ ] Añadir propietario, generación y caducidad de la concesión al escaneo.
- [ ] Renovar concesiones durante escaneos largos y recuperar de forma segura las abandonadas.
- [ ] Permitir que únicamente la generación exitosa más reciente marque archivos como ausentes.
- [ ] Probar escaneos concurrentes, interrumpidos y reanudados.

Criterio de finalización: un escaneo antiguo o interrumpido no puede ocultar archivos reportados por uno más reciente.

## Fase 5: Contenedores Sin Root

Prioridad: media-alta. Requiere una migración cuidadosa de volúmenes.

- [ ] Ejecutar la API como usuario sin privilegios y con filesystem raíz de solo lectura cuando sea viable.
- [ ] Ejecutar la imagen web con Nginx sin privilegios en un puerto interno alto.
- [ ] Permitir escritura únicamente en miniaturas y directorios temporales necesarios.
- [ ] Eliminar capabilities, activar `no-new-privileges` y documentar ajustes compatibles con Portainer.
- [ ] Permitir direcciones o CIDR explícitos de proxies confiables para impedir la falsificación directa de cabeceras de IP reenviada.
- [ ] Proveer y probar una migración única de permisos para volúmenes de miniaturas existentes.

Criterio de finalización: ambos contenedores funcionan sin root, las instalaciones existentes conservan sus miniaturas y los healthchecks continúan pasando.

## Fase 6: Escalabilidad De Indexado Y Consultas

Prioridad: media.

- [ ] Sustituir consultas por archivo con transacciones acotadas y upserts en lote.
- [ ] Añadir índices basados en planes de ejecución medidos para review, folders, categorías y duplicados.
- [ ] Llevar el cálculo costoso de facets a SQL o resúmenes en caché.
- [ ] Sustituir `ORDER BY random()` por un muestreo escalable para catálogos grandes.
- [ ] Crear datos de prueba y presupuestos de rendimiento para 25k, 100k y 500k archivos.

Criterio de finalización: el escaneo y las consultas principales cumplen límites documentados sin crecimiento de memoria no acotado.

## Fase 7: Retención De Errores Y Observabilidad

Prioridad: media.

- [ ] Definir retención independiente para errores del agente, historial de escaneos y acciones exitosas.
- [ ] Añadir paginación, filtros por edad/categoría y limpieza administrativa.
- [ ] Agrupar errores repetidos conservando primera fecha, última fecha y cantidad.
- [ ] Usar IDs estructurados de solicitud y correlación entre servidor y companion.
- [ ] Publicar diagnóstico de salud y colas sin exponer secretos ni contenido de archivos.

Criterio de finalización: los datos de diagnóstico siguen siendo útiles y el crecimiento de la base es predecible y controlable.

## Fase 8: Garantía De Respaldo Y Restauración

Prioridad: media y necesaria antes de declarar preparación para producción.

- [ ] Proveer scripts soportados para PostgreSQL, miniaturas y configuración del despliegue.
- [ ] Cifrar respaldos que contengan rutas o metadatos privados.
- [ ] Documentar procedimientos para Portainer y Docker Compose convencional.
- [ ] Añadir verificación de compatibilidad y un comando para validar restauraciones.
- [ ] Generar SBOM y firmar artefactos e imágenes de contenedor desde el flujo de publicación.
- [ ] Ejecutar y documentar una restauración limpia antes de cada release estable.

Criterio de finalización: un procedimiento documentado y probado restaura en una instalación nueva la base, miniaturas y configuración de VideoCAT.

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
