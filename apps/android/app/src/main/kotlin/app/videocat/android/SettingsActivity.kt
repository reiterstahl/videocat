package app.videocat.android

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import android.view.View
import android.widget.Button
import android.widget.ImageButton
import android.widget.ProgressBar
import android.widget.RadioGroup
import android.widget.Switch
import android.widget.TextView
import androidx.activity.enableEdgeToEdge
import androidx.core.net.toUri
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.isVisible
import androidx.fragment.app.FragmentActivity
import java.io.File
import java.io.IOException
import java.util.concurrent.Executors

/** The app's own settings: the fingerprint lock, the server it opens and updates. */
@SuppressLint("UseSwitchCompatOrMaterialCode") // The platform switch: no AppCompat or Material in the app.
class SettingsActivity : FragmentActivity() {
    private lateinit var lockSwitch: Switch
    private lateinit var delayGroup: RadioGroup
    private lateinit var delayLabel: View
    private lateinit var unavailable: TextView
    private lateinit var content: View
    private var updating = false
    // Opened straight from the icon's menu, or after the phone was locked: it asks first too.
    private var gated = false
    private var prompting = false

    private lateinit var updateStatus: TextView
    private lateinit var updateProgress: ProgressBar
    private lateinit var updateAction: Button
    private var updateBusy = false
    // Opened from the notification or the "new version" dialog: download right away.
    private var updateRequested = false
    // Downloaded and verified, waiting for the permission to install apps.
    private var pendingInstall: File? = null
    private val worker = Executors.newSingleThreadExecutor()

