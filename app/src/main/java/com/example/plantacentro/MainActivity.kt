package com.example.plantacentro

import android.annotation.SuppressLint
import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.content.pm.ShortcutInfo
import android.content.pm.ShortcutManager
import android.graphics.drawable.Icon
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import androidx.core.content.FileProvider
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.view.WindowManager
import android.widget.Toast
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private var filePathCallback: ValueCallback<Array<Uri>>? = null

    private val fileChooserLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (result.resultCode == RESULT_OK) {
            val data: Intent? = result.data
            val results = if (data?.clipData != null) {
                val count = data.clipData!!.itemCount
                Array(count) { data.clipData!!.getItemAt(it).uri }
            } else if (data?.dataString != null) {
                arrayOf(Uri.parse(data.dataString))
            } else null
            filePathCallback?.onReceiveValue(results)
        } else {
            filePathCallback?.onReceiveValue(null)
        }
        filePathCallback = null
    }

    @SuppressLint("SetJavaScriptEnabled", "UnspecifiedRegisterReceiverFlag")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        createNotificationChannel()
        requestNotificationPermission()

        // Bloquear capturas de pantalla y grabación por seguridad industrial
        window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)

        webView = WebView(this)
        setContentView(webView)

        val webSettings: WebSettings = webView.settings
        webSettings.javaScriptEnabled = true
        webSettings.domStorageEnabled = true
        webSettings.allowFileAccess = true
        webSettings.allowContentAccess = true
        webSettings.useWideViewPort = true
        webSettings.loadWithOverviewMode = true
        webSettings.domStorageEnabled = true
        
        // Optimización de Cache
        // LOAD_DEFAULT usa el cache si es válido, si no, descarga.
        webSettings.cacheMode = WebSettings.LOAD_DEFAULT
        webSettings.allowFileAccess = true

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url?.toString() ?: return false
                
                if (url.startsWith("mailto:") || url.startsWith("tel:") || url.contains("wa.me") || url.startsWith("whatsapp:")) {
                    try {
                        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                        startActivity(intent)
                        return true
                    } catch (e: Exception) {
                        return false
                    }
                }
                return false
            }

            override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                if (request?.isForMainFrame == true) {
                    val failingUrl = request.url.toString()
                    // Si falla la carga del servidor (no hay internet o server caído)
                    // cargamos la versión local que está en los assets como respaldo
                    if (!failingUrl.startsWith("file:///android_asset/")) {
                        webView.loadUrl("file:///android_asset/bienvenida.html")
                        Toast.makeText(this@MainActivity, "Modo sin conexión activado", Toast.LENGTH_SHORT).show()
                    }
                }
            }
        }
        
        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?
            ): Boolean {
                this@MainActivity.filePathCallback = filePathCallback
                val intent = fileChooserParams?.createIntent()
                intent?.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                try {
                    fileChooserLauncher.launch(intent)
                } catch (e: Exception) {
                    this@MainActivity.filePathCallback = null
                    return false
                }
                return true
            }
        }

        webView.addJavascriptInterface(WebAppInterface(this), "Android")
        
        // --- ACTUALIZACIÓN INSTANTÁNEA ---
        // URL de tu servidor en GitHub Pages
        val serverUrl = "https://lusdaniel25-jpg.github.io/plantacentro-web/bienvenida.html"
        webView.loadUrl(serverUrl)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(enabled = true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) {
                    webView.goBack()
                } else {
                    val currentTime = System.currentTimeMillis()
                    if (currentTime - lastBackPressTime < 2000) {
                        isEnabled = false
                        onBackPressedDispatcher.onBackPressed()
                    } else {
                        lastBackPressTime = currentTime
                        Toast.makeText(this@MainActivity, "Presiona atrás de nuevo para salir", Toast.LENGTH_SHORT).show()
                    }
                }
            }
        })

        // Registrar receptor para cuando termine la descarga (Compatibilidad con Android 13+)
        val filter = IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(onDownloadComplete, filter, Context.RECEIVER_EXPORTED)
        } else {
            registerReceiver(onDownloadComplete, filter)
        }
    }

    private val onDownloadComplete = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            val id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L)
            if (id != -1L) {
                installApk(context)
            }
        }
    }

    private fun installApk(context: Context) {
        try {
            val downloadsDir = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
            val file = File(downloadsDir, "update.apk")
            
            if (file.exists() && file.length() > 0) {
                val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
                val installIntent = Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(uri, "application/vnd.android.package-archive")
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION
                }
                context.startActivity(installIntent)
            } else {
                Toast.makeText(context, "Archivo de actualización no encontrado o corrupto", Toast.LENGTH_LONG).show()
            }
        } catch (e: Exception) {
            Toast.makeText(context, "Error al abrir el instalador: ${e.message}", Toast.LENGTH_LONG).show()
            // Fallback: intentar abrir carpeta de descargas
            try {
                startActivity(Intent(DownloadManager.ACTION_VIEW_DOWNLOADS))
            } catch (ex: Exception) {}
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val name = "Notificaciones Planta Centro"
            val descriptionText = "Alertas de personal y avisos de la Unidad 6"
            val importance = NotificationManager.IMPORTANCE_HIGH
            val channel = NotificationChannel("CHANNEL_U6_ALERTS", name, importance).apply {
                description = descriptionText
            }
            val notificationManager: NotificationManager =
                getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            notificationManager.createNotificationChannel(channel)
        }
    }

    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.POST_NOTIFICATIONS), 101)
            }
        }
    }

    private var lastBackPressTime: Long = 0

    override fun onDestroy() {
        super.onDestroy()
        unregisterReceiver(onDownloadComplete)
    }

    class WebAppInterface(private val mContext: Context) {
        @JavascriptInterface
        fun createShortcut() {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val shortcutManager = mContext.getSystemService(ShortcutManager::class.java)
                if (shortcutManager != null && shortcutManager.isRequestPinShortcutSupported) {
                    val intent = Intent(mContext, MainActivity::class.java).apply {
                        action = Intent.ACTION_MAIN
                        addCategory(Intent.CATEGORY_LAUNCHER)
                    }
                    val pinShortcutInfo = ShortcutInfo.Builder(mContext, "shortcut-id")
                        .setShortLabel("Unidad 6")
                        .setLongLabel("Planta Centro Unidad 6")
                        .setIcon(Icon.createWithResource(mContext, R.mipmap.ic_launcher))
                        .setIntent(intent)
                        .build()

                    shortcutManager.requestPinShortcut(pinShortcutInfo, null)
                    Toast.makeText(mContext, "Solicitando acceso directo...", Toast.LENGTH_SHORT).show()
                }
            }
        }

        @JavascriptInterface
        fun shareApp(text: String) {
            try {
                val apkPath = mContext.packageCodePath
                val srcFile = File(apkPath)
                // Usamos el directorio de archivos interno que es el más seguro y está en file_paths.xml
                val destFile = File(mContext.filesDir, "Planta_Centro_U6.apk")
                
                if (destFile.exists()) destFile.delete()

                FileInputStream(srcFile).use { input ->
                    FileOutputStream(destFile).use { output ->
                        input.copyTo(output)
                    }
                }

                val contentUri: Uri = FileProvider.getUriForFile(mContext, "${mContext.packageName}.fileprovider", destFile)
                val sendIntent = Intent().apply {
                    action = Intent.ACTION_SEND
                    putExtra(Intent.EXTRA_STREAM, contentUri)
                    putExtra(Intent.EXTRA_TEXT, text)
                    type = "application/vnd.android.package-archive"
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
                
                val chooser = Intent.createChooser(sendIntent, "Compartir instalador APK")
                // Asegurarse de que el intent tenga el flag necesario si se lanza desde un context que no es activity
                chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                // Otorgar permisos explícitos para el chooser también
                chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                mContext.startActivity(chooser)

            } catch (e: Exception) {
                val sendIntent = Intent(Intent.ACTION_SEND).apply {
                    putExtra(Intent.EXTRA_TEXT, text)
                    type = "text/plain"
                }
                mContext.startActivity(Intent.createChooser(sendIntent, "Compartir Link"))
            }
        }

        @JavascriptInterface
        fun downloadUpdate(url: String) {
            try {
                // Limpiar descargas previas
                val file = File(mContext.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "update.apk")
                if (file.exists()) file.delete()

                val request = DownloadManager.Request(Uri.parse(url))
                    .setTitle("Actualización Planta Centro")
                    .setDescription("Descargando nueva versión...")
                    .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    .setDestinationInExternalFilesDir(mContext, Environment.DIRECTORY_DOWNLOADS, "update.apk")

                val manager = mContext.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
                manager.enqueue(request)
                
                Toast.makeText(mContext, "Descargando... al terminar se abrirá el instalador", Toast.LENGTH_LONG).show()
            } catch (e: Exception) {
                val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                mContext.startActivity(intent)
            }
        }

        @JavascriptInterface
        fun showNativeNotification(title: String, message: String) {
            val intent = Intent(mContext, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
            }
            val pendingIntent: PendingIntent = PendingIntent.getActivity(mContext, 0, intent,
                PendingIntent.FLAG_IMMUTABLE)

            val builder = NotificationCompat.Builder(mContext, "CHANNEL_U6_ALERTS")
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(title)
                .setContentText(message)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setContentIntent(pendingIntent)
                .setAutoCancel(true)

            with(NotificationManagerCompat.from(mContext)) {
                if (ActivityCompat.checkSelfPermission(mContext, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED || Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
                    notify(System.currentTimeMillis().toInt(), builder.build())
                }
            }
        }

        @JavascriptInterface
        fun saveFile(base64: String, fileName: String) {
            try {
                val pureBase64 = base64.substringAfter(",")
                val fileBytes = android.util.Base64.decode(pureBase64, android.util.Base64.DEFAULT)
                
                // Guardamos en el directorio público de descargas para que sea accesible
                val downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                val filePath = File(downloadsDir, fileName)
                
                FileOutputStream(filePath).use { fos ->
                    fos.write(fileBytes)
                }
                
                Toast.makeText(mContext, "Archivo guardado y abriendo...", Toast.LENGTH_SHORT).show()

                // Lógica para abrir el archivo automáticamente
                val uri = FileProvider.getUriForFile(mContext, "${mContext.packageName}.fileprovider", filePath)
                val intent = Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(uri, mContext.contentResolver.getType(uri) ?: getMimeType(fileName))
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                
                mContext.startActivity(Intent.createChooser(intent, "Abrir con...").apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                })

            } catch (e: Exception) {
                Toast.makeText(mContext, "Error: ${e.message}", Toast.LENGTH_LONG).show()
            }
        }

        private fun getMimeType(url: String): String {
            return when {
                url.endsWith(".pdf", true) -> "application/pdf"
                url.endsWith(".docx", true) || url.endsWith(".doc", true) -> "application/msword"
                url.endsWith(".xlsx", true) || url.endsWith(".xls", true) -> "application/vnd.ms-excel"
                else -> "*/*"
            }
        }
    }
}
