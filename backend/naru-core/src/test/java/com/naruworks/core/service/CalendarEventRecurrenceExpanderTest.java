package com.naruworks.core.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.BDDMockito.given;

import com.naruworks.core.port.LunarCalendarConverter;
import com.naruworks.domain.model.CalendarEvent;
import com.naruworks.domain.model.CalendarEventOccurrence;
import com.naruworks.domain.type.CalendarEventRecurrenceRule;
import com.naruworks.domain.type.CalendarEventStatus;
import java.time.LocalDateTime;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class CalendarEventRecurrenceExpanderTest {

    @Mock
    private LunarCalendarConverter lunarCalendarConverter;

    private CalendarEventRecurrenceExpander expander;

    @BeforeEach
    void setUp() {
        expander = new CalendarEventRecurrenceExpander(lunarCalendarConverter);
    }

    @Test
    @DisplayName("WEEKLY 일정은 조회 기간에 포함되는 같은 요일의 발생 일정만 만든다")
    void expand_weeklyEventsInQueryPeriod() {
        List<CalendarEventOccurrence> occurrences = expander.expand(
                event(CalendarEventRecurrenceRule.WEEKLY,
                        LocalDateTime.of(2026, 7, 24, 19, 0),
                        LocalDateTime.of(2026, 7, 24, 20, 0),
                        null),
                LocalDateTime.of(2026, 7, 30, 0, 0),
                LocalDateTime.of(2026, 8, 16, 0, 0)
        );

        assertThat(occurrences)
                .extracting(occurrence -> occurrence.event().getStartAt())
                .containsExactly(
                        LocalDateTime.of(2026, 7, 31, 19, 0),
                        LocalDateTime.of(2026, 8, 7, 19, 0),
                        LocalDateTime.of(2026, 8, 14, 19, 0)
                );
        assertThat(occurrences).allMatch(occurrence -> !occurrence.originalOccurrence());
    }

    @Test
    @DisplayName("MONTHLY 일정은 없는 날짜에 해당 월의 마지막 날로 발생한다")
    void expand_monthlyEventsAtLastDayOfShortMonth() {
        List<CalendarEventOccurrence> occurrences = expander.expand(
                event(CalendarEventRecurrenceRule.MONTHLY,
                        LocalDateTime.of(2026, 1, 31, 19, 0),
                        LocalDateTime.of(2026, 1, 31, 20, 0),
                        null),
                LocalDateTime.of(2026, 2, 1, 0, 0),
                LocalDateTime.of(2026, 5, 1, 0, 0)
        );

        assertThat(occurrences)
                .extracting(occurrence -> occurrence.event().getStartAt())
                .containsExactly(
                        LocalDateTime.of(2026, 2, 28, 19, 0),
                        LocalDateTime.of(2026, 3, 31, 19, 0),
                        LocalDateTime.of(2026, 4, 30, 19, 0)
                );
    }

    @Test
    @DisplayName("YEARLY 2월 29일 일정은 평년에는 2월 28일로 발생한다")
    void expand_yearlyLeapDayEventOnFebruaryTwentyEighth() {
        List<CalendarEventOccurrence> occurrences = expander.expand(
                event(CalendarEventRecurrenceRule.YEARLY,
                        LocalDateTime.of(2024, 2, 29, 9, 0),
                        LocalDateTime.of(2024, 2, 29, 10, 0),
                        null),
                LocalDateTime.of(2025, 1, 1, 0, 0),
                LocalDateTime.of(2028, 1, 1, 0, 0)
        );

        assertThat(occurrences)
                .extracting(occurrence -> occurrence.event().getStartAt())
                .containsExactly(
                        LocalDateTime.of(2025, 2, 28, 9, 0),
                        LocalDateTime.of(2026, 2, 28, 9, 0),
                        LocalDateTime.of(2027, 2, 28, 9, 0)
                );
    }

    @Test
    @DisplayName("반복 종료일 이후의 발생 일정은 만들지 않는다")
    void expand_stopsAfterRecurrenceEndAt() {
        List<CalendarEventOccurrence> occurrences = expander.expand(
                event(CalendarEventRecurrenceRule.WEEKLY,
                        LocalDateTime.of(2026, 7, 3, 19, 0),
                        LocalDateTime.of(2026, 7, 3, 20, 0),
                        LocalDateTime.of(2026, 7, 17, 23, 59, 59)),
                LocalDateTime.of(2026, 7, 1, 0, 0),
                LocalDateTime.of(2026, 8, 1, 0, 0)
        );

        assertThat(occurrences)
                .extracting(occurrence -> occurrence.event().getStartAt())
                .containsExactly(
                        LocalDateTime.of(2026, 7, 3, 19, 0),
                        LocalDateTime.of(2026, 7, 10, 19, 0),
                        LocalDateTime.of(2026, 7, 17, 19, 0)
                );
    }

    @Test
    @DisplayName("반복 규칙에 없는 일시는 발생 일정으로 판단하지 않는다")
    void isOccurrence_returnsFalseForDateOutsideWeeklyRule() {
        CalendarEvent event = event(
                CalendarEventRecurrenceRule.WEEKLY,
                LocalDateTime.of(2026, 7, 3, 19, 0),
                LocalDateTime.of(2026, 7, 3, 20, 0),
                null
        );

        assertThat(expander.isOccurrence(event, LocalDateTime.of(2026, 7, 10, 19, 0))).isTrue();
        assertThat(expander.isOccurrence(event, LocalDateTime.of(2026, 7, 11, 19, 0))).isFalse();
    }

    @Test
    @DisplayName("음력 연간 일정은 다음 해 같은 평달의 음력 날짜로 발생한다")
    void expand_lunarYearlyEventAtRegularLunarMonth() {
        CalendarEvent event = CalendarEvent.of(
                1L,
                10L,
                "음력 생일",
                null,
                LocalDateTime.of(2026, 4, 2, 9, 0),
                LocalDateTime.of(2026, 4, 2, 10, 0),
                false,
                null,
                "#20b977",
                CalendarEventRecurrenceRule.LUNAR_YEARLY,
                com.naruworks.domain.value.LunarDate.of(2, 15, false),
                null,
                CalendarEventStatus.ACTIVE
        );
        given(lunarCalendarConverter.toSolarDate(2027, 2, 15))
                .willReturn(java.time.LocalDate.of(2027, 3, 23));
        given(lunarCalendarConverter.toSolarDate(2028, 2, 15))
                .willReturn(java.time.LocalDate.of(2028, 3, 11));

        List<CalendarEventOccurrence> occurrences = expander.expand(
                event,
                LocalDateTime.of(2027, 1, 1, 0, 0),
                LocalDateTime.of(2028, 1, 1, 0, 0)
        );

        assertThat(occurrences).extracting(occurrence -> occurrence.event().getStartAt())
                .containsExactly(LocalDateTime.of(2027, 3, 23, 9, 0));
    }

    private CalendarEvent event(
            CalendarEventRecurrenceRule recurrenceRule,
            LocalDateTime startAt,
            LocalDateTime endAt,
            LocalDateTime recurrenceEndAt
    ) {
        return CalendarEvent.of(
                1L,
                10L,
                "운동",
                "저녁 러닝",
                startAt,
                endAt,
                false,
                "한강공원",
                "#20b977",
                recurrenceRule,
                recurrenceEndAt,
                CalendarEventStatus.ACTIVE
        );
    }
}
