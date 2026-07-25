package com.naruworks.api.controller;

import com.naruworks.api.dto.request.CalendarEventCreateRequest;
import com.naruworks.api.dto.request.CalendarEventUpdateRequest;
import com.naruworks.api.dto.response.CalendarEventResponse;
import com.naruworks.core.service.CalendarService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
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

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public CalendarEventResponse createEvent(
            @Valid @RequestBody CalendarEventCreateRequest request
    ) {
        return CalendarEventResponse.from(
                calendarService.createEvent(request.toDomain())
        );
    }

    @GetMapping("/{id}")
    public CalendarEventResponse getEvent(@PathVariable Long id) {
        return CalendarEventResponse.from(
                calendarService.findEvent(id)
        );
    }

    @PutMapping("/{id}")
    public CalendarEventResponse updateEvent(
            @PathVariable Long id,
            @Valid @RequestBody CalendarEventUpdateRequest request
    ) {
        return CalendarEventResponse.from(
                calendarService.updateEvent(id, request.toDomain(id))
        );
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteEvent(@PathVariable Long id) {
        calendarService.deleteEvent(id);
    }
}
