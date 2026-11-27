# App de VideoCAT para Android

Plan para tener VideoCAT en Android como app propia, publicable en Google Play y también como APK firmado en las releases de GitHub. Acordado el 2026-11-27.

## La idea

- **La app abre la web del propio servidor** de cada persona en un WebView, en vez de traer la interfaz empaquetada. Como cada instalación tiene su servidor y su versión, la app y la web nunca quedan desfasadas, y cada versión nueva del stack llega al teléfono sin publicar nada en Play. La sesión es la de siempre: la cookie `SameSite=lax` del mismo origen.
- **Lo nativo es solo lo que un WebView no puede hacer:**
  - el reproductor (Media3/ExoPlayer): MKV y, según el teléfono, HEVC, pantalla completa de verdad, imagen en imagen y reproducción en segundo plano;
  - Chromecast con el SDK de Cast para Android, porque el de la web depende de Chrome y no funciona en un WebView;
  - la pantalla para conectar con el servidor.
- **Kotlin**, sin frameworks híbridos: la app es chica y lo único que se escribe es lo nativo.

Se descartaron:
- **Nativo puro:** habría que reescribir y mantener dos interfaces.
- **Capacitor:** empaqueta la interfaz, con el desfase de versiones y obliga a cambiar CORS y cookies.
- **Tauri 2 para Android:** igual terminaría con los plugins en Kotlin.
- **TWA:** exige un dominio fijo y verificado, y cada persona tiene el suyo.

## El puente entre la web y la app

La app inyecta `window.VideoCatAndroid` antes de que corra la página (`@JavascriptInterface`, que solo pasa números y textos):

| Método | Devuelve | Desde |
| --- | --- | --- |
| `version()` | Versión del puente (entero ≥ 1) | Versión 1 |
| `capabilities()` | Lista JSON de lo que la app hace nativo: `"play"`, `"cast"` | Versión 1 |

Lo que la app hace de forma nativa lo anuncia en `capabilities()`, y la web solo le pasa lo que la app declara. Sin el puente, o con un puente roto, la página se comporta como en un navegador. La web lo lee en `apps/web/src/lib/android-app.ts`.

Los métodos de las fases siguientes (por ejemplo `play(json)` con la URL de la sesión de streaming, el título y la posición) se suman al puente subiendo su versión, y se documentan aquí.

## Fases

1. **Servidor y web.** Hecho, en el stack 0.2.53.
   - La web funciona entera por `http://` con IP de LAN: `crypto.randomUUID` y `navigator.clipboard` solo existen en contexto seguro y tenían respaldo nulo. Las acciones fallaban en silencio y «Copiar» no copiaba.
   - La web reconoce el puente. Dentro de la app cuenta como instalada (no ofrece instalarse) y oculta Chromecast hasta que la app anuncie `"cast"`.
2. **App base.**
   - Pantalla de conexión: URL del servidor validada contra `/api/health`.
   - WebView con sesión persistente, botón atrás de Android y enlaces externos fuera de la app.
   - Ícono y splash.
   - Build firmado en GitHub Actions: AAB para Play y APK para las releases.
3. **Reproductor nativo.** Play, ±10 s, siguiente y aleatorio como en la web, imagen en imagen y segundo plano. Toma la sesión de streaming que ya existe (`/api/streams/:id/content`, con la cookie de la sesión).
4. **Chromecast nativo.**
5. **Google Play.**
   - Ficha, política de privacidad y formulario de seguridad de datos. La app no recopila nada: todo va al servidor de cada persona.
   - Una cuenta personal nueva necesita una prueba cerrada antes de publicar (hoy, 12 testers durante 14 días).
   - Mientras tanto, el APK firmado en GitHub Releases, actualizable con Obtainium. Por ser AGPL, también podría ir a F-Droid.
