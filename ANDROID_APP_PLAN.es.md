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
| `capabilities()` | Lista JSON de lo que la app hace nativo: `"play"` desde la app 0.2.0, `"settings"` desde la 0.3.0; `"cast"` más adelante. | Versión 1 |
| `themeColor(css)` | Uso interno: un script de la propia app le pasa el `theme-color` de la página para teñir las barras del sistema. | Versión 1 |
| `play(json)` | Reproduce en el reproductor nativo una sesión de streaming que abrió la página: `{url, title, subtitle, position, shuffle, canNext, canRandom}` (posición en segundos). Solo acepta `/api/streams/<id>/content` del servidor de la app, sin parámetros. | Versión 2 |
| `stop()` | Cierra el reproductor nativo cuando la página detiene el video. | Versión 2 |
| `openSettings()` | Abre los ajustes de la app (bloqueo con huella, servidor). La web lo ofrece en Perfil cuando la app anuncia `"settings"`. | Versión 3 |

Lo que la app hace de forma nativa lo anuncia en `capabilities()`, y la web solo le pasa lo que la app declara. Sin el puente, o con un puente roto, la página se comporta como en un navegador. La web lo lee en `apps/web/src/lib/android-app.ts`, y la app lo define en `apps/android/app/src/main/kotlin/app/videocat/android/WebBridge.kt`.

En sentido contrario, la página expone una función a la app:

| Función de la página | La app la llama | Devuelve |
| --- | --- | --- |
| `window.videocatAndroidBack()` | Con el botón atrás de Android | `true` si cerró lo que estaba abierto encima (el detalle de un video, un diálogo, un menú); `false` si no había nada. Con `false`, o con un servidor anterior al 0.2.54 que no la tiene, la app vuelve a la sección anterior o sale. |

El reproductor nativo le avisa a la página con `window.videocatAndroidPlayer(evento)` y espera su respuesta (`play()` con la sesión siguiente, o `stop()`):

| Evento | Cuándo | Qué hace la página |
| --- | --- | --- |
| `{"type":"next"}` | Se pulsó siguiente | Abre el siguiente video, o uno al azar con aleatorio activado, y le pasa la sesión nueva |
| `{"type":"ended"}` | El video terminó | Con aleatorio, otro al azar; si no, detiene |
| `{"type":"shuffle","enabled":true}` | Se cambió aleatorio en el reproductor | Guarda la preferencia, la misma que usa la web |
| `{"type":"closed","position":12.3}` | Se cerró el reproductor (X, atrás, al cerrar la ventana de imagen en imagen) | Cierra la sesión de streaming |
| `{"type":"error","position":12.3,"format":true}` | Falló la reproducción; `format`: el teléfono no pudo leer o decodificar el archivo | Pide el MP4 temporal si sirve; si no, reintenta una vez desde esa posición; si vuelve a fallar, detiene y lo explica |

Cada video avisa una sola vez que terminó o falló, para que la página nunca salte un video de más.

Cualquier página que muestre el WebView puede llamar al puente, también un inicio de sesión de otro sitio delante del servidor. Por eso ningún método puede leer datos ni actuar en nombre de la persona sin comprobar desde qué página lo llaman.

Los métodos de las fases siguientes (por ejemplo `play(json)` con la URL de la sesión de streaming, el título y la posición) se suman al puente subiendo su versión, y se documentan aquí.

## Fases

1. **Servidor y web.** Hecho, en el stack 0.2.53.
   - La web funciona entera fuera de un contexto seguro (`http://` con una dirección que no sea localhost): `crypto.randomUUID` y `navigator.clipboard` solo existen en contexto seguro y no tenían respaldo. Las acciones fallaban en silencio y «Copiar» no copiaba.
   - La web reconoce el puente. Dentro de la app cuenta como instalada (no ofrece instalarse) y oculta Chromecast hasta que la app anuncie `"cast"`.
