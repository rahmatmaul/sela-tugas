package id.selatugas.app;

import android.Manifest;
import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import org.json.JSONArray;
import org.json.JSONObject;
import java.time.Instant;
import java.time.LocalDate;

final class ReminderScheduler {
    static final String ACTION = "id.selatugas.app.REMIND";
    private static final String[] TITLES = {"", "H-1 Urgent", "H-2 Segera kerjakan", "H-3 Mulai cicil"};

    static boolean notificationsAvailable(Context context) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        return manager.areNotificationsEnabled() && (Build.VERSION.SDK_INT < 33 ||
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED);
    }

    private static PendingIntent pending(Context context) {
        Intent intent = new Intent(context, ReminderReceiver.class).setAction(ACTION);
        return PendingIntent.getBroadcast(context, 1, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static void schedule(Context context) throws Exception {
        AlarmManager manager = context.getSystemService(AlarmManager.class);
        TaskStore store = TaskStore.get(context);
        manager.cancel(pending(context));
        if (!store.enabled() || !notificationsAvailable(context)) return;
        Instant now = Instant.now();
        long next = Long.MAX_VALUE;
        JSONArray tasks = store.tasks();
        for (int i = 0; i < tasks.length(); i++) {
            JSONObject task = tasks.getJSONObject(i);
            if (task.optBoolean("done") || task.optBoolean("demo")) continue;
            String id = task.getString("id");
            String due = task.getString("due");
            int current = ReminderRules.stage(due, now);
            for (int stage = 1; stage <= 3; stage++) {
                if (store.delivered(ReminderRules.key(id, due, stage))) continue;
                long timestamp = LocalDate.parse(due).minusDays(stage).atTime(9, 0)
                    .atZone(ReminderRules.ZONE).toInstant().toEpochMilli();
                if (timestamp > now.toEpochMilli()) next = Math.min(next, timestamp);
                else if (stage == current) next = Math.min(next, now.toEpochMilli() + 2000);
            }
        }
        if (next != Long.MAX_VALUE) manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, pending(context));
    }

    static void fireDue(Context context) throws Exception {
        TaskStore store = TaskStore.get(context);
        if (!store.enabled() || !notificationsAvailable(context)) return;
        Instant now = Instant.now();
        JSONArray tasks = store.tasks();
        for (int i = 0; i < tasks.length(); i++) {
            JSONObject task = tasks.getJSONObject(i);
            if (task.optBoolean("done") || task.optBoolean("demo")) continue;
            int stage = ReminderRules.stage(task.getString("due"), now);
            if (stage == 0) continue;
            String key = ReminderRules.key(task.getString("id"), task.getString("due"), stage);
            if (store.claim(key)) {
                try {
                    show(context, task.getString("id").hashCode(), stage, task.getString("title"), false);
                    store.log("reminder_fired", new JSONObject().put("stage", stage).put("mode", "automatic"));
                } catch (RuntimeException failure) {
                    store.releaseClaim(key);
                    throw failure;
                }
            }
        }
    }

    static void preview(Context context, int stage) throws Exception {
        if (stage < 1 || stage > 3) throw new IllegalArgumentException("Tahap alarm tidak valid.");
        if (!notificationsAvailable(context)) throw new IllegalArgumentException("Izinkan notifikasi untuk mencoba alarm.");
        show(context, 9000 + stage, stage, "Contoh pengingat tugas", true);
        TaskStore.get(context).log("reminder_previewed", new JSONObject().put("stage", stage));
    }

    static void cancelTask(Context context, String id) {
        context.getSystemService(NotificationManager.class).cancel(id.hashCode());
    }

    private static void show(Context context, int id, int stage, String title, boolean preview) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        int[] sounds = {0, R.raw.alarm_1, R.raw.alarm_2, R.raw.alarm_3};
        String channelId = "deadline_stage_" + stage;
        NotificationChannel channel = new NotificationChannel(channelId, TITLES[stage], NotificationManager.IMPORTANCE_HIGH);
        AudioAttributes attributes = new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build();
        channel.setSound(Uri.parse("android.resource://" + context.getPackageName() + "/" + sounds[stage]), attributes);
        channel.enableVibration(true);
        manager.createNotificationChannel(channel);
        Intent open = new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent content = PendingIntent.getActivity(context, id, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification notification = new Notification.Builder(context, channelId)
            .setSmallIcon(R.drawable.ic_notification).setColor(0xff22675e)
            .setContentTitle((preview ? "Demo " : "") + TITLES[stage])
            .setContentText(title).setStyle(new Notification.BigTextStyle().bigText(title))
            .setContentIntent(content).setAutoCancel(true)
            .setCategory(Notification.CATEGORY_REMINDER).build();
        manager.notify(id, notification);
    }
}
