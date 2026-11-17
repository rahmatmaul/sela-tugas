package id.selatugas.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class ReminderReceiver extends BroadcastReceiver {
    private static final ExecutorService WORKER = Executors.newSingleThreadExecutor();

    @Override public void onReceive(Context context, Intent intent) {
        String action = intent == null ? null : intent.getAction();
        if (!ReminderScheduler.ACTION.equals(action) && !Intent.ACTION_BOOT_COMPLETED.equals(action)
                && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action) && !Intent.ACTION_TIME_CHANGED.equals(action)
                && !Intent.ACTION_TIMEZONE_CHANGED.equals(action)) return;
        PendingResult pending = goAsync();
        WORKER.execute(() -> {
            try {
                ReminderScheduler.fireDue(context);
            } catch (Exception error) { Log.e("SelaTugas", "Reminder delivery failed", error); }
            finally {
                try { ReminderScheduler.schedule(context); }
                catch (Exception error) { Log.e("SelaTugas", "Reminder scheduling failed", error); }
                AndroidAnalytics.flush(context);
                pending.finish();
            }
        });
    }
}
