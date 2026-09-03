package com.naruworks.api.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.naruworks.api.security.CurrentMemberArgumentResolver;
import com.naruworks.domain.model.Member;
import com.naruworks.domain.value.ReferralCode;
import java.time.LocalDateTime;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(MemberController.class)
class MemberControllerWebMvcTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private CurrentMemberArgumentResolver currentMemberArgumentResolver;

    private Member currentMember;

    @BeforeEach
    void setUp() throws Exception {
        currentMember = Member.createApprovedInitialAdminGoogleMember(
                "member-a@example.com",
                "Member A",
                "https://example.com/profile.png",
                "google-member-a",
                ReferralCode.of("ADMIN1"),
                LocalDateTime.of(2026, 9, 2, 10, 0)
        );

        given(currentMemberArgumentResolver.supportsParameter(any()))
                .willReturn(true);
        given(currentMemberArgumentResolver.resolveArgument(any(), any(), any(), any()))
                .willReturn(currentMember);
    }

    @Test
    @DisplayName("현재 회원이 전달되면 프로필과 추천 코드를 조회한다")
    void getMyProfile() throws Exception {
        mockMvc.perform(get("/api/members/me"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.email").value("member-a@example.com"))
                .andExpect(jsonPath("$.displayName").value("Member A"))
                .andExpect(jsonPath("$.profileImageUrl")
                        .value("https://example.com/profile.png"))
                .andExpect(jsonPath("$.role").value("ADMIN"))
                .andExpect(jsonPath("$.status").value("APPROVED"))
                .andExpect(jsonPath("$.referralCode").value("ADMIN1"));
    }
}