2. **App base.** Hecha en `apps/android` (app 0.1.0; la parte web va en el stack 0.2.54).
   - **Pantalla de conexión.**
     - Sin `https://` ni `http://`, prueba primero https y después http.
     - Guarda el servidor solo si `/api/health` responde como VideoCAT. Sigue la redirección de http a https y acepta una redirección a otro sitio, que es un inicio de sesión delante del servidor (Cloudflare Access).
     - Avisa si la dirección va sin cifrar fuera de la red de casa.
     - Los errores distinguen: no responde, tarda demasiado, certificado no válido, no es VideoCAT.
   - **WebView.**
     - La sesión es la cookie de siempre (12 horas) y sobrevive a cerrar la app.
     - El botón atrás sale primero de la pantalla completa, luego cierra lo que haya abierto encima y luego vuelve a la sección anterior.
     - Los enlaces a otros sitios se abren en el navegador. Las descargas del propio servidor (el CSV de Auditoría) van al gestor de descargas de Android con la sesión.
     - Hay pantalla completa de video, y las barras del sistema toman el color del tema activo de la web.
     - Si el servidor no responde y no hay copia de la PWA, sale una pantalla con «Reintentar» y «Cambiar servidor». También se cambia de servidor manteniendo pulsado el ícono.
   - **Ícono adaptativo** con versión monocroma (íconos temáticos de Android 13 o superior) y splash con el gato.
   - **Seguridad.**
     - Sin copia de seguridad de los datos: la cookie no viaja a Google Drive.
     - El WebView no tiene acceso a los archivos del teléfono.
     - Nunca se acepta un certificado inválido. Sí se aceptan los de una autoridad que la persona haya instalado en el teléfono.
   - **Builds.**
     - CI compila, prueba y pasa lint en cada cambio.
     - `release-android.yml` firma el APK y el AAB. Se lanza a mano y, si se pide, publica la release `android-vX.Y.Z` sin marcarla como la última del repositorio.
3. **Reproductor nativo.** Hecho en la app 0.2.0; la parte web va en el stack 0.2.54.
   - **Media3 (ExoPlayer) 1.11.** Lee MKV, MP4, WebM, AVI y TS; el códec depende del teléfono (HEVC casi siempre). Las pistas de audio y subtítulos del archivo se eligen en el reproductor.
   - **Controles.** ±10 s (también con doble toque a cada lado), barra de tiempo, siguiente o aleatorio como en la web, velocidad, y al cerrar se vuelve al detalle.
   - **Pantalla.** Gira sola a horizontal o vertical según el video, a pantalla completa sin barras.
   - **Imagen en imagen.** Entra sola al salir de la app con el video sonando, y también con su botón. Cerrar la ventana detiene el video, y si el video termina en ella, la ventana se va.
   - **Segundo plano.** Sigue con la pantalla apagada, con notificación y controles en la pantalla de bloqueo (`PlaybackService`, servicio en primer plano de tipo `mediaPlayback`).
   - **La sesión de siempre.** El reproductor pide el video con la cookie del WebView, y solo al servidor de la app.
   - **El MP4 temporal, solo si hace falta.** Dentro de la app no aparece su botón: el teléfono prueba el original y, si no puede con el formato, la página pide el MP4 temporal sola.
   - **Audio AC3, E-AC3, DTS y TrueHD** (app 0.3.0). Primero los decodificadores del teléfono; para lo que no trae entra FFmpeg, con el decodificador ya compilado que publica Jellyfin (`org.jellyfin.media3:media3-ffmpeg-decoder`, GPL v3, compatible con la AGPL; ver NOTICE). Está compilado contra Media3 1.9.0; antes de adoptarlo se comprobó que cada método y campo de Media3 que usa existe igual en la 1.11. El renderer se agrega por nombre en `PlayerHolder` (`WithFfmpegAudio`): por reflexión, como lo hace Media3, R8 lo borraba del build de release. Suma unos 5 MB al APK (ARM y x86_64).
4. **Chromecast nativo.**

