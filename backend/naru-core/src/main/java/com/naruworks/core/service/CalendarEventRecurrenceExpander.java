package com.naruworks.core.service;

import com.naruworks.core.port.LunarCalendarConverter;
import com.naruworks.domain.model.CalendarEvent;
import com.naruworks.domain.model.CalendarEventOccurrence;
import com.naruworks.domain.type.CalendarEventRecurrenceRule;
import com.naruworks.domain.value.LunarDate;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.YearMonth;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 반복 원본 일정 한 건을 요청한 기간에 필요한 발생 일정으로 전개한다.
 * DB에 매 회차를 저장하지 않고, 화면 조회 시점에만 계산한다.
 */
@Component
@RequiredArgsConstructor
public class CalendarEventRecurrenceExpander {

    private final LunarCalendarConverter lunarCalendarConverter;

    /**
     * 일정이 조회 기간과 겹치는 모든 발생 회차를 만든다.
     * 단일 일정은 그대로 반환하고, 반복 일정은 첫 후보부터 다음 회차를 순서대로 계산한다.
     */
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
        // 조회 시작일 직전 회차도 여러 날 일정이면 기간과 겹칠 수 있어 후보에 포함한다.
        LocalDateTime occurrenceStartAt = firstCandidate(event, from);
        long occurrenceDurationSeconds = ChronoUnit.SECONDS.between(
                event.getStartAt(),
                event.getEndAt()
        );

