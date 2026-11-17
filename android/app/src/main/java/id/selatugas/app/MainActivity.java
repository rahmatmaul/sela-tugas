package id.selatugas.app;

import android.annotation.SuppressLint;
import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.speech.RecognizerIntent;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final int FILE_PICKER = 10;
    private static final int DICTATION = 11;
    private static final int MICROPHONE = 12;
    private static final int NOTIFICATIONS = 13;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private WebView webView;
    private MobileApi api;
    private ValueCallback<Uri[]> fileCallback;
    private PermissionRequest audioPermission;
    private String speechRequest;
    private Runnable notificationGranted;
    private String notificationRequest;

    @SuppressLint("SetJavaScriptEnabled")
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        api = new MobileApi(this);
        webView = new WebView(this);
        webView.setBackgroundColor(0xfffaf9f4);
        WebSettings settings = webView.getSettings();
        // Only packaged local HTML can navigate inside this WebView.
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);
        webView.addJavascriptInterface(new Bridge(), "SelaAndroid");
        webView.setWebViewClient(new LocalContent());
        webView.setWebChromeClient(new BrowserChrome());
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            webView.setOnApplyWindowInsetsListener((view, insets) -> {
                android.graphics.Insets bars = insets.getInsets(android.view.WindowInsets.Type.systemBars() | android.view.WindowInsets.Type.ime());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return insets;
            });
        }
        setContentView(webView);
        webView.loadUrl("https://" + HOST + "/");
    }

    @Override protected void onResume() {
        super.onResume();
        worker.execute(() -> {
            try { ReminderScheduler.schedule(this); }
            catch (Exception error) { android.util.Log.e("SelaTugas", "Scheduling failed", error); }
            AndroidAnalytics.flush(this);
        });
    }

    private void reply(String id, Object value, String error) {
        try {
            JSONObject result = new JSONObject().put("ok", error == null);
            if (error == null) result.put("data", value);
            else result.put("error", error);
            String script = "window.SelaNativeReceive && window.SelaNativeReceive(" + JSONObject.quote(id) + "," + result + ");";
            runOnUiThread(() -> { if (!isFinishing() && !isDestroyed()) webView.evaluateJavascript(script, null); });
        } catch (Exception exception) { android.util.Log.e("SelaTugas", "Reply failed", exception); }
    }

    public final class Bridge {
        @JavascriptInterface public void request(String id, String path, String method, String body) {
            if (id == null || id.length() > 80) return;
            if (body == null || body.length() > 34 * 1024 * 1024) { reply(id, null, "Data terlalu besar."); return; }
            worker.execute(() -> {
                try {
                    JSONObject input = new JSONObject(body);
                    if (path.equals("dictate") && method.equals("POST")) {
                        runOnUiThread(() -> startDictation(id));
                        return;
                    }
                    Runnable execute = () -> worker.execute(() -> {
                        try { reply(id, api.call(path, method, input), null); }
                        catch (Exception error) { reply(id, null, message(error)); }
                    });
                    boolean needsNotifications = (path.equals("settings") && method.equals("PATCH") && input.optBoolean("enabled"))
                        || path.equals("alarms/preview");
                    if (needsNotifications && !ReminderScheduler.notificationsAvailable(MainActivity.this))
                        runOnUiThread(() -> requestNotifications(id, execute));
                    else execute.run();
                } catch (Exception error) { reply(id, null, message(error)); }
            });
        }
    }

    private String message(Exception error) {
        if (error instanceof IllegalArgumentException || error instanceof org.json.JSONException) return error.getMessage();
        android.util.Log.e("SelaTugas", "App operation failed", error);
        return "Operasi belum berhasil. Coba lagi.";
    }

    private void requestNotifications(String id, Runnable action) {
        if (notificationRequest != null) { reply(id, null, "Selesaikan permintaan izin yang terbuka."); return; }
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            notificationRequest = id;
            notificationGranted = action;
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATIONS);
        } else reply(id, null, "Aktifkan notifikasi Sela Tugas melalui pengaturan aplikasi Android, lalu coba lagi.");
    }

    private void startDictation(String id) {
        if (speechRequest != null) { reply(id, null, "Dikte sedang berlangsung."); return; }
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "id-ID")
            .putExtra(RecognizerIntent.EXTRA_PROMPT, "Ucapkan catatan tugas");
        speechRequest = id;
        try { startActivityForResult(intent, DICTATION); }
        catch (ActivityNotFoundException error) {
            speechRequest = null;
            reply(id, null, "Layanan pengenalan suara belum tersedia di HP ini. Catatan tetap bisa diketik.");
        }
    }

    private final class LocalContent extends WebViewClient {
        @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            if (!url.getScheme().equals("https") || !HOST.equals(url.getHost())) return null;
            String path = url.getPath();
            try {
                if (path != null && path.matches("/api/files/[a-f0-9-]+")) {
                    TaskStore.FileData file = TaskStore.get(MainActivity.this).file(path.substring("/api/files/".length()));
                    if (file == null) return missing();
                    return new WebResourceResponse(file.type, null, 200, "OK",
                        Collections.singletonMap("Content-Length", String.valueOf(file.bytes.length)), new ByteArrayInputStream(file.bytes));
                }
                String name;
                String type;
                switch (path == null ? "" : path) {
                    case "/": name = "index.html"; type = "text/html"; break;
                    case "/app.js": name = "app.js"; type = "text/javascript"; break;
                    case "/style.css": name = "style.css"; type = "text/css"; break;
                    case "/tokens.css": name = "tokens.css"; type = "text/css"; break;
                    default: return missing();
                }
                InputStream stream = getAssets().open(name);
                return new WebResourceResponse(type, "UTF-8", stream);
            } catch (Exception error) { return missing(); }
        }

        @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            if ("https".equals(url.getScheme()) && HOST.equals(url.getHost())) return false;
            if ("https".equals(url.getScheme()) || "http".equals(url.getScheme())) {
                try { startActivity(new Intent(Intent.ACTION_VIEW, url)); }
                catch (ActivityNotFoundException ignored) {}
            }
            return true;
        }
    }

    private WebResourceResponse missing() {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found",
            Collections.emptyMap(), new ByteArrayInputStream("Tidak ditemukan".getBytes(StandardCharsets.UTF_8)));
    }

    private final class BrowserChrome extends WebChromeClient {
        @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams parameters) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;
            Intent picker = parameters.createIntent();
            picker.addCategory(Intent.CATEGORY_OPENABLE);
            try { startActivityForResult(picker, FILE_PICKER); }
            catch (ActivityNotFoundException error) { fileCallback = null; callback.onReceiveValue(null); }
            return true;
        }

        @Override public void onPermissionRequest(PermissionRequest request) {
            runOnUiThread(() -> {
                if (!"https".equals(request.getOrigin().getScheme()) || !HOST.equals(request.getOrigin().getHost()) ||
                    !java.util.Arrays.asList(request.getResources()).contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) {
                    request.deny();
                    return;
                }
                if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED)
                    request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                else {
                    if (audioPermission != null) audioPermission.deny();
                    audioPermission = request;
                    requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, MICROPHONE);
                }
            });
        }

        @Override public void onPermissionRequestCanceled(PermissionRequest request) {
            if (audioPermission == request) audioPermission = null;
        }
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        boolean granted = results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED;
        if (requestCode == MICROPHONE && audioPermission != null) {
            if (granted) audioPermission.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
            else audioPermission.deny();
            audioPermission = null;
        }
        if (requestCode == NOTIFICATIONS && notificationRequest != null) {
            String id = notificationRequest;
            Runnable action = notificationGranted;
            notificationRequest = null;
            notificationGranted = null;
            if (granted) action.run();
            else reply(id, null, "Izin notifikasi belum diberikan. Aktifkan pengingat setelah mengizinkannya.");
        }
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_PICKER && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            fileCallback = null;
        }
        if (requestCode == DICTATION && speechRequest != null) {
            String id = speechRequest;
            speechRequest = null;
            ArrayList<String> results = data == null ? null : data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
            try {
                reply(id, new JSONObject().put("text", resultCode == RESULT_OK && results != null && !results.isEmpty() ? results.get(0) : ""), null);
            } catch (Exception error) { reply(id, null, "Hasil dikte belum dapat dibaca."); }
        }
    }

    @Override public void onBackPressed() {
        webView.evaluateJavascript("(function(){var e=document.getElementById('editor');if(e&&!e.hidden){document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));return true;}return false;})()", handled -> {
            if (!"true".equals(handled)) {
                if (webView.canGoBack()) webView.goBack();
                else finish();
            }
        });
    }

    @Override protected void onDestroy() {
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        if (audioPermission != null) audioPermission.deny();
        webView.removeJavascriptInterface("SelaAndroid");
        webView.destroy();
        worker.shutdown();
        super.onDestroy();
    }
}
