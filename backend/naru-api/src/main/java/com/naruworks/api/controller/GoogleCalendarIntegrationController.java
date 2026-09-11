package com.naruworks.api.controller;

import com.naruworks.api.dto.response.GoogleCalendarIntegrationResponse;
import com.naruworks.api.dto.request.GoogleCalendarSelectionUpdateRequest;
import com.naruworks.api.dto.response.GoogleCalendarSelectionResponse;
import com.naruworks.api.security.AuthSessionAttribute;
import com.naruworks.api.security.CurrentMember;
import com.naruworks.core.service.CalendarIntegrationService;
import com.naruworks.domain.model.Member;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import jakarta.validation.Valid;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.List;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;

@RestController
@RequestMapping("/api/calendar/integrations/google")
@RequiredArgsConstructor
public class GoogleCalendarIntegrationController {

    private static final SecureRandom SECURE_RANDOM = new SecureRandom();

    private final CalendarIntegrationService calendarIntegrationService;

    @Value("${naru.frontend-base-url}")
    private String frontendBaseUrl;

    /** 현재 회원의 브라우저 세션에 CSRF 방지 state를 보관한 뒤 Google 동의 화면으로 이동한다. */
    @GetMapping("/authorize")
    public void authorize(
            @CurrentMember Member member,
            HttpServletRequest request,
            HttpServletResponse response
    ) throws IOException {
        String state = createState();
        HttpSession session = request.getSession();
        session.setAttribute(AuthSessionAttribute.PENDING_GOOGLE_CALENDAR_OAUTH_STATE, state);
        session.setAttribute(AuthSessionAttribute.PENDING_GOOGLE_CALENDAR_MEMBER_ID, member.getId());

        response.sendRedirect(calendarIntegrationService.createGoogleAuthorizationUrl(state));
    }

    /** Google callback의 state와 로그인 회원을 검증한 뒤 OAuth 연결을 저장하고 Calendar로 돌아간다. */
    @GetMapping("/callback")
    public void callback(
            @CurrentMember Member member,
            @RequestParam String code,
            @RequestParam String state,
            HttpServletRequest request,
            HttpServletResponse response
    ) throws IOException {
        validateState(request.getSession(false), member.getId(), state);
        calendarIntegrationService.connectGoogleCalendar(member.getId(), code);
        response.sendRedirect(frontendBaseUrl + "/calendar?google-calendar=connected");
    }

    @GetMapping
    public List<GoogleCalendarIntegrationResponse> getGoogleIntegrations(@CurrentMember Member member) {
        return calendarIntegrationService.findGoogleIntegrations(member.getId()).stream()
                .map(GoogleCalendarIntegrationResponse::from)
                .toList();
    }

    /** 연결된 Google 계정이 제공하는 캘린더 목록과 현재 표시 선택 상태를 조회한다. */
    @GetMapping("/accounts/{integrationId}/calendars")
    public List<GoogleCalendarSelectionResponse> getGoogleCalendars(
            @CurrentMember Member member,
            @org.springframework.web.bind.annotation.PathVariable Long integrationId
    ) {
        return calendarIntegrationService.findGoogleCalendars(member.getId(), integrationId).stream()
                .map(GoogleCalendarSelectionResponse::from)
                .toList();
    }

    /** NaruWorks 캘린더에 표시할 Google 캘린더를 여러 개 저장한다. */
    @PutMapping("/accounts/{integrationId}/calendars")
    public List<GoogleCalendarSelectionResponse> updateGoogleCalendarSelections(
            @CurrentMember Member member,
            @org.springframework.web.bind.annotation.PathVariable Long integrationId,
            @Valid @RequestBody GoogleCalendarSelectionUpdateRequest request
    ) {
        return calendarIntegrationService.updateGoogleCalendarSelections(
                        member.getId(),
                        integrationId,
                        Set.copyOf(request.calendarIds())
                ).stream()
                .map(GoogleCalendarSelectionResponse::from)
                .toList();
    }

    private String createState() {
        byte[] randomBytes = new byte[32];
        SECURE_RANDOM.nextBytes(randomBytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(randomBytes);
    }

    private void validateState(HttpSession session, Long memberId, String state) {
        if (session == null) {
            throw new IllegalArgumentException("Google Calendar 연결 세션이 만료되었습니다. 다시 시도해주세요.");
        }

        Object expectedState = session.getAttribute(
                AuthSessionAttribute.PENDING_GOOGLE_CALENDAR_OAUTH_STATE
        );
        Object expectedMemberId = session.getAttribute(
                AuthSessionAttribute.PENDING_GOOGLE_CALENDAR_MEMBER_ID
        );
        session.removeAttribute(AuthSessionAttribute.PENDING_GOOGLE_CALENDAR_OAUTH_STATE);
        session.removeAttribute(AuthSessionAttribute.PENDING_GOOGLE_CALENDAR_MEMBER_ID);

        boolean stateMatches = expectedState instanceof String expected
                && MessageDigest.isEqual(
                        expected.getBytes(StandardCharsets.UTF_8),
                        state.getBytes(StandardCharsets.UTF_8)
                );
        if (!stateMatches || !memberId.equals(expectedMemberId)) {
            throw new IllegalArgumentException("유효하지 않은 Google Calendar 연결 요청입니다.");
        }
    }
}
