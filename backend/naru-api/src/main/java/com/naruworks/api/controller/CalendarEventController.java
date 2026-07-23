package com.naruworks.api.controller;

import com.naruworks.api.dto.response.CalendarEventResponse;
import com.naruworks.core.service.CalendarService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.List;

@RestController
@RequiredArgsConstructor
@RequestMapping("/api/calendar/events")
public class CalendarEventController {

    private final CalendarService calendarService;

    @GetMapping
    public List<CalendarEventResponse> getEvents(
            @RequestParam LocalDateTime from,
            @RequestParam LocalDateTime to
    ) {
        return calendarService.findEvents(from, to)
                .stream()
                .map(CalendarEventResponse::from)
                .toList();
    }
}