        while (occurrenceStartAt.isBefore(to) && isWithinRecurrenceEnd(event, occurrenceStartAt)) {
            LocalDateTime occurrenceEndAt = occurrenceStartAt.plusSeconds(occurrenceDurationSeconds);

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

    /**
     * 전달한 일시가 원본 반복 규칙으로 실제 발생하는 회차인지 확인한다.
     * 회차 수정·삭제 API가 임의의 날짜를 예외로 저장하지 않도록 검증할 때 사용한다.
     */
    public boolean isOccurrence(CalendarEvent event, LocalDateTime occurrenceStartAt) {
        if (event.getRecurrenceRule() == CalendarEventRecurrenceRule.NONE
                || occurrenceStartAt.isBefore(event.getStartAt())
                || !isWithinRecurrenceEnd(event, occurrenceStartAt)
                || !occurrenceStartAt.toLocalTime().equals(event.getStartAt().toLocalTime())) {
            return false;
        }

        return switch (event.getRecurrenceRule()) {
            case WEEKLY -> ChronoUnit.DAYS.between(
                    event.getStartAt().toLocalDate(),
                    occurrenceStartAt.toLocalDate()
            ) % 7 == 0;
            case MONTHLY -> occurrenceStartAt.equals(occurrenceForMonth(
                    event,
                    ChronoUnit.MONTHS.between(
                            YearMonth.from(event.getStartAt()),
                            YearMonth.from(occurrenceStartAt)
                    )
            ));
            case YEARLY -> occurrenceStartAt.equals(occurrenceForYear(
                    event,
                    occurrenceStartAt.getYear() - event.getStartAt().getYear()
            ));
            case LUNAR_YEARLY -> occurrenceStartAt.equals(
                    occurrenceForLunarYear(event, occurrenceStartAt.getYear())
            );
            case NONE -> false;
        };
    }

    /**
     * 조회 시작일 근처의 첫 계산 후보를 찾는다.
     * 한 회차 앞에서 시작해 조회 범위 시작 전부터 이어지는 일정도 놓치지 않는다.
     */
    private LocalDateTime firstCandidate(CalendarEvent event, LocalDateTime from) {
        return switch (event.getRecurrenceRule()) {
            case WEEKLY -> event.getStartAt().plusWeeks(Math.max(0,
                    ChronoUnit.WEEKS.between(event.getStartAt().toLocalDate(), from.toLocalDate()) - 1));
            case MONTHLY -> occurrenceForMonth(event, Math.max(0,
                    ChronoUnit.MONTHS.between(YearMonth.from(event.getStartAt()), YearMonth.from(from)) - 1));
            case YEARLY -> occurrenceForYear(event, Math.max(0,
                    ChronoUnit.YEARS.between(event.getStartAt().toLocalDate(), from.toLocalDate()) - 1));
            case LUNAR_YEARLY -> occurrenceForLunarYear(
                    event,
                    Math.max(event.getStartAt().getYear(), from.getYear() - 1)
            );
            case NONE -> event.getStartAt();
        };
    }

    /** 현재 회차 다음에 오는 동일 시리즈의 시작 일시를 계산한다. */
    private LocalDateTime nextOccurrence(CalendarEvent event, LocalDateTime occurrenceStartAt) {
        return switch (event.getRecurrenceRule()) {
            case WEEKLY -> occurrenceStartAt.plusWeeks(1);
            case MONTHLY -> occurrenceForMonth(event,
                    ChronoUnit.MONTHS.between(YearMonth.from(event.getStartAt()), YearMonth.from(occurrenceStartAt)) + 1);
            case YEARLY -> occurrenceForYear(event,
                    occurrenceStartAt.getYear() - event.getStartAt().getYear() + 1L);
            case LUNAR_YEARLY -> occurrenceForLunarYear(event, occurrenceStartAt.getYear() + 1);
            case NONE -> throw new IllegalStateException("반복하지 않는 일정은 다음 발생 일시를 계산할 수 없습니다.");
        };
    }

    /**
     * 시작 월에서 지정한 개월 수만큼 떨어진 회차를 계산한다.
     * 29~31일처럼 해당 날짜가 없는 달은 마지막 날로 보정한다.
     */
    private LocalDateTime occurrenceForMonth(CalendarEvent event, long monthsFromStart) {
        YearMonth yearMonth = YearMonth.from(event.getStartAt()).plusMonths(monthsFromStart);
        int dayOfMonth = Math.min(event.getStartAt().getDayOfMonth(), yearMonth.lengthOfMonth());

        return yearMonth.atDay(dayOfMonth).atTime(event.getStartAt().toLocalTime());
    }

    /**
     * 시작 연도에서 지정한 연도 수만큼 떨어진 회차를 계산한다.
     * LocalDate.plusYears는 2월 29일을 평년의 2월 28일로 보정한다.
     */
    private LocalDateTime occurrenceForYear(CalendarEvent event, long yearsFromStart) {
        LocalDate targetDate = event.getStartAt().toLocalDate().plusYears(yearsFromStart);

        return targetDate.atTime(event.getStartAt().toLocalTime());
    }

    /**
     * 음력 연간 반복은 저장한 평달 월·일을 해당 연도의 양력 날짜로 변환한다.
     * 첫 원본이 윤달 날짜여도 이후 연도에는 같은 평달을 기준으로 계산한다.
     */
    private LocalDateTime occurrenceForLunarYear(CalendarEvent event, int lunarYear) {
        if (lunarYear == event.getStartAt().getYear()) {
            return event.getStartAt();
        }

        LunarDate lunarDate = event.getRecurrenceLunarDate();
        if (lunarDate == null) {
            throw new IllegalStateException("음력 반복 일정의 기준 날짜가 없습니다.");
        }

        LocalDate solarDate = lunarCalendarConverter.toSolarDate(
                lunarYear,
                lunarDate.month(),
                lunarDate.day()
        );
        return solarDate.atTime(event.getStartAt().toLocalTime());
    }

    /** 반복 종료일이 없거나, 현재 회차가 반복 종료일 이전 또는 같은지 확인한다. */
    private boolean isWithinRecurrenceEnd(CalendarEvent event, LocalDateTime occurrenceStartAt) {
        return event.getRecurrenceEndAt() == null
                || !occurrenceStartAt.isAfter(event.getRecurrenceEndAt());
    }

    /** [startAt, endAt) 일정 구간이 [from, to) 조회 구간과 겹치는지 확인한다. */
    private boolean overlaps(
            LocalDateTime startAt,
            LocalDateTime endAt,
            LocalDateTime from,
            LocalDateTime to
    ) {
        return startAt.isBefore(to) && endAt.isAfter(from);
    }

    /**
     * 원본 일정의 메타데이터는 유지하고, 계산된 회차의 시작·종료 일시만 적용한 복사본을 만든다.
     */
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
                event.getRecurrenceLunarDate(),
                event.getRecurrenceEndAt(),
                event.getStatus()
        );
    }
}
