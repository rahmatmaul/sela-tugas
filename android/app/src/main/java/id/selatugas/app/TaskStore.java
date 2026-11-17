package id.selatugas.app;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.util.Base64;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Set;
import java.util.HashSet;
import java.util.Arrays;
import java.util.UUID;

final class TaskStore extends SQLiteOpenHelper {
    private static TaskStore instance;
    private static final Set<String> TYPES = new HashSet<>(Arrays.asList("image/jpeg", "image/png", "image/webp", "image/gif",
        "audio/webm", "audio/ogg", "audio/wav", "audio/mpeg", "audio/mp4"));

    static synchronized TaskStore get(Context context) {
        if (instance == null) instance = new TaskStore(context.getApplicationContext());
        return instance;
    }

    private TaskStore(Context context) {
        super(context, "sela-android.sqlite", null, 1);
    }

    @Override public void onConfigure(SQLiteDatabase db) {
        db.setForeignKeyConstraintsEnabled(true);
    }

    @Override public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE tasks(id TEXT PRIMARY KEY,payload TEXT NOT NULL)");
        db.execSQL("CREATE TABLE files(id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,name TEXT NOT NULL,type TEXT NOT NULL,content BLOB NOT NULL)");
        db.execSQL("CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL)");
        db.execSQL("CREATE TABLE deliveries(key TEXT PRIMARY KEY,at TEXT NOT NULL)");
        db.execSQL("CREATE TABLE events(uuid TEXT PRIMARY KEY,event TEXT NOT NULL,at TEXT NOT NULL,properties TEXT NOT NULL,sent INTEGER NOT NULL DEFAULT 0)");
        db.execSQL("INSERT INTO settings VALUES('enabled','false')");
        db.execSQL("INSERT INTO settings VALUES('identity',?)", new Object[]{UUID.randomUUID().toString()});
    }

    @Override public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {}

    synchronized boolean enabled() {
        return setting("enabled").equals("true");
    }

    synchronized String setting(String key) {
        try (Cursor cursor = getReadableDatabase().rawQuery("SELECT value FROM settings WHERE key=?", new String[]{key})) {
            return cursor.moveToFirst() ? cursor.getString(0) : "";
        }
    }

    synchronized void setEnabled(boolean value) throws JSONException {
        getWritableDatabase().execSQL("UPDATE settings SET value=? WHERE key='enabled'", new Object[]{String.valueOf(value)});
        log("reminder_setting_changed", new JSONObject().put("enabled", value));
    }

    synchronized JSONArray tasks() throws JSONException {
        List<JSONObject> values = new ArrayList<>();
        try (Cursor cursor = getReadableDatabase().rawQuery("SELECT payload FROM tasks", null)) {
            while (cursor.moveToNext()) {
                JSONObject task = new JSONObject(cursor.getString(0));
                task.put("files", files(task.getString("id")));
                values.add(task);
            }
        }
        values.sort(Comparator.comparing((JSONObject task) -> task.optBoolean("done"))
            .thenComparing(task -> task.optString("due")).thenComparing(task -> task.optString("created")));
        return new JSONArray(values);
    }

    synchronized JSONObject find(String id) throws JSONException {
        try (Cursor cursor = getReadableDatabase().rawQuery("SELECT payload FROM tasks WHERE id=?", new String[]{id})) {
            if (!cursor.moveToFirst()) throw new IllegalArgumentException("Tugas tidak ditemukan.");
            JSONObject task = new JSONObject(cursor.getString(0));
            task.put("files", files(id));
            return task;
        }
    }

    private JSONArray files(String taskId) throws JSONException {
        JSONArray result = new JSONArray();
        try (Cursor cursor = getReadableDatabase().rawQuery("SELECT id,name,type FROM files WHERE task_id=?", new String[]{taskId})) {
            while (cursor.moveToNext()) result.put(new JSONObject().put("id", cursor.getString(0))
                .put("name", cursor.getString(1)).put("type", cursor.getString(2)).put("url", "/api/files/" + cursor.getString(0)));
        }
        return result;
    }

    synchronized FileData file(String id) {
        SQLiteDatabase db = getReadableDatabase();
        try (Cursor cursor = db.rawQuery("SELECT type,length(content) FROM files WHERE id=?", new String[]{id})) {
            if (!cursor.moveToFirst()) return null;
            String type = cursor.getString(0);
            int size = cursor.getInt(1);
            java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream(size);
            for (int offset = 1; offset <= size; offset += 128 * 1024) {
                try (Cursor chunk = db.rawQuery("SELECT substr(content,?,?) FROM files WHERE id=?",
                        new String[]{String.valueOf(offset), String.valueOf(128 * 1024), id})) {
                    if (!chunk.moveToFirst()) return null;
                    byte[] part = chunk.getBlob(0);
                    bytes.write(part, 0, part.length);
                }
            }
            return new FileData(type, bytes.toByteArray());
        }
    }

    static final class FileData {
        final String type;
        final byte[] bytes;
        FileData(String type, byte[] bytes) { this.type = type; this.bytes = bytes; }
    }

    synchronized JSONObject save(JSONObject input, String id, boolean demo) throws JSONException {
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            JSONObject current = id == null ? new JSONObject().put("version", 0).put("done", false).put("demo", demo) : find(id);
            if (id != null && input.optInt("version", -1) != current.getInt("version"))
                throw new IllegalArgumentException("Tugas berubah. Buka ulang sebelum menyimpan.");
            String title = input.optString("title", current.optString("title")).trim();
            String due = input.optString("due", current.optString("due"));
            String course = input.optString("course", current.optString("course")).trim();
            String description = input.optString("description", current.optString("description")).trim();
            if (title.isEmpty() || title.length() > 140) throw new IllegalArgumentException("Nama tugas wajib diisi, maksimal 140 karakter.");
            try {
                if (!due.matches("\\d{4}-\\d{2}-\\d{2}") || !LocalDate.parse(due).toString().equals(due))
                    throw new IllegalArgumentException();
            } catch (RuntimeException error) { throw new IllegalArgumentException("Tanggal pengumpulan tidak valid."); }
            if (course.length() > 100 || description.length() > 5000) throw new IllegalArgumentException("Catatan terlalu panjang.");
            JSONArray incoming = input.optJSONArray("files");
            if (incoming == null) incoming = new JSONArray();
            JSONArray removals = input.optJSONArray("removeFiles");
            if (removals == null) removals = new JSONArray();
            String taskId = id == null ? UUID.randomUUID().toString() : id;
            for (int i = 0; i < removals.length(); i++)
                db.delete("files", "id=? AND task_id=?", new String[]{removals.getString(i), taskId});
            if (files(taskId).length() + incoming.length() > 4) throw new IllegalArgumentException("Maksimal empat lampiran per tugas.");
            String now = Instant.now().toString();
            boolean done = input.optBoolean("done", current.optBoolean("done"));
            JSONObject task = new JSONObject().put("id", taskId).put("title", title).put("course", course)
                .put("description", description).put("due", due).put("done", done).put("demo", current.optBoolean("demo"))
                .put("version", current.getInt("version") + 1).put("created", current.optString("created", now)).put("updated", now);
            ContentValues values = new ContentValues();
            values.put("id", taskId);
            values.put("payload", task.toString());
            if (id == null) db.insertOrThrow("tasks", null, values);
            else db.update("tasks", values, "id=?", new String[]{taskId});
            for (int i = 0; i < incoming.length(); i++) {
                JSONObject attachment = incoming.getJSONObject(i);
                String type = attachment.getString("type");
                String name = attachment.getString("name");
                if (!TYPES.contains(type) || name.length() > 180) throw new IllegalArgumentException("Format lampiran tidak didukung.");
                byte[] bytes = Base64.decode(attachment.getString("data"), Base64.DEFAULT);
                if (bytes.length == 0 || bytes.length > 6 * 1024 * 1024) throw new IllegalArgumentException("Setiap lampiran maksimal 6 MB.");
                ContentValues file = new ContentValues();
                file.put("id", UUID.randomUUID().toString());
                file.put("task_id", taskId);
                file.put("name", name);
                file.put("type", type);
                file.put("content", bytes);
                db.insertOrThrow("files", null, file);
            }
            log(id == null ? "task_created" : "task_updated", new JSONObject().put("demo", task.optBoolean("demo"))
                .put("attachments", files(taskId).length())
                .put("days_until_due", ChronoUnit.DAYS.between(LocalDate.parse(ReminderRules.today()), LocalDate.parse(due))));
            if (done && !current.optBoolean("done")) log("task_completed", new JSONObject().put("demo", task.optBoolean("demo")));
            db.setTransactionSuccessful();
            return find(taskId);
        } finally { db.endTransaction(); }
    }

    synchronized void delete(String id) throws JSONException {
        find(id);
        getWritableDatabase().delete("tasks", "id=?", new String[]{id});
        log("task_deleted", new JSONObject());
    }

    synchronized void demo(boolean remove) throws JSONException {
        JSONArray existing = tasks();
        for (int i = 0; i < existing.length(); i++) {
            JSONObject task = existing.getJSONObject(i);
            if (task.optBoolean("demo")) {
                if (remove) delete(task.getString("id"));
                else return;
            }
        }
        if (remove) return;
        String[] titles = {"Presentasi integrasi AI", "Ringkasan materi basis data", "Latihan rancangan antarmuka"};
        String[] courses = {"Integrasi Sistem", "Basis Data", "Interaksi Manusia & Komputer"};
        for (int i = 0; i < titles.length; i++) save(new JSONObject().put("title", titles[i]).put("course", courses[i])
            .put("description", "Contoh tugas untuk demo aplikasi.")
            .put("due", LocalDate.parse(ReminderRules.today()).plusDays(i + 1).toString()), null, true);
    }

    synchronized boolean delivered(String key) {
        try (Cursor cursor = getReadableDatabase().rawQuery("SELECT key FROM deliveries WHERE key=?", new String[]{key})) {
            return cursor.moveToFirst();
        }
    }

    synchronized boolean claim(String key) {
        ContentValues value = new ContentValues();
        value.put("key", key);
        value.put("at", Instant.now().toString());
        return getWritableDatabase().insertWithOnConflict("deliveries", null, value, SQLiteDatabase.CONFLICT_IGNORE) != -1;
    }

    synchronized void releaseClaim(String key) {
        getWritableDatabase().delete("deliveries", "key=?", new String[]{key});
    }

    synchronized void log(String event, JSONObject properties) throws JSONException {
        properties.put("source", "sela-tugas-android");
        ContentValues values = new ContentValues();
        values.put("uuid", UUID.randomUUID().toString());
        values.put("event", event);
        values.put("at", Instant.now().toString());
        values.put("properties", properties.toString());
        getWritableDatabase().insertOrThrow("events", null, values);
    }
}
