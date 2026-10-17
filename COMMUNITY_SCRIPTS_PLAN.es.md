# VideoCAT en community-scripts (Proxmox VE Helper-Scripts)

Plan para publicar VideoCAT en [community-scripts.org](https://community-scripts.org) (antes "tteck scripts"): un comando en el host de Proxmox crea un contenedor LXC con la app instalada y la actualiza después desde el propio contenedor.

Revisado el 2026-10-17 contra los repositorios vigentes (`community-scripts/ProxmoxVE` y `community-scripts/DevScripts`).

## Cómo entra un script nuevo

1. **Nunca directo a ProxmoxVE.** Los PR de scripts nuevos contra `ProxmoxVE` se cierran sin revisión. Los scripts nuevos van a [DevScripts](https://github.com/community-scripts/DevScripts), que antes se llamaba ProxmoxVED.
2. Fork de DevScripts, rama `feat/videocat`, y dos archivos:
   - `ct/videocat.sh`: crea el contenedor, define los recursos y trae `update_script()`.
   - `install/videocat-install.sh`: instala la app dentro del contenedor.
   - Más el JSON de metadatos (`json/videocat.json`: nombre, descripción, puerto, recursos, logo, notas). En ProxmoxVE los metadatos se gestionan desde el sitio web (PocketBase).
3. PR contra DevScripts con su plantilla. Marca obligatoria si se usó IA: **"AI was used"**, confirmando que se siguió su [`AGENTS.md`](https://github.com/community-scripts/DevScripts/blob/main/AGENTS.md) y su `pve-script-creator.agent.md`, e indicando modelo y nivel de razonamiento. Hay que declarar "Tested on" (por ejemplo, PVE 9.x / Debian 13, instalación limpia y actualización).
4. Prueba comunitaria: cada script en prueba tiene un issue en DevScripts y un hilo en Discord con el comando exacto. Sin respuestas de quienes lo prueban no se publica.
5. Los mantenedores lo promueven a ProxmoxVE. De ahí lo toma también el repo de Incus.

Opcional, antes del PR: abrir una solicitud en [Discussions › Script request](https://github.com/community-scripts/ProxmoxVE/discussions/new?category=request-script) para ver si les interesa.

## Requisitos de elegibilidad y dónde está VideoCAT

Son los del formulario de solicitud. Los proyectos que no los cumplen "pueden cerrarse sin más evaluación".

| Requisito | VideoCAT hoy | Estado |
| --- | --- | --- |
| Autohospedado | Sí | ✅ |
| Repositorio público oficial | `reiterstahl/videocat`, público | ✅ |
| Releases, tags o tarballs oficiales | Hay releases, pero son del **Companion** (`v0.2.9`); el stack (0.2.33) no tiene release propio | ⚠️ |
| Mantenimiento activo | Sí | ✅ |
| **≥ 1.000 estrellas** en el repo | 0 | ❌ |
| Último release con menos de 6 meses | Sí | ✅ |
| **Proyecto con al menos 6 meses** | Creado el 2026-06-14, así que cumple desde el **2026-12-14** | ❌ (por ahora) |

**Lo que bloquea son las estrellas.** La excepción a las 1.000 estrellas es "rara" y pide una señal de adopción pública clara y verificable. La antigüedad se cumple sola en diciembre.

La licencia AGPL-3.0 no es un problema: el script es MIT (de ellos) e instala la app con su propia licencia.

## Reglas técnicas que nos afectan

- **Sin Docker.** Los scripts `ct/`/`install/` instalan sobre el sistema. Un script que use Docker "se rechaza de inmediato". Hace falta una **instalación nativa** de VideoCAT.
- Usan sus helpers de `tools.func`, nunca comandos propios equivalentes:
  - `NODE_VERSION="24" setup_nodejs`;
  - `PG_VERSION="16" setup_postgresql` y `setup_postgresql_db` (base y usuario);
  - `fetch_and_deploy_gh_release "videocat" "reiterstahl/videocat" "tarball"` para bajar la app, y `check_for_gh_release` en `update_script()`.
- No se definen funciones propias (solo `update_script()`), no se hardcodean credenciales y los mensajes nombran la app ("Stopping VideoCAT").
- **Nada interactivo sin salida:** cada pregunta se responde de antemano con `var_*` (por ejemplo `var_admin_pass`). Esas variables se exportan desde `ct/videocat.sh` y se declaran en `app_vars` (con `secret: true` para contraseñas).
- **arm64:** decidirlo explícitamente. VideoCAT es Node puro y publica imágenes arm64, así que `var_arm64=yes`.
- **Fuente del build:** si el Dockerfile solo copia artefactos ya compilados, prefieren el release precompilado a compilar en el contenedor. El PR debe decir de dónde salen los pasos (Dockerfile, `.env.example`, `package.json`).

## Qué preparar en VideoCAT (independiente de la fecha)

1. **Releases del stack.** Hoy "latest release" es el Companion, y `fetch_and_deploy_gh_release` tomaría eso. Hay dos opciones:
   - **(recomendada)** un release por versión del stack (`vX.Y.Z`) con un tarball precompilado del servidor y la web, más el instalador del Companion. Hay que unificar las versiones del Companion y del stack, o comprobar que la autoactualización del Companion (Velopack) siga encontrando su paquete;
   - publicar el Companion en otro repo y dejar este para el stack.
2. **Tarball precompilado** (`videocat-X.Y.Z.tar.gz`): `apps/server/dist` con sus `node_modules` de producción y el cliente Prisma generado, y la web compilada en `apps/web/dist`. Así el contenedor no compila: menos RAM y menos tiempo.
3. **Instalación nativa documentada** en el README (sirve aunque no entre a community-scripts):
   - servicio systemd `videocat-server` con `prisma migrate deploy` al arrancar, como en la imagen;
   - nginx nativo con la misma configuración que `apps/web/nginx.conf` (estáticos más proxy de `/api` y `/thumbnails`, `proxy_buffering off` en streams);
   - `.env` en `/opt/videocat/.env` con secretos generados en la instalación (JWT, token del agente, contraseña admin) y `THUMBNAILS_DIR` persistente.
4. **Probarlo** en un LXC Debian 13 sin privilegios, en Proxmox: instalación limpia, actualización y conexión del Companion de Windows por LAN.
5. **Adopción:** estrellas en GitHub (sitio videocat.centeran.com, comunidades de selfhosted y de datahoarders, y Docker Hub enlazando al repo).

## Borrador de metadatos

- Nombre `VideoCAT`, slug `videocat`, tipo `ct`, `updateable: true`, `privileged: false`.
- Puerto `8080`.
- Recursos sugeridos: 2 CPU, 2048 MB de RAM, 8 GB de disco, Debian 13.
- Arquitecturas `amd64` y `arm64`.
- Notas: "Los discos se catalogan con el Companion de Windows, que se conecta al servidor por LAN o túnel; el contenedor no necesita acceso a los discos." y "Las miniaturas viven en el contenedor: dimensiona el disco según el catálogo."

## Próximos pasos

1. Ahora: releases del stack y tarball (puntos 1 y 2), e instalación nativa documentada (punto 3).
2. Escribir `ct/videocat.sh` e `install/videocat-install.sh` en un fork de DevScripts siguiendo su `AGENTS.md`, y probarlos en el Proxmox propio. Se puede hacer antes de cumplir los requisitos, sin abrir el PR.
3. Desde el **2026-12-14**, y cuando el repo tenga tracción, abrir el Script request y luego el PR a DevScripts.
