package com.naruworks.api.controller;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.oauth2Login;

import com.naruworks.domain.model.Member;
import com.naruworks.domain.value.ReferralCode;
import com.naruworks.infrastructure.persistence.member.MemberEntity;
import com.naruworks.infrastructure.persistence.member.MemberJpaRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;

@SpringBootTest(properties = {
        "spring.flyway.enabled=false",
        "spring.jpa.hibernate.ddl-auto=create-drop"
})
@AutoConfigureMockMvc
@Transactional
class MemberApiIntegrationTest {

    private static final String PROVIDER_USER_ID = "google-profile-member-a";

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private MemberJpaRepository memberJpaRepository;

    private Long memberId;

    @BeforeEach
    void setUp() {
        Member member = Member.createApprovedInitialAdminGoogleMember(
                "profile-member-a@example.com",
                "Profile Member A",
                "https://example.com/profile.png",
                PROVIDER_USER_ID,
                ReferralCode.of("ADMIN1"),
                LocalDateTime.of(2026, 9, 3, 10, 0)
        );

        memberId = memberJpaRepository.save(MemberEntity.from(member)).getId();
    }

    @Test
    @DisplayName("승인된 Google 회원은 실제 인증 흐름으로 자신의 프로필을 조회한다")
    void getMyProfile() throws Exception {
        mockMvc.perform(get("/api/members/me")
                        .with(oauth2Login()
                                .attributes(attributes -> attributes.put(
                                        "sub",
                                        PROVIDER_USER_ID
                                ))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(memberId))
                .andExpect(jsonPath("$.email").value("profile-member-a@example.com"))
                .andExpect(jsonPath("$.displayName").value("Profile Member A"))
                .andExpect(jsonPath("$.role").value("ADMIN"))
                .andExpect(jsonPath("$.status").value("APPROVED"))
                .andExpect(jsonPath("$.referralCode").value("ADMIN1"));
    }

    @Test
    @DisplayName("인증하지 않은 사용자는 내 프로필을 조회할 수 없다")
    void getMyProfileWithoutAuthentication() throws Exception {
        mockMvc.perform(get("/api/members/me"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("로그아웃하면 현재 HTTP 세션을 종료한다")
    void logout() throws Exception {
        MockHttpSession session = new MockHttpSession();

        mockMvc.perform(post("/api/auth/logout")
                        .session(session))
                .andExpect(status().isNoContent());

        assertThat(session.isInvalid()).isTrue();
    }
}
