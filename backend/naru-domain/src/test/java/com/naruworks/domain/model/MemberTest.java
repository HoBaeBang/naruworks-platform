package com.naruworks.domain.model;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.naruworks.domain.type.AuthProvider;
import com.naruworks.domain.type.MemberRole;
import com.naruworks.domain.type.MemberStatus;
import com.naruworks.domain.value.ReferralCode;
import java.time.LocalDateTime;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class MemberTest {

    @Test
    @DisplayName("일반 회원은 이용 상태를 SUSPENDED로 변경할 수 있다")
    void changeOperationalStatus_toSuspended() {
        Member changed = userMember(MemberStatus.APPROVED)
                .changeOperationalStatus(MemberStatus.SUSPENDED);

        assertEquals(MemberStatus.SUSPENDED, changed.getStatus());
    }

    @Test
    @DisplayName("일반 회원은 정지 상태에서 APPROVED로 복구할 수 있다")
    void changeOperationalStatus_toApproved() {
        Member changed = userMember(MemberStatus.SUSPENDED)
                .changeOperationalStatus(MemberStatus.APPROVED);

        assertEquals(MemberStatus.APPROVED, changed.getStatus());
    }

    @Test
    @DisplayName("관리자 계정의 상태는 변경할 수 없다")
    void changeOperationalStatus_adminMember() {
        IllegalArgumentException exception = assertThrows(
                IllegalArgumentException.class,
                () -> adminMember().changeOperationalStatus(MemberStatus.SUSPENDED)
        );

        assertEquals("관리자 계정은 상태를 변경할 수 없습니다.", exception.getMessage());
    }

    @Test
    @DisplayName("운영 상태는 APPROVED 또는 SUSPENDED만 허용한다")
    void changeOperationalStatus_invalidStatus() {
        IllegalArgumentException exception = assertThrows(
                IllegalArgumentException.class,
                () -> userMember(MemberStatus.APPROVED)
                        .changeOperationalStatus(MemberStatus.PENDING)
        );

        assertEquals("회원 상태는 APPROVED 또는 SUSPENDED로만 변경할 수 있습니다.", exception.getMessage());
    }

    private Member userMember(MemberStatus status) {
        return member(MemberRole.USER, status);
    }

    private Member adminMember() {
        return member(MemberRole.ADMIN, MemberStatus.APPROVED);
    }

    private Member member(MemberRole role, MemberStatus status) {
        LocalDateTime now = LocalDateTime.of(2026, 9, 5, 12, 0);

        return Member.builder()
                .id(1L)
                .email("member@naruworks.com")
                .displayName("Naru Member")
                .provider(AuthProvider.GOOGLE)
                .providerUserId("provider-user-id")
                .role(role)
                .status(status)
                .referralCode(ReferralCode.of("AB12CD"))
                .createdAt(now)
                .approvedAt(now)
                .lastLoginAt(now)
                .build();
    }
}
