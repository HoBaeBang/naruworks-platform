package com.naruworks.core.service;

import com.naruworks.domain.model.CalendarEvent;
import com.naruworks.domain.model.CalendarEventOccurrence;
import com.naruworks.domain.type.CalendarEventRecurrenceRule;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.YearMonth;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Component;

/**
 * 반복 원본 일정을 요청한 기간에만 발생 일정으로 전개한다.
 */
@Component
public class CalendarEventRecurrenceExpander {

    public List<CalendarEventOccurrence> expand(
            CalendarEvent event,
            LocalDateTime from,
            LocalDateTime to
    ) {
        if (event.getRecurrenceRule() == CalendarEventRecurrenceRule.NONE) {
            return overlaps(event.getStartAt(), event.getEndAt(), from, to)
                    ? List.of(CalendarEventOccurrence.single(event))
                    : List.of();
        }

        List<CalendarEventOccurrence> occurrences = new ArrayList<>();
        LocalDateTime occurrenceStartAt = firstCandidate(event, from);
        long durationSeconds = ChronoUnit.SECONDS.between(event.getStartAt(), event.getEndAt());

        while (occurrenceStartAt.isBefore(to) && isWithinRecurrenceEnd(event, occurrenceStartAt)) {
            LocalDateTime occurrenceEndAt = occurrenceStartAt.plusSeconds(durationSeconds);

            if (overlaps(occurrenceStartAt, occurrenceEndAt, from, to)) {
                occurrences.add(CalendarEventOccurrence.recurring(
                        copyWithPeriod(event, occurrenceStartAt, occurrenceEndAt),
                        occurrenceStartAt.equals(event.getStartAt())
                ));
            }

            occurrenceStartAt = nextOccurrence(event, occurrenceStartAt);
        }

        return occurrences;
    }

    private LocalDateTime firstCandidate(CalendarEvent event, LocalDateTime from) {
        return switch (event.getRecurrenceRule()) {
            case WEEKLY -> event.getStartAt().plusWeeks(Math.max(0,
                    ChronoUnit.WEEKS.between(event.getStartAt().toLocalDate(), from.toLocalDate()) - 1));
            case MONTHLY -> occurrenceForMonth(event, Math.max(0,
                    ChronoUnit.MONTHS.between(YearMonth.from(event.getStartAt()), YearMonth.from(from)) - 1));
            case YEARLY -> occurrenceForYear(event, Math.max(0,
                    ChronoUnit.YEARS.between(event.getStartAt().toLocalDate(), from.toLocalDate()) - 1));
            case NONE -> event.getStartAt();
        };
    }

    private LocalDateTime nextOccurrence(CalendarEvent event, LocalDateTime occurrenceStartAt) {
        return switch (event.getRecurrenceRule()) {
            case WEEKLY -> occurrenceStartAt.plusWeeks(1);
            case MONTHLY -> occurrenceForMonth(event,
                    ChronoUnit.MONTHS.between(YearMonth.from(event.getStartAt()), YearMonth.from(occurrenceStartAt)) + 1);
            case YEARLY -> occurrenceForYear(event,
                    occurrenceStartAt.getYear() - event.getStartAt().getYear() + 1L);
            case NONE -> throw new IllegalStateException("반복하지 않는 일정은 다음 발생 일시를 계산할 수 없습니다.");
        };
    }

    private LocalDateTime occurrenceForMonth(CalendarEvent event, long monthsFromStart) {
        YearMonth yearMonth = YearMonth.from(event.getStartAt()).plusMonths(monthsFromStart);
        int dayOfMonth = Math.min(event.getStartAt().getDayOfMonth(), yearMonth.lengthOfMonth());

        return yearMonth.atDay(dayOfMonth).atTime(event.getStartAt().toLocalTime());
    }

    private LocalDateTime occurrenceForYear(CalendarEvent event, long yearsFromStart) {
        LocalDate targetDate = event.getStartAt().toLocalDate().plusYears(yearsFromStart);

        return targetDate.atTime(event.getStartAt().toLocalTime());
    }

    private boolean isWithinRecurrenceEnd(CalendarEvent event, LocalDateTime occurrenceStartAt) {
        return event.getRecurrenceEndAt() == null
                || !occurrenceStartAt.isAfter(event.getRecurrenceEndAt());
    }

    private boolean overlaps(
            LocalDateTime startAt,
            LocalDateTime endAt,
            LocalDateTime from,
            LocalDateTime to
    ) {
        return startAt.isBefore(to) && endAt.isAfter(from);
    }

    private CalendarEvent copyWithPeriod(
            CalendarEvent event,
            LocalDateTime startAt,
            LocalDateTime endAt
    ) {
        return CalendarEvent.of(
                event.getId(),
                event.getMemberId(),
                event.getTitle(),
                event.getDescription(),
                startAt,
                endAt,
                event.isAllDay(),
                event.getLocation(),
                event.getColor(),
                event.getRecurrenceRule(),
                event.getRecurrenceEndAt(),
                event.getStatus()
        );
    }
}
