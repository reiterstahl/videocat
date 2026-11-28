package app.videocat.android

import android.annotation.SuppressLint
import android.app.DownloadManager
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.ShortcutInfo
import android.content.res.Configuration
import android.content.pm.ShortcutManager
import android.graphics.drawable.Animatable
import android.graphics.drawable.Icon
import android.net.Uri
import android.net.http.SslError
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.os.Message
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.RenderProcessGoneDetail
import android.webkit.SslErrorHandler
import android.webkit.URLUtil
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.net.toUri
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.core.view.isVisible
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.Lifecycle

/**
 * The person's VideoCAT in a WebView: the web is the app, served by their own server, so it is
 * always the version that server runs. Around it, only what a WebView does not do by itself.
 */
class MainActivity : FragmentActivity() {
    private lateinit var origin: String
    private lateinit var root: FrameLayout
    private lateinit var webHolder: FrameLayout
    private lateinit var fullscreenHolder: FrameLayout
    private lateinit var errorPanel: View
    private lateinit var errorDetail: TextView
    private var webView: WebView? = null
    private lateinit var nativePlayer: NativePlayer
    private lateinit var lockPanel: View
    private lateinit var loadingPanel: View
    private var locked = false
    private var prompting = false
    // Show the prompt by itself until the person dismisses it; then the Unlock button asks.
    private var autoPrompt = true

    private var fullscreenView: View? = null
    private var fullscreenCallback: WebChromeClient.CustomViewCallback? = null
    private var barColor: Int = 0
    private val mainHandler = Handler(Looper.getMainLooper())

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        // A new screen, not one coming back from a rotation: the app was opened anew (after Back,
        // or after being swiped away while the process lived on), so the fingerprint asks again.
        if (savedInstanceState == null) AppLock.relock()

        val saved = ServerStore.get(this)
        if (saved == null) {
            startActivity(ConnectActivity.intent(this))
            finish()
            return
        }
        origin = saved

