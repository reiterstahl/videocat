package app.videocat.android

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import java.util.concurrent.Executors

/** Asks for the server's address and keeps it only once /api/health says it is VideoCAT. */
class ConnectActivity : ComponentActivity() {
    private val worker = Executors.newSingleThreadExecutor()
    private lateinit var address: EditText
    private lateinit var button: Button
    private lateinit var error: TextView
    private lateinit var warning: TextView
    private var checking = false

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_connect)

        val root = findViewById<View>(R.id.connect_root)
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            view.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
            insets
        }

        address = findViewById(R.id.connect_address)
        button = findViewById(R.id.connect_button)
        error = findViewById(R.id.connect_error)
        warning = findViewById(R.id.connect_warning)

        if (savedInstanceState == null) {
            ServerStore.get(this)?.let { address.setText(it) }
        }
        address.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) = Unit
            override fun afterTextChanged(s: Editable?) {
                error.visibility = View.GONE
                updateWarning()
            }
        })
        address.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_GO) {
                connect()
                true
            } else {
                false
            }
        }
        button.setOnClickListener { connect() }
        updateWarning()
    }

    override fun onDestroy() {
        worker.shutdownNow()
        super.onDestroy()
    }

    // Typed with http:// to an address outside the network: say so before the password is typed.
    private fun updateWarning() {
        val origin = ServerAddress.candidates(address.text.toString())?.singleOrNull()
        warning.visibility = if (origin != null && ServerAddress.isUnencryptedOverInternet(origin)) View.VISIBLE else View.GONE
    }

    private fun connect() {
        if (checking) return
        val text = address.text.toString()
        if (text.isBlank()) return showError(getString(R.string.connect_error_empty))
        val candidates = ServerAddress.candidates(text)
            ?: return showError(getString(R.string.connect_error_invalid))

        setChecking(true)
        worker.execute {
            val result = HealthCheck.check(candidates)
            runOnUiThread {
                if (isFinishing || isDestroyed) return@runOnUiThread
                setChecking(false)
                when (result) {
                    is HealthCheck.Result.Found -> open(result.origin)
                    is HealthCheck.Result.Failed -> {
                        showError(messageFor(result, text))
                        address.requestFocus()
                    }
                }
            }
        }
    }

    // Names the server as it was typed; the https:// or http:// the app tried first is only shown
    // when the person wrote one, or when the certificate is the problem.
    private fun messageFor(failure: HealthCheck.Result.Failed, typed: String): String {
        val wroteScheme = typed.contains("://")
        val shown = if (wroteScheme || failure.problem == HealthCheck.Problem.CERTIFICATE) failure.origin else typed.trim().trimEnd('/')
        return when (failure.problem) {
            HealthCheck.Problem.UNREACHABLE -> getString(R.string.connect_error_unreachable, shown)
            HealthCheck.Problem.TIMEOUT -> getString(R.string.connect_error_timeout, shown)
            HealthCheck.Problem.CERTIFICATE -> getString(R.string.connect_error_certificate, shown)
            HealthCheck.Problem.NOT_VIDEOCAT -> getString(R.string.connect_error_not_videocat, shown)
        }
    }

    private fun open(origin: String) {
        ServerStore.set(this, origin)
        startActivity(
            Intent(this, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
        )
        finish()
    }

    private fun setChecking(value: Boolean) {
        checking = value
        button.isEnabled = !value
        address.isEnabled = !value
        button.text = getString(if (value) R.string.connect_checking else R.string.connect_button)
    }

    private fun showError(message: String) {
        error.text = message
        error.visibility = View.VISIBLE
    }

    companion object {
        fun intent(context: Context): Intent = Intent(context, ConnectActivity::class.java)
    }
}
