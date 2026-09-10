package com.naruworks.infrastructure.persistence.calendar;

import static org.assertj.core.api.Assertions.assertThat;

import com.naruworks.domain.model.CalendarIntegration;
import com.naruworks.domain.model.Member;
import com.naruworks.domain.type.CalendarIntegrationProvider;
import com.naruworks.domain.value.ReferralCode;
import com.naruworks.infrastructure.InfrastructureTestApplication;
import com.naruworks.infrastructure.persistence.member.MemberEntity;
import com.naruworks.infrastructure.persistence.member.MemberJpaRepository;
import java.time.LocalDateTime;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.data.jpa.test.autoconfigure.DataJpaTest;
import org.springframework.context.annotation.Import;

@DataJpaTest(properties = {
        "spring.flyway.enabled=false",
        "spring.jpa.hibernate.ddl-auto=create-drop"
})
@Import(InfrastructureTestApplication.class)
class CalendarIntegrationJpaRepositoryTest {

    @Autowired
    private CalendarIntegrationJpaRepository calendarIntegrationJpaRepository;

    @Autowired
    private MemberJpaRepository memberJpaRepository;

    @Test
    @DisplayName("회원과 제공자 기준으로 외부 캘린더 연결 정보를 조회한다")
    void findByMemberIdAndProvider() {
        LocalDateTime now = LocalDateTime.of(2026, 9, 10, 10, 0);
        Long memberId = memberJpaRepository.save(MemberEntity.from(
                Member.createApprovedInitialAdminGoogleMember(
                        "member@example.com",
                        "Member",
                        null,
                        "google-member-id",
                        ReferralCode.of("AB12CD"),
                        now
                )
        )).getId();
        CalendarIntegration integration = CalendarIntegration.connectGoogle(
                memberId,
                "google-account-id",
                "calendar@example.com",
                "encrypted-refresh-token",
                now
        );
        calendarIntegrationJpaRepository.save(CalendarIntegrationEntity.from(integration));

        var found = calendarIntegrationJpaRepository.findByMemberIdAndProvider(
                memberId,
                CalendarIntegrationProvider.GOOGLE
        );

        assertThat(found).isPresent();
        assertThat(found.get().getProviderEmail()).isEqualTo("calendar@example.com");
        assertThat(found.get().getEncryptedRefreshToken()).isEqualTo("encrypted-refresh-token");
    }
}