        enableEdgeToEdge()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.isNavigationBarContrastEnforced = false
        }
        setContentView(R.layout.activity_main)
        root = findViewById(R.id.main_root)
        webHolder = findViewById(R.id.web_holder)
        fullscreenHolder = findViewById(R.id.fullscreen_holder)
        errorPanel = findViewById(R.id.error_panel)
        errorDetail = findViewById(R.id.error_detail)
        findViewById<Button>(R.id.error_retry).setOnClickListener { retry() }
        findViewById<Button>(R.id.error_change_server).setOnClickListener { startActivity(ConnectActivity.intent(this)) }
        lockPanel = findViewById(R.id.lock_panel)
        findViewById<Button>(R.id.lock_unlock).setOnClickListener { promptUnlock() }
        // The starting screen's cat stays, closing its eyes, until the page shows (a restored page
        // has its content already: no wait).
        loadingPanel = findViewById(R.id.loading_panel)
        if (savedInstanceState == null) {
            (findViewById<ImageView>(R.id.loading_cat).drawable as? Animatable)?.start()
            mainHandler.postDelayed({ hideLoading() }, LOADING_MAX_MS)
        } else {
            loadingPanel.visibility = View.GONE
        }

        nativePlayer = NativePlayer(this, root, ::sendPlayerEvent) { open ->
            hideSystemBars(open)
            ViewCompat.requestApplyInsets(root)
        }

        barColor = getColor(R.color.surface)
        applyBarColor(barColor)
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            if (fullscreenView != null || nativePlayer.isOpen) {
                view.setPadding(0, 0, 0, 0)
            } else {
                val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
                // With edge-to-edge the window no longer shrinks for the keyboard: make room for it here.
                val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
                view.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
            }
            WindowInsetsCompat.CONSUMED
        }

        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        CookieManager.getInstance().setAcceptCookie(true)
        val web = createWebView()
        val state = savedInstanceState?.getBundle(STATE_WEB)
        if (state == null || web.restoreState(state) == null) web.loadUrl("$origin/")

        onBackPressedDispatcher.addCallback(this, backCallback)
        publishShortcuts()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView?.let { web -> outState.putBundle(STATE_WEB, Bundle().also { web.saveState(it) }) }
    }

    override fun onPause() {
        super.onPause()
        CookieManager.getInstance().flush()
    }

    override fun onStart() {
        super.onStart()
        if (AppLock.needsUnlock(this)) lock() else if (locked) unlock()
    }

    override fun onResume() {
        super.onResume()
        // With the lock on, the recent apps screen shows no picture of the catalog.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) setRecentsScreenshotEnabled(!AppLock.isEnabled(this))
        if (locked && autoPrompt) promptUnlock()
    }

    // Back from the phone's own lock screen, which cancels a prompt shown behind it: ask again
    // once the app is really in front.
    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus && locked && autoPrompt) promptUnlock()
    }

    private fun lock() {
        if (!locked) autoPrompt = true
        locked = true
        lockPanel.visibility = View.VISIBLE
    }

    private fun unlock() {
        locked = false
        lockPanel.visibility = View.GONE
    }

    private fun promptUnlock() {
        if (!locked || prompting) return
        prompting = true
        AppLock.unlock(this) { open, dismissed ->
            prompting = false
            if (open) unlock() else if (dismissed) autoPrompt = false
        }
    }

    private fun hideLoading() {
        if (loadingPanel.visibility != View.VISIBLE || loadingPanel.alpha < 1f) return
        paintBars(barColor)
        loadingPanel.animate().alpha(0f).setDuration(220).withEndAction {
            loadingPanel.visibility = View.GONE
            (findViewById<ImageView>(R.id.loading_cat).drawable as? Animatable)?.stop()
        }.start()
    }

    override fun onDestroy() {
        // Closed for good (Back, or swiped away): the next opening asks for the fingerprint.
        if (isFinishing) AppLock.relock()
        mainHandler.removeCallbacksAndMessages(null)
        if (::nativePlayer.isInitialized) nativePlayer.close(notifyPage = false)
        webView?.let { destroyWebView(it) }
        webView = null
        super.onDestroy()
    }

    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    private fun createWebView(): WebView {
        val web = WebView(this)
        web.setBackgroundColor(barColor)
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            // Files on the phone stay out of reach of the page.
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            setSupportMultipleWindows(true)
            javaScriptCanOpenWindowsAutomatically = true
            userAgentString = "$userAgentString VideoCATAndroid/${BuildConfig.VERSION_NAME}"
        }
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false)
        val bridge = WebBridge(
            onThemeColor = { color -> runOnUiThread { applyBarColor(color) } },
            onPlay = { json -> runOnUiThread { playFromPage(json) } },
            onStop = { runOnUiThread { nativePlayer.close(notifyPage = false) } },
            onOpenSettings = { runOnUiThread { startActivity(SettingsActivity.intent(this)) } }
        )
        web.addJavascriptInterface(bridge, WebBridge.NAME)
        web.webViewClient = PageClient()
        web.webChromeClient = ChromeClient()
        web.setDownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
            download(url, userAgent, contentDisposition, mimeType)
        }
        webHolder.addView(web, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        webView = web
        return web
    }

    private fun destroyWebView(web: WebView) {
        webHolder.removeView(web)
        web.stopLoading()
        web.webChromeClient = null
        web.destroy()
    }

    private fun isServer(url: String?): Boolean = url != null && ServerAddress.origin(url) == origin

    private inner class PageClient : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val url = request.url
            if (isServer(url.toString())) return false
            // Other sites never load inside a frame of the page.
            if (!request.isForMainFrame) return true
            val scheme = url.scheme?.lowercase()
            if (scheme == "http" || scheme == "https") {
                // A sign-in in front of the server (Cloudflare Access, for example) redirects to
                // its own site and back: that stays in the app, along with whatever happens while
                // the page shown is not the server's.
                if (request.isRedirect || !isServer(view.url)) return false
            }
            openOutside(url)
            return true
        }

        override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
            if (isServer(url)) errorPanel.visibility = View.GONE
            // A new page load (a reload, an update of the web) drops the page that drove the
            // player: nobody would answer its Next or close its stream session.
            if (nativePlayer.isOpen) nativePlayer.close(notifyPage = false)
        }

        override fun onPageFinished(view: WebView, url: String?) {
            hideLoading()
            if (isServer(url)) view.evaluateJavascript(WebBridge.THEME_COLOR_SCRIPT, null)
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (request.isForMainFrame) showError(error.description?.toString().orEmpty())
        }

        @SuppressLint("WebViewClientOnReceivedSslError")
        override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
            // Never proceed past a bad certificate.
            handler.cancel()
            if (isServer(error.url) || view.url == null) showError(getString(R.string.error_certificate))
        }

        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            // The page's process died (out of memory, usually). Start a new WebView instead of closing the app.
            if (view == webView) {
                // The page that drove the player is gone with it.
                nativePlayer.close(notifyPage = false)
                val url = view.url?.takeIf(::isServer) ?: "$origin/"
                destroyWebView(view)
                webView = null
                createWebView().loadUrl(url)
            } else {
                view.destroy()
            }
            return true
        }
    }

    private inner class ChromeClient : WebChromeClient() {
        // A video put in full screen by the page.
        override fun onShowCustomView(view: View, callback: CustomViewCallback) {
            if (fullscreenView != null) {
                callback.onCustomViewHidden()
                return
            }
            fullscreenView = view
            fullscreenCallback = callback
            fullscreenHolder.addView(view, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            fullscreenHolder.visibility = View.VISIBLE
            hideSystemBars(true)
            ViewCompat.requestApplyInsets(root)
        }

        override fun onHideCustomView() {
            leaveFullscreen()
        }

        // window.open and target="_blank": the server's own pages open here, other sites outside.
        override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message): Boolean {
            if (!isUserGesture) return false
            val probe = WebView(this@MainActivity)
            var handled = false
            fun take(url: String?) {
                if (handled || url.isNullOrEmpty() || url == "about:blank") return
                handled = true
                if (isServer(url)) webView?.loadUrl(url) else openOutside(url.toUri())
                mainHandler.post { probe.destroy() }
            }
            probe.webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    take(request.url.toString())
                    return true
                }

                override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
                    take(url)
                    view.stopLoading()
                }
            }
            (resultMsg.obj as WebView.WebViewTransport).webView = probe
            resultMsg.sendToTarget()
            return true
        }
    }

    private fun leaveFullscreen() {
        val view = fullscreenView ?: return
        fullscreenHolder.removeView(view)
        fullscreenHolder.visibility = View.GONE
        fullscreenView = null
        hideSystemBars(nativePlayer.isOpen)
        fullscreenCallback?.onCustomViewHidden()
        fullscreenCallback = null
        ViewCompat.requestApplyInsets(root)
    }

    // Back: out of full screen, then whatever the page has open on top, then the previous section.
    private val backCallback = object : OnBackPressedCallback(true) {
        override fun handleOnBackPressed() {
            if (locked) return leaveApp()
            if (fullscreenView != null) return leaveFullscreen()
            if (nativePlayer.isOpen) return nativePlayer.close(notifyPage = true)
            val web = webView ?: return leaveApp()
            if (errorPanel.isVisible) return leaveApp()
            web.evaluateJavascript(WebBridge.BACK_SCRIPT) { handled ->
                if (handled == "true") return@evaluateJavascript
                if (web.canGoBack()) web.goBack() else leaveApp()
            }
        }
    }

    // The page hands a stream session to the native player; only from the server's own page.
    private fun playFromPage(json: String) {
        if (!isServer(webView?.url)) return
        val request = PlaybackRequest.parse(json, origin) ?: return
        nativePlayer.play(request, origin)
    }

    private fun sendPlayerEvent(event: String) {
        webView?.evaluateJavascript(PlayerEvent.script(event), null)
    }

    private fun hideSystemBars(on: Boolean) {
        WindowCompat.getInsetsController(window, root).apply {
            if (on) {
                systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                hide(WindowInsetsCompat.Type.systemBars())
            } else {
                show(WindowInsetsCompat.Type.systemBars())
            }
        }
    }

    // Leaving the app while a video plays: picture in picture (Android 12+ enters it on its own).
    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S && nativePlayer.isOpen && nativePlayer.isPlaying) {
            nativePlayer.enterPictureInPicture()
        }
    }

    override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: Configuration) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
        nativePlayer.onPictureInPictureChanged(isInPictureInPictureMode)
        // Closing the small window leaves the activity stopped: the video stops with it.
        if (!isInPictureInPictureMode && !lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) {
            nativePlayer.close(notifyPage = true)
        }
    }

    private fun leaveApp() {
        backCallback.isEnabled = false
        onBackPressedDispatcher.onBackPressed()
        backCallback.isEnabled = true
    }

    private fun showError(detail: String) {
        hideLoading()
        errorDetail.text = listOf(origin, detail).filter { it.isNotBlank() }.joinToString("\n")
        errorPanel.visibility = View.VISIBLE
    }

    private fun retry() {
        errorPanel.visibility = View.GONE
        val web = webView ?: createWebView()
        val url = web.url?.takeIf(::isServer) ?: "$origin/"
        web.loadUrl(url)
    }

    private fun applyBarColor(color: Int) {
        barColor = color
        // While the cat is on screen the bars keep its dark background, not the page's yet.
        paintBars(if (loadingPanel.isVisible && loadingPanel.alpha == 1f) getColor(R.color.splash_background) else color)
    }

    private fun paintBars(color: Int) {
        root.setBackgroundColor(color)
        val light = CssColor.isLight(color)
        WindowCompat.getInsetsController(window, root).apply {
            isAppearanceLightStatusBars = light
            isAppearanceLightNavigationBars = light
        }
    }

    private fun openOutside(uri: Uri) {
        val scheme = uri.scheme?.lowercase()
        if (scheme !in setOf("http", "https", "mailto", "tel")) return
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE))
        } catch (_: ActivityNotFoundException) {
            Toast.makeText(this, R.string.no_app_for_link, Toast.LENGTH_SHORT).show()
        }
    }

    // Downloads from the server (the audit's CSV, for example) go through Android's download
    // manager with the session's cookie; anything else opens in the browser.
    private fun download(url: String, userAgent: String, contentDisposition: String?, mimeType: String?) {
        val uri = url.toUri()
        if (!isServer(url)) {
            if (uri.scheme == "http" || uri.scheme == "https") openOutside(uri)
            else Toast.makeText(this, R.string.download_unsupported, Toast.LENGTH_SHORT).show()
            return
        }
        val name = URLUtil.guessFileName(url, contentDisposition, mimeType)
        val request = DownloadManager.Request(uri)
            .setTitle(name)
            .setMimeType(mimeType)
            .addRequestHeader("User-Agent", userAgent)
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
        CookieManager.getInstance().getCookie(url)?.let { request.addRequestHeader("Cookie", it) }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
        } else {
            // Before Android 10 the shared folder needs a storage permission; the app's own one does not.
            request.setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, name)
        }
        getSystemService(DownloadManager::class.java).enqueue(request)
        Toast.makeText(this, getString(R.string.download_started, name), Toast.LENGTH_SHORT).show()
    }

    // Long-pressing the icon offers the app's settings and "Change server".
    private fun publishShortcuts() {
        val manager = getSystemService(ShortcutManager::class.java) ?: return
        val settings = ShortcutInfo.Builder(this, "settings")
            .setShortLabel(getString(R.string.shortcut_settings))
            .setIcon(Icon.createWithResource(this, R.mipmap.ic_launcher))
            .setIntents(
                arrayOf(
                    Intent(Intent.ACTION_MAIN, null, this, MainActivity::class.java),
                    Intent(Intent.ACTION_VIEW, null, this, SettingsActivity::class.java)
                )
            )
            .build()
        val shortcut = ShortcutInfo.Builder(this, "change-server")
            .setShortLabel(getString(R.string.shortcut_change_server))
            .setIcon(Icon.createWithResource(this, R.mipmap.ic_launcher))
            .setIntents(
                arrayOf(
                    Intent(Intent.ACTION_MAIN, null, this, MainActivity::class.java),
                    Intent(Intent.ACTION_VIEW, null, this, ConnectActivity::class.java)
                )
            )
            .build()
        try {
            @Suppress("ReportShortcutUsage") // A single fixed shortcut: there is no usage to rank.
        manager.dynamicShortcuts = listOf(settings, shortcut)
        } catch (_: IllegalStateException) {
            // Rate-limited by the launcher; the next start publishes it.
        }
    }

    companion object {
        private const val STATE_WEB = "web"
        // A slow server: the WebView shows whatever it has by then.
        private const val LOADING_MAX_MS = 15_000L
    }
}
