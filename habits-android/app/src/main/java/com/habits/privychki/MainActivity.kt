package com.habits.privychki

import android.annotation.SuppressLint
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.addCallback
import androidx.activity.result.contract.ActivityResultContracts
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Hosts the habit tracker (index.html/style.css/app.js in assets/) inside a
 * WebView. Export/import go through the Storage Access Framework instead of
 * a browser download or <input type="file">, neither of which work out of
 * the box in a WebView; app.js calls into [WebAppBridge] when it detects
 * `window.AndroidBridge`, falling back to the plain web behavior otherwise.
 */
class MainActivity : ComponentActivity() {

    private lateinit var webView: WebView
    private var pendingExportJson: String? = null

    private val createDocumentLauncher =
        registerForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
            val json = pendingExportJson
            pendingExportJson = null
            if (uri != null && json != null) {
                runCatching {
                    contentResolver.openOutputStream(uri)?.use { it.write(json.toByteArray(Charsets.UTF_8)) }
                }
            }
        }

    private val openDocumentLauncher =
        registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
            if (uri == null) {
                notifyImportResult(null, null)
                return@registerForActivityResult
            }
            val result = runCatching {
                contentResolver.openInputStream(uri)?.use { input ->
                    BufferedReader(InputStreamReader(input, Charsets.UTF_8)).readText()
                }
            }
            result.fold(
                onSuccess = { text -> notifyImportResult(text, if (text == null) "empty file" else null) },
                onFailure = { e -> notifyImportResult(null, e.message ?: "read error") }
            )
        }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        webView = WebView(this)
        setContentView(webView)

        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.webViewClient = WebViewClient()
        webView.addJavascriptInterface(WebAppBridge(), "AndroidBridge")
        webView.loadUrl("file:///android_asset/index.html")

        onBackPressedDispatcher.addCallback(this) {
            if (webView.canGoBack()) webView.goBack() else {
                isEnabled = false
                onBackPressedDispatcher.onBackPressed()
            }
        }
    }

    private fun notifyImportResult(json: String?, error: String?) {
        runOnUiThread {
            val jsonArg = if (json != null) JSONObject.quote(json) else "null"
            val errorArg = if (error != null) JSONObject.quote(error) else "null"
            webView.evaluateJavascript(
                "window.__androidImportResult && window.__androidImportResult($jsonArg, $errorArg);",
                null
            )
        }
    }

    /** Exposed to app.js as `window.AndroidBridge`. */
    private inner class WebAppBridge {

        @JavascriptInterface
        fun exportBackup(json: String) {
            pendingExportJson = json
            val stamp = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
            runOnUiThread { createDocumentLauncher.launch("habits-backup-$stamp.json") }
        }

        @JavascriptInterface
        fun requestImport() {
            runOnUiThread { openDocumentLauncher.launch(arrayOf("application/json", "text/*", "*/*")) }
        }
    }
}
