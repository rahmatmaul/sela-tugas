package id.selatugas.app;

import static org.junit.Assert.*;
import java.time.Instant;
import org.junit.Test;

public class ReminderRulesTest {
    @Test public void stagesUseJakartaCalendarAndDailyCutoff() {
        assertEquals(0, ReminderRules.stage("2026-11-20", Instant.parse("2026-11-17T01:59:00Z")));
        assertEquals(3, ReminderRules.stage("2026-11-20", Instant.parse("2026-11-17T02:00:00Z")));
        assertEquals(2, ReminderRules.stage("2026-11-20", Instant.parse("2026-11-18T02:00:00Z")));
        assertEquals(1, ReminderRules.stage("2026-11-20", Instant.parse("2026-11-19T02:00:00Z")));
        assertEquals(0, ReminderRules.stage("2026-11-20", Instant.parse("2026-11-20T02:00:00Z")));
    }
    @Test public void calendarCrossesMonthAndYearBoundaries() {
        assertEquals(1, ReminderRules.stage("2027-01-01", Instant.parse("2026-12-31T02:00:00Z")));
        assertEquals(1, ReminderRules.stage("2026-12-01", Instant.parse("2026-11-30T02:00:00Z")));
    }
}
