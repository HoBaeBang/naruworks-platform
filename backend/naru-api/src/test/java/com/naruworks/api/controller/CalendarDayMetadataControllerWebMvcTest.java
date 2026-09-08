package com.naruworks.api.controller;

import com.naruworks.api.security.CurrentMemberArgumentResolver;
import com.naruworks.core.service.CalendarDayMetadataService;
import com.naruworks.domain.model.Member;
import com.naruworks.domain.value.CalendarDayMetadata;
import com.naruworks.domain.value.LunarDate;
import com.naruworks.domain.value.ReferralCode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.mockito.BDDMockito.given;

@WebMvcTest(CalendarDayMetadataController.class)
class CalendarDayMetadataControllerWebMvcTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private CalendarDayMetadataService calendarDayMetadataService;

    @MockitoBean
    private CurrentMemberArgumentResolver currentMemberArgumentResolver;

    @BeforeEach
    void setUp() throws Exception {
        Member currentMember = Member.createApprovedInitialAdminGoogleMember(
                "member@example.com",
                "Member",
                null,
                "google-member",
                ReferralCode.of("ADMIN1"),
                LocalDateTime.of(2026, 9, 8, 10, 0)
        );
        given(currentMemberArgumentResolver.supportsParameter(any())).willReturn(true);
        given(currentMemberArgumentResolver.resolveArgument(any(), any(), any(), any()))
                .willReturn(currentMember);
    }

    @Test
    @DisplayName("달력 날짜 메타데이터 API는 음력과 공휴일명을 반환한다")
    void getDayMetadata() throws Exception {
        given(calendarDayMetadataService.findBetween(
                LocalDate.of(2026, 3, 1),
                LocalDate.of(2026, 3, 1)
        )).willReturn(List.of(CalendarDayMetadata.of(
                LocalDate.of(2026, 3, 1),
                LunarDate.of(1, 13, false),
                "삼일절"
        )));

        mockMvc.perform(get("/api/calendar/day-metadata")
                        .param("from", "2026-03-01")
                        .param("to", "2026-03-01"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].date").value("2026-03-01"))
                .andExpect(jsonPath("$[0].lunarMonth").value(1))
                .andExpect(jsonPath("$[0].lunarDay").value(13))
                .andExpect(jsonPath("$[0].lunarIntercalation").value(false))
                .andExpect(jsonPath("$[0].holidayName").value("삼일절"));
    }
}