**Bloqueo con huella** (app 0.3.0, fuera de las fases):
- En **Ajustes de la app**, que se abren desde Perfil en la web o manteniendo pulsado el ícono: «Pedir mi huella para abrir VideoCAT». Acepta también el rostro, o el PIN, patrón o contraseña del teléfono.
- Activarlo o desactivarlo pide la huella primero.
- **Cuándo pide:** al abrir la app y al volver después de salir, enseguida, al minuto o a los 5 minutos. No la pide al girar el teléfono ni con el video en imagen en imagen.
- Con el bloqueo activado, la vista de apps recientes no muestra el catálogo (Android 13+).
- Si el teléfono se queda sin bloqueo de pantalla, la app lo desactiva y avisa.
- Es un bloqueo de privacidad: la sesión sigue en el teléfono como antes.
5. **Google Play.**
   - Ficha, política de privacidad y formulario de seguridad de datos. La app no recopila nada: todo va al servidor de cada persona.
   - Una cuenta personal nueva necesita una prueba cerrada antes de publicar (hoy, 12 testers durante 14 días).
   - Mientras tanto, el APK firmado en GitHub Releases, actualizable con Obtainium. Por ser AGPL, también podría ir a F-Droid.

## Llave de firma

Android solo acepta una actualización firmada con la misma llave que la versión instalada. Si se pierde la llave, quien instaló el APK tiene que desinstalar y volver a instalar. Para Google Play esta llave es solo la de subida: Play firma con la suya, y la de subida se puede cambiar.

Crearla una sola vez, fuera del repositorio, y guardar el archivo y las contraseñas en un gestor de contraseñas:

```sh
keytool -genkeypair -keystore videocat-android.jks -alias videocat \
  -keyalg RSA -keysize 4096 -validity 10000 -dname "CN=VideoCAT"
```

Cargarla como secretos del repositorio:

```sh
base64 -w0 videocat-android.jks | gh secret set ANDROID_KEYSTORE_BASE64 -R reiterstahl/videocat
gh secret set ANDROID_KEYSTORE_PASSWORD -R reiterstahl/videocat
gh secret set ANDROID_KEY_ALIAS -R reiterstahl/videocat --body videocat
gh secret set ANDROID_KEY_PASSWORD -R reiterstahl/videocat
```

Después, Actions → **Release Android app** → *Run workflow*. Con *publish* crea la release y adjunta el APK; el AAB para Play queda en los artefactos de la ejecución. El resumen de la ejecución muestra el SHA-256 del certificado, que debe ser el mismo en todas las versiones.

Para cada versión nueva, subir `versionCode` en uno y `versionName` en `apps/android/app/build.gradle.kts`.

## Compilar en local

Hace falta JDK 21 y el SDK de Android (plataforma 36). En `apps/android`:

```sh
./gradlew testDebugUnitTest lintDebug assembleDebug
```

El APK de depuración (`app.videocat.android.debug`) se instala al lado del de release y permite inspeccionar el WebView desde `chrome://inspect`. `gradle.properties` limita Gradle a 2 GB y 4 procesos.

## A tener en cuenta

- **Google Play y el servicio de reproducción.** Un servicio en primer plano de tipo `mediaPlayback` se declara en la ficha de Play (fase 5), con un video corto que lo muestre.

- **El servidor exige HTTPS fuera de `localhost`.** Con `NODE_ENV=production`, `WEB_ORIGIN` con una dirección que no sea localhost obliga a `COOKIE_SECURE=true`, y el navegador no guarda una cookie `Secure` por `http://`. Por eso en la app, como en el navegador, `http://192.168.x.x` abre la página pero no deja iniciar sesión: hace falta un dominio con certificado o un túnel. La app sí acepta `http://`, por si el servidor lo permite algún día.
- **Inicios de sesión de Google delante del servidor.** Si Cloudflare Access usa Google como proveedor, Google bloquea su inicio de sesión dentro de un WebView. El código de un solo uso por correo sí funciona.

