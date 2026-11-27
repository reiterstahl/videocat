package app.videocat.android

import android.webkit.JavascriptInterface

/**
 * window.VideoCatAndroid, the bridge the page reads in apps/web/src/lib/android-app.ts. The
 * contract is in ANDROID_APP_PLAN.es.md: methods are only added, raising [VERSION], and the page
 * passes the app only what [capabilities] announces.
 *
 * Every page the WebView shows can call it, so nothing here may read data or act on the person's
 * behalf without checking where the call comes from.
 */
class WebBridge(private val onThemeColor: (Int) -> Unit) {
    @JavascriptInterface
    fun version(): Int = VERSION

    /** A JSON list of what the app does natively. Empty until the native player and Cast exist. */
    @JavascriptInterface
    fun capabilities(): String = "[]"

    /** The app's own script reports the page's theme-color here to tint the system bars. */
    @JavascriptInterface
    fun themeColor(css: String) {
        CssColor.parse(css)?.let(onThemeColor)
    }

    companion object {
        const val VERSION = 1
        const val NAME = "VideoCatAndroid"

        /**
         * Runs on every page load: follows <meta name="theme-color">, which the web keeps on the
         * active theme's surface, and hands it to [themeColor] as the browser computes it.
         */
        const val THEME_COLOR_SCRIPT = """
(function () {
  if (window.__videocatThemeColor || !window.VideoCatAndroid || !window.VideoCatAndroid.themeColor) return;
  window.__videocatThemeColor = true;
  var last = "";
  function send() {
    var meta = document.querySelector('meta[name="theme-color"]');
    if (!meta || !meta.content) return;
    var probe = document.createElement("span");
    probe.style.display = "none";
    probe.style.color = meta.content;
    document.documentElement.appendChild(probe);
    var color = getComputedStyle(probe).color;
    probe.remove();
    if (color && color !== last) {
      last = color;
      window.VideoCatAndroid.themeColor(color);
    }
  }
  send();
  new MutationObserver(send).observe(document.head, { subtree: true, childList: true, attributes: true, attributeFilter: ["content"] });
})();
"""

        /**
         * Asks the page to close what is open on top (a video's detail, a dialog, a menu) when
         * Back is pressed. True when it did; otherwise Back goes to the previous section.
         */
        const val BACK_SCRIPT =
            "(function(){try{return window.videocatAndroidBack ? window.videocatAndroidBack() === true : false}catch(e){return false}})()"
    }
}

/** Colors as getComputedStyle writes them: rgb(r, g, b) or rgba(r, g, b, a). */
object CssColor {
    private val rgb = Regex("""^rgba?\(\s*(\d{1,3})[,\s]+(\d{1,3})[,\s]+(\d{1,3})(?:\s*[,/]\s*([\d.]+%?))?\s*\)$""")

    /** An opaque ARGB color, or null for anything else (including a transparent one). */
    fun parse(css: String): Int? {
        val match = rgb.matchEntire(css.trim()) ?: return null
        val (r, g, b) = match.groupValues.drop(1).take(3).map { it.toInt() }
        if (listOf(r, g, b).any { it > 255 }) return null
        val alpha = match.groupValues[4]
        if (alpha.isNotEmpty()) {
            val value = if (alpha.endsWith("%")) alpha.dropLast(1).toDoubleOrNull()?.div(100) else alpha.toDoubleOrNull()
            if (value == null || value < 1.0) return null
        }
        return (0xFF shl 24) or (r shl 16) or (g shl 8) or b
    }

    /** Whether dark icons read better than light ones on [color]. */
    fun isLight(color: Int): Boolean {
        val r = (color shr 16) and 0xFF
        val g = (color shr 8) and 0xFF
        val b = color and 0xFF
        return (0.299 * r + 0.587 * g + 0.114 * b) > 160
    }
}
