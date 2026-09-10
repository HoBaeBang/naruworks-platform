package com.naruworks.api.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.naruworks.api.security.CurrentMemberArgumentResolver;
import com.naruworks.core.service.CalendarIntegrationService;
import com.naruworks.domain.model.CalendarIntegration;
import com.naruworks.domain.model.Member;
import com.naruworks.domain.type.CalendarIntegrationStatus;
import com.naruworks.domain.value.ReferralCode;
import java.time.LocalDateTime;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(GoogleCalendarIntegrationController.class)
class GoogleCalendarIntegrationControllerWebMvcTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private CalendarIntegrationService calendarIntegrationService;

    @MockitoBean
    private CurrentMemberArgumentResolver currentMemberArgumentResolver;

    @BeforeEach
    void setUp() throws Exception {
        Member currentMember = Member.createApprovedInitialAdminGoogleMember(
                "member@example.com",
                "Member",
                null,
                "google-member-id",
                ReferralCode.of("AB12CD"),
                LocalDateTime.of(2026, 9, 10, 10, 0)
        ).toBuilder().id(1L).build();
        given(currentMemberArgumentResolver.supportsParameter(any())).willReturn(true);
        given(currentMemberArgumentResolver.resolveArgument(any(), any(), any(), any()))
                .willReturn(currentMember);
    }

    @Test
    @DisplayName("Google Calendar 연결 상태 API는 OAuth token 없이 연결 상태만 반환한다")
    void getGoogleIntegration() throws Exception {
        CalendarIntegration integration = CalendarIntegration.connectGoogle(
                1L,
                "google-calendar-account",
                "calendar@example.com",
                "encrypted-refresh-token",
                LocalDateTime.of(2026, 9, 10, 10, 0)
        );
        given(calendarIntegrationService.findGoogleIntegration(1L))
                .willReturn(Optional.of(integration));

        mockMvc.perform(get("/api/calendar/integrations/google"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.connected").value(true))
                .andExpect(jsonPath("$.email").value("calendar@example.com"))
                .andExpect(jsonPath("$.status").value(CalendarIntegrationStatus.CONNECTED.name()))
                .andExpect(jsonPath("$.encryptedRefreshToken").doesNotExist());
    }
}
