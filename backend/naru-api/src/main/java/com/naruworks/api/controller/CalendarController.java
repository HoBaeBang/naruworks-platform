package com.naruworks.api.controller;

import com.naruworks.api.dto.request.CalendarCreateRequest;
import com.naruworks.api.dto.request.CalendarMemberCreateRequest;
import com.naruworks.api.dto.response.CalendarMembershipResponse;
import com.naruworks.api.security.CurrentMember;
import com.naruworks.core.service.CalendarManagementService;
import com.naruworks.domain.model.Member;
import jakarta.validation.Valid;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
@RequestMapping("/api/calendars")
public class CalendarController {

    private final CalendarManagementService calendarManagementService;

    @GetMapping
    public List<CalendarMembershipResponse> getCalendars(@CurrentMember Member member) {
        return calendarManagementService.findCalendars(member.getId()).stream()
                .map(CalendarMembershipResponse::from)
                .toList();
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public CalendarMembershipResponse createSharedCalendar(
            @CurrentMember Member member,
            @Valid @RequestBody CalendarCreateRequest request
    ) {
        return CalendarMembershipResponse.from(
                calendarManagementService.createSharedCalendar(member.getId(), request.name())
        );
    }

    @PostMapping("/{calendarId}/members")
    @ResponseStatus(HttpStatus.CREATED)
    public CalendarMembershipResponse addCalendarMember(
            @CurrentMember Member member,
            @PathVariable Long calendarId,
            @Valid @RequestBody CalendarMemberCreateRequest request
    ) {
        return CalendarMembershipResponse.from(calendarManagementService.addMember(
                member.getId(), calendarId, request.email(), request.role()
        ));
    }
}
