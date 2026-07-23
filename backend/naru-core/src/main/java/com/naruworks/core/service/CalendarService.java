package com.naruworks.core.service;

import com.naruworks.core.port.CalendarEventReader;
import com.naruworks.domain.model.CalendarEvent;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;

@Service
@RequiredArgsConstructor
public class CalendarService {

    private final CalendarEventReader calendarEventReader;

    public List<CalendarEvent> findEvents(LocalDateTime from, LocalDateTime to) {
        return calendarEventReader.findEvents(from, to);
    }
}