    private val delayButtons = mapOf(
        0 to R.id.settings_delay_0,
        60 to R.id.settings_delay_60,
        300 to R.id.settings_delay_300,
        900 to R.id.settings_delay_900
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_settings)
        ViewCompat.setOnApplyWindowInsetsListener(findViewById(R.id.settings_root)) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }

        content = findViewById(R.id.settings_root)
        lockSwitch = findViewById(R.id.settings_lock)
        delayGroup = findViewById(R.id.settings_delay)
        delayLabel = findViewById(R.id.settings_delay_label)
        unavailable = findViewById(R.id.settings_lock_unavailable)
        findViewById<ImageButton>(R.id.settings_back).setOnClickListener { finish() }
        findViewById<Button>(R.id.settings_change_server).setOnClickListener {
            startActivity(ConnectActivity.intent(this))
        }
        findViewById<TextView>(R.id.settings_version).text = getString(R.string.settings_version, BuildConfig.VERSION_NAME)

        updateStatus = findViewById(R.id.settings_update_status)
        updateProgress = findViewById(R.id.settings_update_progress)
        updateAction = findViewById(R.id.settings_update_action)
        findViewById<View>(R.id.settings_updates).isVisible = AppUpdates.enabled
        updateAction.setOnClickListener { if (AppUpdates.available(this) != null) downloadUpdate() else checkForUpdate() }
        updateRequested = savedInstanceState == null && intent.getBooleanExtra(EXTRA_UPDATE, false)

        // Turning the lock on or off asks for the fingerprint first: someone holding the
        // unlocked phone cannot simply switch it off.
        lockSwitch.setOnCheckedChangeListener { _, checked ->
            if (updating) return@setOnCheckedChangeListener
            showState()
            val title = getString(if (checked) R.string.settings_lock_confirm_on else R.string.settings_lock_confirm_off)
            AppLock.authenticate(this, title, null) { confirmed, _ ->
                if (confirmed) {
                    AppLock.setEnabled(this, checked)
                    // Just confirmed: turning the lock on does not ask again on the way back.
                    AppLock.markUnlocked()
                }
                showState()
            }
        }
        delayGroup.setOnCheckedChangeListener { _, id ->
            if (updating) return@setOnCheckedChangeListener
            delayButtons.entries.firstOrNull { it.value == id }?.let { AppLock.setDelaySeconds(this, it.key) }
        }
    }

    override fun onStart() {
        super.onStart()
        gated = AppLock.needsUnlock(this)
        content.visibility = if (gated) View.INVISIBLE else View.VISIBLE
    }

    override fun onResume() {
        super.onResume()
        findViewById<TextView>(R.id.settings_server_address).text = ServerStore.get(this).orEmpty()
        showState()
        askToOpen()
        if (!AppUpdates.enabled) return
        if (!updateBusy) showUpdate()
        // Back from allowing VideoCAT to install apps.
        pendingInstall?.let { file -> if (AppUpdates.canInstall(this)) install(file) }
        if (!gated) startRequestedUpdate()
    }

    override fun onDestroy() {
        worker.shutdownNow()
        super.onDestroy()
    }

    // Back from the phone's own lock screen, which cancels a prompt shown behind it.
    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) askToOpen()
    }

    private fun askToOpen() {
        if (!gated || prompting) return
        prompting = true
        AppLock.unlock(this) { open, dismissed ->
            prompting = false
            if (open) {
                gated = false
                content.visibility = View.VISIBLE
                showState()
                startRequestedUpdate()
            } else if (dismissed) {
                finish()
            }
        }
    }

    private fun showState() {
        updating = true
        val enabled = AppLock.isEnabled(this)
        val available = AppLock.canAuthenticate(this)
        lockSwitch.isChecked = enabled
        // Turning it off stays possible even without a screen lock; turning it on does not.
        lockSwitch.isEnabled = available || enabled
        unavailable.isVisible = !available
        delayLabel.isVisible = enabled
        delayGroup.isVisible = enabled
        delayGroup.check(delayButtons.getValue(AppLock.delaySeconds(this)))
        updating = false
    }

    private fun startRequestedUpdate() {
        if (!updateRequested) return
        updateRequested = false
        if (AppUpdates.available(this) != null) downloadUpdate() else checkForUpdate()
    }

    private fun showUpdate(message: String? = null) {
        val release = AppUpdates.available(this)
        updateProgress.visibility = View.GONE
        updateAction.isEnabled = true
        updateStatus.text = message ?: when {
            release != null -> getString(R.string.settings_update_available, release.versionName)
            AppUpdates.checkedAt(this) > 0 -> getString(R.string.settings_update_current)
            else -> ""
        }
        updateStatus.isVisible = updateStatus.text.isNotEmpty()
        updateAction.text = if (release != null) getString(R.string.settings_update_install, release.versionName) else getString(R.string.settings_update_check)
        updateAction.setBackgroundResource(if (release != null) R.drawable.button_accent else R.drawable.button_outline)
        updateAction.setTextColor(getColor(if (release != null) R.color.on_accent else R.color.text))
    }

    private fun checkForUpdate() {
        if (updateBusy) return
        updateBusy = true
        updateAction.isEnabled = false
        updateStatus.isVisible = true
        updateStatus.setText(R.string.settings_update_checking)
        worker.execute {
            val failed = try {
                AppUpdates.check(applicationContext)
                false
            } catch (_: IOException) {
                true
            }
            runOnUiThread {
                updateBusy = false
                if (isDestroyed) return@runOnUiThread
                showUpdate(if (failed) getString(R.string.settings_update_failed) else null)
            }
        }
    }

    private fun downloadUpdate() {
        val release = AppUpdates.available(this) ?: return showUpdate()
        if (updateBusy) return
        updateBusy = true
        updateAction.isEnabled = false
        updateProgress.visibility = View.VISIBLE
        updateProgress.progress = 0
        updateStatus.isVisible = true
        updateStatus.text = getString(R.string.settings_update_downloading, 0)
        worker.execute {
            val outcome: Any = try {
                AppUpdates.download(applicationContext, release) { percent ->
                    runOnUiThread {
                        updateProgress.progress = percent
                        updateStatus.text = getString(R.string.settings_update_downloading, percent)
                    }
                }
            } catch (error: SecurityException) {
                error
            } catch (error: IOException) {
                error
            }
            runOnUiThread {
                updateBusy = false
                if (isDestroyed) return@runOnUiThread
                when (outcome) {
                    is File -> install(outcome)
                    is SecurityException -> showUpdate(getString(R.string.settings_update_rejected))
                    else -> showUpdate(getString(R.string.settings_update_download_failed))
                }
            }
        }
    }

    // Android asks once to let VideoCAT install apps; then its installer asks to confirm.
    private fun install(file: File) {
        if (!AppUpdates.canInstall(this)) {
            pendingInstall = file
            showUpdate(getString(R.string.settings_update_allow))
            startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, "package:$packageName".toUri()))
            return
        }
        pendingInstall = null
        showUpdate()
        AppUpdates.cancelNotification(this)
        startActivity(AppUpdates.installIntent(this, file))
    }

    companion object {
        const val EXTRA_UPDATE = "update"

        fun intent(context: Context): Intent = Intent(context, SettingsActivity::class.java)
    }
}
