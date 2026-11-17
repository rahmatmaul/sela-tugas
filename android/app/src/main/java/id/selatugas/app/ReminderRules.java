package id.selatugas.app;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.temporal.ChronoUnit;

final class ReminderRules {
    static final ZoneId ZONE = ZoneId.of("Asia/Jakarta");

    static int stage(String due, Instant now) {
        ZonedDateTime local = now.atZone(ZONE);
        if (local.getHour() < 9) return 0;
        long days = ChronoUnit.DAYS.between(local.toLocalDate(), LocalDate.parse(due));
        return days >= 1 && days <= 3 ? (int) days : 0;
    }

    static String today() {
        return LocalDate.now(ZONE).toString();
    }

    static String key(String id, String due, int stage) {
        return id + "/" + due + "/" + stage;
    }
}
