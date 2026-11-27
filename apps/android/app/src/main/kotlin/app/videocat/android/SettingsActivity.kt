package app.videocat.android

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.ImageButton
import android.widget.RadioGroup
import android.widget.Switch
import android.widget.TextView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.isVisible
import androidx.fragment.app.FragmentActivity

/** The app's own settings: the fingerprint lock and the server it opens. */
@SuppressLint("UseSwitchCompatOrMaterialCode") // The platform switch: no AppCompat or Material in the app.
class SettingsActivity : FragmentActivity() {
    private lateinit var lockSwitch: Switch
    private lateinit var delayGroup: RadioGroup
    private lateinit var delayLabel: View
    private lateinit var unavailable: TextView
    private var updating = false

    private val delayButtons = mapOf(0 to R.id.settings_delay_0, 60 to R.id.settings_delay_60, 300 to R.id.settings_delay_300)

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_settings)
        ViewCompat.setOnApplyWindowInsetsListener(findViewById(R.id.settings_root)) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }

        lockSwitch = findViewById(R.id.settings_lock)
        delayGroup = findViewById(R.id.settings_delay)
        delayLabel = findViewById(R.id.settings_delay_label)
        unavailable = findViewById(R.id.settings_lock_unavailable)
        findViewById<ImageButton>(R.id.settings_back).setOnClickListener { finish() }
        findViewById<Button>(R.id.settings_change_server).setOnClickListener {
            startActivity(ConnectActivity.intent(this))
        }
        findViewById<TextView>(R.id.settings_version).text = getString(R.string.settings_version, BuildConfig.VERSION_NAME)

        // Turning the lock on or off asks for the fingerprint first: someone holding the
        // unlocked phone cannot simply switch it off.
        lockSwitch.setOnCheckedChangeListener { _, checked ->
            if (updating) return@setOnCheckedChangeListener
            showState()
            val title = getString(if (checked) R.string.settings_lock_confirm_on else R.string.settings_lock_confirm_off)
            AppLock.authenticate(this, title, null) { confirmed, _ ->
                if (confirmed) AppLock.setEnabled(this, checked)
                showState()
            }
        }
        delayGroup.setOnCheckedChangeListener { _, id ->
            if (updating) return@setOnCheckedChangeListener
            delayButtons.entries.firstOrNull { it.value == id }?.let { AppLock.setDelaySeconds(this, it.key) }
        }
    }

    override fun onResume() {
        super.onResume()
        findViewById<TextView>(R.id.settings_server_address).text = ServerStore.get(this).orEmpty()
        showState()
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

    companion object {
        fun intent(context: Context): Intent = Intent(context, SettingsActivity::class.java)
    }
}
