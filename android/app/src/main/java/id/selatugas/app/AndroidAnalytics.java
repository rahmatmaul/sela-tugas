package id.selatugas.app;

import android.content.Context;
import android.database.Cursor;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Properties;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

final class AndroidAnalytics {
    private static final ExecutorService WORKER = Executors.newSingleThreadExecutor();
    private static final AtomicBoolean RUNNING = new AtomicBoolean();

    static void flush(Context context) {
        Context app = context.getApplicationContext();
        if (!RUNNING.compareAndSet(false, true)) return;
        WORKER.execute(() -> {
            HttpURLConnection connection = null;
            try {
                Properties config = new Properties();
                try (InputStream file = app.getAssets().open("posthog.properties")) { config.load(file); }
                String host = config.getProperty("host", "");
                String token = config.getProperty("token", "");
                if (!host.startsWith("https://") || token.isEmpty()) return;
                TaskStore store = TaskStore.get(app);
                JSONArray batch = new JSONArray();
                synchronized (store) {
                    try (Cursor rows = store.getReadableDatabase().rawQuery("SELECT uuid,event,at,properties FROM events WHERE sent=0 ORDER BY at LIMIT 30", null)) {
                        while (rows.moveToNext()) batch.put(new JSONObject().put("uuid", rows.getString(0))
                            .put("event", rows.getString(1)).put("timestamp", rows.getString(2))
                            .put("distinct_id", store.setting("identity"))
                            .put("properties", new JSONObject(rows.getString(3)).put("$geoip_disable", true)));
                    }
                }
                if (batch.length() == 0) return;
                byte[] body = new JSONObject().put("api_key", token).put("batch", batch).toString().getBytes(StandardCharsets.UTF_8);
                connection = (HttpURLConnection) new URL(new URL(host), "/batch/").openConnection();
                connection.setConnectTimeout(4000);
                connection.setReadTimeout(5000);
                connection.setRequestMethod("POST");
                connection.setRequestProperty("Content-Type", "application/json");
                connection.setDoOutput(true);
                try (java.io.OutputStream output = connection.getOutputStream()) { output.write(body); }
                if (connection.getResponseCode() >= 200 && connection.getResponseCode() < 300) {
                    synchronized (store) {
                        for (int i = 0; i < batch.length(); i++) store.getWritableDatabase().execSQL(
                            "UPDATE events SET sent=1 WHERE uuid=?", new Object[]{batch.getJSONObject(i).getString("uuid")});
                    }
                }
            } catch (Exception ignored) {
                // Pending events remain in SQLite and are retried on the next app interaction.
            } finally {
                if (connection != null) connection.disconnect();
                RUNNING.set(false);
            }
        });
    }
}
