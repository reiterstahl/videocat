# Plan De Rediseño De La Interfaz

[English version](UI_REDESIGN_PLAN.md)

El rediseño de `v0.2.0` moderniza la web sin cambiar la API ni los flujos existentes. Cada fase se publicó con pruebas de interacción en escritorio y móvil.

## Fases Entregadas En v0.2.0

- **Fase 1 — Shell y temas.** Tokens de diseño; apariencia clara, oscura, OLED o del sistema; seis esquemas de color; densidad cómoda o compacta; barra lateral contraíble; header fijo; tira de discos con uso; franja de KPIs; tipografía Geist autoalojada.
- **Fase 2 — Catálogo.** Búsqueda en el header con `Ctrl K`; vista en cuadrícula o lista; chips de filtros removibles; menú de orden; filtros contraíbles; panel lateral de detalle que se convierte en cajón en pantallas angostas.
- **Fase 3 — Review.** Inicio con KPIs y tarjetas; sesión inmersiva con visor de fotogramas, mantener/saltar/borrar, deshacer, etiquetas numeradas y siguiente video precargado.
- **Fase 4 — Duplicados.** Grupos con confianza y copia recomendada, acción "Resolver" por grupo, ranking de discos en línea y comparación asistida A/B a pantalla completa.
- **Fase 5 — Móvil.** Barra de pestañas inferior, hoja "Más", filtros y acciones masivas acopladas abajo, KPIs en una fila y selección táctil con pulsación larga.

## Fase 6: Vistas Restantes

Estado: pendiente. Estas vistas ya heredan el tema y el shell, pero conservan su maquetación anterior.

- [ ] **A descargar.** Panel de transferencia con progreso y velocidad en el nuevo sistema visual; cola como lista compacta con estados; selección aleatoria por GB en un panel lateral; acciones de cola en una barra coherente con el catálogo.
- [ ] **Esquema de uso.** Mapa de carpetas por tamaño con navegación por niveles, filtros por disco y acceso directo al catálogo filtrado por carpeta.
- [ ] **Auditoría.** Pestañas de errores y del registro `ActionAudit`, con búsqueda, filtros por edad, categoría y disco, paginación, agrupación de errores repetidos y exportación (ver Fases 3 y 7 de [ROADMAP.es.md](ROADMAP.es.md)).
- [ ] **Administración.** Tarjetas de discos con uso físico y catalogado, Companions emparejados con estado del túnel y revocación, y mantenimiento (retención) en una sección propia.
- [ ] **Perfil.** Secciones separadas para seguridad (PIN y carpetas protegidas), Companion local (token), reproducción (Chromecast) y apariencia e idioma.
- [ ] **Deuda técnica.** Retirar estilos heredados que ya no se usan, dividir `App.tsx` por vistas y llevar al repositorio las pruebas de interacción de Playwright usadas durante el rediseño.

Criterio de finalización: todas las vistas usan los componentes y tokens del nuevo sistema, funcionan a 390 px sin scroll horizontal y quedan cubiertas por pruebas de interacción.
