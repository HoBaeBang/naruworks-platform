package com.naruworks.core.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.mockito.BDDMockito.then;

import com.naruworks.core.port.CalendarEventReader;
import com.naruworks.core.port.CalendarEventWriter;
import com.naruworks.domain.model.CalendarEvent;
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

    private CalendarService service() {
        return new CalendarService(calendarEventReader, calendarEventWriter);
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
