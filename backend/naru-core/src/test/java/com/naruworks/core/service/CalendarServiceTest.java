package com.naruworks.core.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.mockito.BDDMockito.then;

import com.naruworks.core.port.CalendarEventReader;
import com.naruworks.core.port.CalendarEventWriter;
import com.naruworks.core.port.CalendarEventExceptionReader;
import com.naruworks.core.port.CalendarEventExceptionWriter;
import com.naruworks.domain.model.CalendarEvent;
import com.naruworks.domain.model.CalendarEventException;
import com.naruworks.domain.type.CalendarEventOccurrenceScope;
import com.naruworks.domain.type.CalendarEventRecurrenceRule;
import com.naruworks.domain.type.CalendarEventStatus;
import java.time.LocalDateTime;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class CalendarServiceTest {

    @Mock
    private CalendarEventReader calendarEventReader;

    @Mock
    private CalendarEventWriter calendarEventWriter;

    @Mock
    private CalendarEventExceptionReader calendarEventExceptionReader;

    @Mock
    private CalendarEventExceptionWriter calendarEventExceptionWriter;

    @Test
    @DisplayName("반복 종료일이 있는 WEEKLY 일정은 저장할 수 있다")
    void createEvent_weeklyWithRecurrenceEndAt() {
        CalendarEvent event = event(
                CalendarEventRecurrenceRule.WEEKLY,
                LocalDateTime.of(2026, 10, 31, 23, 59, 59)
        );
        given(calendarEventWriter.save(any(CalendarEvent.class)))
                .willAnswer(invocation -> invocation.getArgument(0));

        CalendarEvent result = service().createEvent(1L, event);

        ArgumentCaptor<CalendarEvent> savedEvent = ArgumentCaptor.forClass(CalendarEvent.class);
        then(calendarEventWriter).should().save(savedEvent.capture());
        assertThat(savedEvent.getValue().getRecurrenceRule())
                .isEqualTo(CalendarEventRecurrenceRule.WEEKLY);
        assertThat(savedEvent.getValue().getRecurrenceEndAt())
                .isEqualTo(LocalDateTime.of(2026, 10, 31, 23, 59, 59));
        assertThat(result.getRecurrenceRule()).isEqualTo(CalendarEventRecurrenceRule.WEEKLY);
    }

    @Test
    @DisplayName("반복 종료일 없이 MONTHLY 일정을 저장할 수 있다")
    void createEvent_monthlyWithoutRecurrenceEndAt() {
        CalendarEvent event = event(CalendarEventRecurrenceRule.MONTHLY, null);
        given(calendarEventWriter.save(any(CalendarEvent.class)))
                .willAnswer(invocation -> invocation.getArgument(0));

        CalendarEvent result = service().createEvent(1L, event);

        assertThat(result.getRecurrenceRule()).isEqualTo(CalendarEventRecurrenceRule.MONTHLY);
        assertThat(result.getRecurrenceEndAt()).isNull();
    }

    @Test
    @DisplayName("반복하지 않는 일정에 반복 종료일을 설정할 수 없다")
    void createEvent_noneWithRecurrenceEndAt() {
        CalendarEvent event = event(
                CalendarEventRecurrenceRule.NONE,
                LocalDateTime.of(2026, 10, 31, 23, 59, 59)
        );

        assertThatThrownBy(() -> service().createEvent(1L, event))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("반복하지 않는 일정에는 반복 종료일을 설정할 수 없습니다.");

        then(calendarEventWriter).shouldHaveNoInteractions();
    }

    @Test
    @DisplayName("반복 종료일은 일정 시작 일시보다 빠를 수 없다")
    void createEvent_recurrenceEndAtBeforeStartAt() {
        CalendarEvent event = event(
                CalendarEventRecurrenceRule.YEARLY,
                LocalDateTime.of(2026, 7, 23, 23, 59, 59)
        );

        assertThatThrownBy(() -> service().createEvent(1L, event))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("반복 종료 일시는 일정 시작 일시보다 빠를 수 없습니다.");

        then(calendarEventWriter).shouldHaveNoInteractions();
    }

    @Test
    @DisplayName("종일 일정은 자정부터 다음 날 자정까지 저장할 수 있다")
    void createEvent_allDayEventAtMidnight() {
        CalendarEvent allDayEvent = CalendarEvent.of(
                null,
                null,
                "휴가",
                "여름 휴가",
                LocalDateTime.of(2026, 7, 24, 0, 0),
                LocalDateTime.of(2026, 7, 25, 0, 0),
                true,
                "제주",
                "#20b977",
                CalendarEventRecurrenceRule.NONE,
                null,
                CalendarEventStatus.ACTIVE
        );
        given(calendarEventWriter.save(any(CalendarEvent.class)))
                .willAnswer(invocation -> invocation.getArgument(0));

        CalendarEvent result = service().createEvent(1L, allDayEvent);

        assertThat(result.isAllDay()).isTrue();
        assertThat(result.getStartAt()).isEqualTo(LocalDateTime.of(2026, 7, 24, 0, 0));
        assertThat(result.getEndAt()).isEqualTo(LocalDateTime.of(2026, 7, 25, 0, 0));
    }

    @Test
    @DisplayName("종일 일정은 자정이 아닌 시각으로 저장할 수 없다")
    void createEvent_allDayEventWithNonMidnightTime() {
        CalendarEvent allDayEvent = CalendarEvent.of(
                null,
                null,
                "휴가",
                "여름 휴가",
                LocalDateTime.of(2026, 7, 24, 9, 0),
                LocalDateTime.of(2026, 7, 25, 0, 0),
                true,
                "제주",
                "#20b977",
                CalendarEventRecurrenceRule.NONE,
                null,
                CalendarEventStatus.ACTIVE
        );

        assertThatThrownBy(() -> service().createEvent(1L, allDayEvent))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("종일 일정은 시작과 종료 시각을 자정으로 설정해야 합니다.");

        then(calendarEventWriter).shouldHaveNoInteractions();
    }

    @Test
    @DisplayName("반복 일정의 이번 회차 수정은 원본 대신 예외 일정을 저장한다")
    void updateOccurrence_thisStoresOverrideException() {
        CalendarEvent series = CalendarEvent.of(
                10L,
                1L,
                "운동",
                "저녁 러닝",
                LocalDateTime.of(2026, 7, 3, 19, 0),
                LocalDateTime.of(2026, 7, 3, 20, 0),
                false,
                "한강공원",
                "#20b977",
                CalendarEventRecurrenceRule.WEEKLY,
                null,
                CalendarEventStatus.ACTIVE
        );
        CalendarEvent updatedEvent = event(CalendarEventRecurrenceRule.WEEKLY, null);
        given(calendarEventReader.findEvent(1L, 10L)).willReturn(series);

        service().updateOccurrence(
                1L,
                10L,
                LocalDateTime.of(2026, 7, 10, 19, 0),
                CalendarEventOccurrenceScope.THIS,
                updatedEvent
        );

        ArgumentCaptor<CalendarEventException> exceptionCaptor =
                ArgumentCaptor.forClass(CalendarEventException.class);
        then(calendarEventExceptionWriter).should().save(exceptionCaptor.capture());
        assertThat(exceptionCaptor.getValue().calendarEventId()).isEqualTo(10L);
        assertThat(exceptionCaptor.getValue().occurrenceStartAt())
                .isEqualTo(LocalDateTime.of(2026, 7, 10, 19, 0));
    }

    @Test
    @DisplayName("반복 일정의 이후 회차 수정은 기존 시리즈를 끝내고 새 시리즈를 만든다")
    void updateOccurrence_thisAndFollowingSplitsSeries() {
        CalendarEvent series = CalendarEvent.of(
                10L,
                1L,
                "운동",
                "저녁 러닝",
                LocalDateTime.of(2026, 7, 3, 19, 0),
                LocalDateTime.of(2026, 7, 3, 20, 0),
                false,
                "한강공원",
                "#20b977",
                CalendarEventRecurrenceRule.WEEKLY,
                null,
                CalendarEventStatus.ACTIVE
        );
        CalendarEvent updatedEvent = event(CalendarEventRecurrenceRule.WEEKLY, null);
        given(calendarEventReader.findEvent(1L, 10L)).willReturn(series);
        given(calendarEventWriter.save(any(CalendarEvent.class)))
                .willAnswer(invocation -> invocation.getArgument(0));

        service().updateOccurrence(
                1L,
                10L,
                LocalDateTime.of(2026, 7, 17, 19, 0),
                CalendarEventOccurrenceScope.THIS_AND_FOLLOWING,
                updatedEvent
        );

        ArgumentCaptor<CalendarEvent> shortenedSeriesCaptor = ArgumentCaptor.forClass(CalendarEvent.class);
        then(calendarEventWriter).should().update(org.mockito.ArgumentMatchers.eq(1L), shortenedSeriesCaptor.capture());
        assertThat(shortenedSeriesCaptor.getValue().getRecurrenceEndAt())
                .isEqualTo(LocalDateTime.of(2026, 7, 17, 18, 59, 59, 999_999_999));
        then(calendarEventWriter).should().save(any(CalendarEvent.class));
    }

    private CalendarService service() {
        return new CalendarService(
                calendarEventReader,
                calendarEventWriter,
                new CalendarEventRecurrenceExpander(),
                calendarEventExceptionReader,
                calendarEventExceptionWriter
        );
    }

    private CalendarEvent event(
            CalendarEventRecurrenceRule recurrenceRule,
            LocalDateTime recurrenceEndAt
    ) {
        return CalendarEvent.of(
                null,
                null,
                "운동",
                "저녁 러닝",
                LocalDateTime.of(2026, 7, 24, 19, 0),
                LocalDateTime.of(2026, 7, 24, 20, 0),
                false,
                "한강공원",
                "#20b977",
                recurrenceRule,
                recurrenceEndAt,
                CalendarEventStatus.ACTIVE
        );
    }
}
