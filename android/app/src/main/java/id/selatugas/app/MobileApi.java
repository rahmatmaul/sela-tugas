package id.selatugas.app;

import android.content.Context;
import org.json.JSONObject;

final class MobileApi {
    private final Context context;
    private final TaskStore store;

    MobileApi(Context context) {
        this.context = context.getApplicationContext();
        store = TaskStore.get(context);
    }

    Object call(String path, String method, JSONObject input) throws Exception {
        Object result;
        if (path.equals("tasks") && method.equals("GET")) return store.tasks();
        if (path.equals("tasks") && method.equals("POST")) result = store.save(input, null, false);
        else if (path.startsWith("tasks/") && method.equals("PATCH")) {
            String id = path.substring(6);
            JSONObject task = store.save(input, id, false);
            if (task.optBoolean("done")) ReminderScheduler.cancelTask(context, id);
            result = task;
        } else if (path.startsWith("tasks/") && method.equals("DELETE")) {
            String id = path.substring(6);
            store.delete(id);
            ReminderScheduler.cancelTask(context, id);
            result = new JSONObject().put("ok", true);
        } else if (path.equals("settings") && method.equals("GET")) {
            return new JSONObject().put("enabled", store.enabled()).put("hour", "09.00 WIB")
                .put("platform", "android").put("alarmBusy", false).put("lastError", JSONObject.NULL)
                .put("today", ReminderRules.today()).put("notifications", ReminderScheduler.notificationsAvailable(context));
        } else if (path.equals("settings") && method.equals("PATCH")) {
            store.setEnabled(input.getBoolean("enabled"));
            result = new JSONObject().put("enabled", store.enabled());
        } else if (path.equals("alarms/preview") && method.equals("POST")) {
            ReminderScheduler.preview(context, input.getInt("stage"));
            result = new JSONObject().put("ok", true);
        } else if (path.equals("demo") && (method.equals("POST") || method.equals("DELETE"))) {
            store.demo(method.equals("DELETE"));
            result = store.tasks();
        } else throw new IllegalArgumentException("Perintah aplikasi tidak ditemukan.");
        ReminderScheduler.schedule(context);
        AndroidAnalytics.flush(context);
        return result;
    }
}
