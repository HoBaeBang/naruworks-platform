package com.naruworks.core.service;

import com.naruworks.core.port.CalendarEventReader;
import com.naruworks.core.port.CalendarEventWriter;
import com.naruworks.domain.model.CalendarEvent;
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

    public List<CalendarEvent> findEvents(LocalDateTime from, LocalDateTime to) {
        return calendarEventReader.findEvents(from, to);
    }

    public CalendarEvent createEvent(CalendarEvent event) {

        validateEventPeriod(event);

        CalendarEvent newEvent = CalendarEvent.of(
                null,
                event.title(),
                event.description(),
                event.startAt(),
                event.endAt(),
                event.allDay(),
                event.location(),
                event.color(),
                event.recurrenceRule(),
                event.recurrenceEndAt(),
                CalendarEventStatus.ACTIVE
        );

        return calendarEventWriter.save(newEvent);
    }

    public CalendarEvent updateEvent(Long id, CalendarEvent event) {
        validateEventPeriod(event);

        CalendarEvent updateEvent = CalendarEvent.of(
                id,
                event.title(),
                event.description(),
                event.startAt(),
                event.endAt(),
                event.allDay(),
                event.location(),
                event.color(),
                event.recurrenceRule(),
                event.recurrenceEndAt(),
                CalendarEventStatus.ACTIVE
        );

        return calendarEventWriter.update(updateEvent);
    }

    public CalendarEvent findEvent(Long id) {
        return calendarEventReader.findEvent(id);
    }

    public void deleteEvent(Long id) {
        calendarEventWriter.delete(id);
    }

    private void validateEventPeriod(CalendarEvent event) {
        if (!event.startAt().isBefore(event.endAt())) {
            throw new IllegalArgumentException("일정 시작 일시는 종료 일시보다 빨라야 합니다.");
        }
    }
}
