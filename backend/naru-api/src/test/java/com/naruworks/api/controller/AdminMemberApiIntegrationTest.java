package com.naruworks.api.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.oauth2Login;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.naruworks.domain.model.Member;
import com.naruworks.domain.type.MemberStatus;
import com.naruworks.domain.value.ReferralCode;
import com.naruworks.infrastructure.persistence.calendar.CalendarEventJpaRepository;
import com.naruworks.infrastructure.persistence.member.MemberEntity;
import com.naruworks.infrastructure.persistence.member.MemberJpaRepository;
import java.time.LocalDateTime;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(properties = {
        "spring.flyway.enabled=false",
        "spring.jpa.hibernate.ddl-auto=create-drop"
})
@AutoConfigureMockMvc
class AdminMemberApiIntegrationTest {

    private static final String ADMIN_PROVIDER_USER_ID = "google-admin-member-management";
    private static final String USER_PROVIDER_USER_ID = "google-user-member-management";

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private MemberJpaRepository memberJpaRepository;

    @Autowired
    private CalendarEventJpaRepository calendarEventJpaRepository;

    private Long adminMemberId;
    private Long userMemberId;

    @BeforeEach
    void setUp() {
        calendarEventJpaRepository.deleteAll();
        memberJpaRepository.deleteAll();

        Member admin = Member.createApprovedInitialAdminGoogleMember(
                "admin-member-management@naruworks.com",
                "Admin Member Management",
                null,
                ADMIN_PROVIDER_USER_ID,
                ReferralCode.of("ADMIN1"),
                LocalDateTime.of(2026, 9, 5, 11, 0)
        );
        adminMemberId = memberJpaRepository.save(MemberEntity.from(admin)).getId();

        Member user = Member.createApprovedInvitedGoogleMember(
                "user-member-management@naruworks.com",
                "User Member Management",
                null,
                USER_PROVIDER_USER_ID,
                adminMemberId,
                ReferralCode.of("USER01"),
                LocalDateTime.of(2026, 9, 5, 10, 0)
        );
        userMemberId = memberJpaRepository.save(MemberEntity.from(user)).getId();
    }

    @Test
    @DisplayName("관리자는 최신 가입 순서로 회원 목록을 조회할 수 있다")
    void getMembers_asAdmin() throws Exception {
        mockMvc.perform(get("/api/admin/members")
                        .with(oauth2Login().attributes(attributes -> attributes.put(
                                "sub",
                                ADMIN_PROVIDER_USER_ID
                        ))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value(adminMemberId))
                .andExpect(jsonPath("$[0].role").value("ADMIN"))
                .andExpect(jsonPath("$[1].id").value(userMemberId))
                .andExpect(jsonPath("$[1].status").value("APPROVED"))
                .andExpect(jsonPath("$[1].referrer.id").value(adminMemberId))
                .andExpect(jsonPath("$[1].referrer.displayName").value("Admin Member Management"))
                .andExpect(jsonPath("$[1].referrer.email").value("admin-member-management@naruworks.com"));
    }

    @Test
    @DisplayName("일반 회원은 관리자 회원 목록을 조회할 수 없다")
    void getMembers_asUser() throws Exception {
        mockMvc.perform(get("/api/admin/members")
                        .with(oauth2Login().attributes(attributes -> attributes.put(
                                "sub",
                                USER_PROVIDER_USER_ID
                        ))))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("관리자는 일반 회원의 이용 상태를 정지할 수 있다")
    void changeMemberStatus_asAdmin() throws Exception {
        mockMvc.perform(patch("/api/admin/members/{memberId}/status", userMemberId)
                        .contentType("application/json")
                        .content("{\"status\":\"SUSPENDED\"}")
                        .with(oauth2Login().attributes(attributes -> attributes.put(
                                "sub",
                                ADMIN_PROVIDER_USER_ID
                        ))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(userMemberId))
                .andExpect(jsonPath("$.status").value("SUSPENDED"))
                .andExpect(jsonPath("$.referrer.displayName").value("Admin Member Management"));

        MemberEntity member = memberJpaRepository.findById(userMemberId).orElseThrow();
        assertThat(member.getStatus()).isEqualTo(MemberStatus.SUSPENDED);
    }

    @Test
    @DisplayName("관리자 계정의 이용 상태는 변경할 수 없다")
    void changeMemberStatus_adminMember() throws Exception {
        mockMvc.perform(patch("/api/admin/members/{memberId}/status", adminMemberId)
                        .contentType("application/json")
                        .content("{\"status\":\"SUSPENDED\"}")
                        .with(oauth2Login().attributes(attributes -> attributes.put(
                                "sub",
                                ADMIN_PROVIDER_USER_ID
                        ))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("관리자 계정은 상태를 변경할 수 없습니다."));
    }
}
