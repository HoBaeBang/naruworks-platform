package com.naruworks.core.service;

import com.naruworks.core.port.CalendarEventReader;
import com.naruworks.core.port.CalendarEventWriter;
import com.naruworks.domain.model.CalendarEvent;
import com.naruworks.domain.model.CalendarEventOccurrence;
import com.naruworks.domain.type.CalendarEventRecurrenceRule;
import com.naruworks.domain.type.CalendarEventStatus;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;

@Service
@RequiredArgsConstructor
public class CalendarService {

    private final CalendarEventReader calendarEventReader;
    private final CalendarEventWriter calendarEventWriter;
    private final CalendarEventRecurrenceExpander calendarEventRecurrenceExpander;

    public List<CalendarEventOccurrence> findEvents(
            Long memberId,
            LocalDateTime from,
            LocalDateTime to
    ) {
        return calendarEventReader.findEvents(memberId, from, to)
                .stream()
                .flatMap(event -> calendarEventRecurrenceExpander.expand(event, from, to).stream())
                .sorted((left, right) -> left.event().getStartAt().compareTo(right.event().getStartAt()))
                .toList();
    }

    public CalendarEvent createEvent(Long memberId, CalendarEvent event) {
        validateEvent(event);

        CalendarEvent newEvent = CalendarEvent.of(
                null,
                memberId,
                event.getTitle(),
                event.getDescription(),
                event.getStartAt(),
                event.getEndAt(),
                event.isAllDay(),
                event.getLocation(),
                event.getColor(),
                event.getRecurrenceRule(),
                event.getRecurrenceEndAt(),
                CalendarEventStatus.ACTIVE
        );

        return calendarEventWriter.save(newEvent);
    }

    public CalendarEvent updateEvent(
            Long memberId,
            Long id,
            CalendarEvent event
    ) {
        validateEvent(event);

        CalendarEvent updateEvent = CalendarEvent.of(
                id,
                memberId,
                event.getTitle(),
                event.getDescription(),
                event.getStartAt(),
                event.getEndAt(),
                event.isAllDay(),
                event.getLocation(),
                event.getColor(),
                event.getRecurrenceRule(),
                event.getRecurrenceEndAt(),
                CalendarEventStatus.ACTIVE
        );

        return calendarEventWriter.update(memberId, updateEvent);
    }

    public CalendarEvent findEvent(Long memberId, Long id) {
        return calendarEventReader.findEvent(memberId, id);
    }

    public void deleteEvent(Long memberId, Long id) {
        calendarEventWriter.delete(memberId, id);
    }

    private void validateEvent(CalendarEvent event) {
        validateEventPeriod(event);
        validateRecurrence(event);
    }

    private void validateEventPeriod(CalendarEvent event) {
        if (!event.getStartAt().isBefore(event.getEndAt())) {
            throw new IllegalArgumentException("일정 시작 일시는 종료 일시보다 빨라야 합니다.");
        }
    }

    private void validateRecurrence(CalendarEvent event) {
        if (event.getRecurrenceRule() == CalendarEventRecurrenceRule.NONE
                && event.getRecurrenceEndAt() != null) {
            throw new IllegalArgumentException("반복하지 않는 일정에는 반복 종료일을 설정할 수 없습니다.");
        }

        if (event.getRecurrenceEndAt() != null
                && event.getRecurrenceEndAt().isBefore(event.getStartAt())) {
            throw new IllegalArgumentException("반복 종료 일시는 일정 시작 일시보다 빠를 수 없습니다.");
        }
    }
}
