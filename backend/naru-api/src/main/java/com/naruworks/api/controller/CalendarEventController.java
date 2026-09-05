package com.naruworks.api.controller;

import com.naruworks.api.dto.request.CalendarEventCreateRequest;
import com.naruworks.api.dto.request.CalendarEventUpdateRequest;
import com.naruworks.api.dto.response.CalendarEventResponse;
import com.naruworks.api.security.CurrentMember;
import com.naruworks.core.service.CalendarService;
import com.naruworks.domain.model.Member;
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
            @CurrentMember Member member,
            @RequestParam LocalDateTime from,
            @RequestParam LocalDateTime to
    ) {
        return calendarService.findEvents(member.getId(), from, to)
                .stream()
                .map(CalendarEventResponse::from)
                .toList();
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public CalendarEventResponse createEvent(
            @CurrentMember Member member,
            @Valid @RequestBody CalendarEventCreateRequest request
    ) {
        return CalendarEventResponse.from(
                calendarService.createEvent(member.getId(), request.toDomain())
        );
    }

    @GetMapping("/{id}")
    public CalendarEventResponse getEvent(
            @CurrentMember Member member,
            @PathVariable Long id
    ) {
        return CalendarEventResponse.from(
                calendarService.findEvent(member.getId(), id)
        );
    }

    @PutMapping("/{id}")
    public CalendarEventResponse updateEvent(
            @CurrentMember Member member,
            @PathVariable Long id,
            @Valid @RequestBody CalendarEventUpdateRequest request
    ) {
        return CalendarEventResponse.from(
                calendarService.updateEvent(member.getId(), id, request.toDomain(id))
        );
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteEvent(
            @CurrentMember Member member,
            @PathVariable Long id
    ) {
        calendarService.deleteEvent(member.getId(), id);
    }
}
