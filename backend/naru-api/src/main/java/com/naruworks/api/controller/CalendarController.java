package com.naruworks.api.controller;

import com.naruworks.api.dto.request.CalendarCreateRequest;
import com.naruworks.api.dto.request.CalendarInvitationLinkAcceptRequest;
import com.naruworks.api.dto.request.CalendarInvitationLinkCreateRequest;
import com.naruworks.api.dto.response.CalendarMembershipResponse;
import com.naruworks.api.dto.response.CalendarInvitationLinkPreviewResponse;
import com.naruworks.api.dto.response.CalendarInvitationLinkResponse;
import com.naruworks.api.dto.response.CalendarMemberResponse;
import com.naruworks.api.security.CurrentMember;
import com.naruworks.core.port.MemberReader;
import com.naruworks.core.service.CalendarInvitationLinkService;
import com.naruworks.core.service.CalendarManagementService;
import com.naruworks.domain.model.Member;
import jakarta.validation.Valid;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
@RequestMapping("/api/calendars")
public class CalendarController {

    private final CalendarManagementService calendarManagementService;
    private final CalendarInvitationLinkService calendarInvitationLinkService;
    private final MemberReader memberReader;

    @Value("${naru.frontend-base-url:http://localhost:3000}")
    private String frontendBaseUrl;

    @GetMapping
    public List<CalendarMembershipResponse> getCalendars(@CurrentMember Member member) {
        return calendarManagementService.findCalendars(member.getId()).stream()
                .map(CalendarMembershipResponse::from)
                .toList();
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public CalendarMembershipResponse createCalendar(
            @CurrentMember Member member,
            @Valid @RequestBody CalendarCreateRequest request
    ) {
        return CalendarMembershipResponse.from(
                calendarManagementService.createCalendar(
                        member.getId(), request.name(), request.shared(), request.displayColor()
                )
        );
    }

    @DeleteMapping("/{calendarId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteCalendar(@CurrentMember Member member, @PathVariable Long calendarId) {
        calendarManagementService.deleteCalendar(member.getId(), calendarId);
    }

    @PostMapping("/{calendarId}/invitation-links")
    @ResponseStatus(HttpStatus.CREATED)
    public CalendarInvitationLinkResponse createInvitationLink(
            @CurrentMember Member member,
            @PathVariable Long calendarId,
            @Valid @RequestBody CalendarInvitationLinkCreateRequest request
    ) {
        var created = calendarInvitationLinkService.create(member.getId(), calendarId, request.role());
        return new CalendarInvitationLinkResponse(frontendBaseUrl + "/calendar?invite=" + created.token(), created.expiresAt());
    }

    @GetMapping("/invitation-links/preview")
    public CalendarInvitationLinkPreviewResponse previewInvitationLink(@RequestParam String token) {
        return CalendarInvitationLinkPreviewResponse.from(calendarInvitationLinkService.preview(token));
    }

    @PostMapping("/invitation-links/accept")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void acceptInvitationLink(@CurrentMember Member member,
            @Valid @RequestBody CalendarInvitationLinkAcceptRequest request) {
        calendarInvitationLinkService.accept(member.getId(), request.token());
    }

    @DeleteMapping("/{calendarId}/invitation-links")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void revokeInvitationLinks(@CurrentMember Member member, @PathVariable Long calendarId) {
        calendarInvitationLinkService.revoke(member.getId(), calendarId);
    }

    @GetMapping("/{calendarId}/members")
    public List<CalendarMemberResponse> getCalendarMembers(@CurrentMember Member member, @PathVariable Long calendarId) {
        return calendarInvitationLinkService.findMembers(member.getId(), calendarId).stream()
                .map(membership -> CalendarMemberResponse.from(membership, memberReader.findById(membership.memberId()).orElseThrow()))
                .toList();
    }

    @DeleteMapping("/{calendarId}/members/{memberId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void removeCalendarMember(@CurrentMember Member member, @PathVariable Long calendarId, @PathVariable Long memberId) {
        calendarInvitationLinkService.removeMember(member.getId(), calendarId, memberId);
    }
}
