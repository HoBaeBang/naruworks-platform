package com.naruworks.infrastructure.persistence.calendar;

import static org.assertj.core.api.Assertions.assertThat;

import com.naruworks.domain.model.CalendarIntegration;
import com.naruworks.domain.model.CalendarIntegrationCalendar;
import com.naruworks.domain.model.Member;
import com.naruworks.domain.type.CalendarIntegrationProvider;
import com.naruworks.domain.value.ReferralCode;
import com.naruworks.infrastructure.InfrastructureTestApplication;
import com.naruworks.infrastructure.persistence.member.MemberEntity;
import com.naruworks.infrastructure.persistence.member.MemberJpaRepository;
import java.time.LocalDateTime;
import java.util.List;
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
    private CalendarIntegrationCalendarJpaRepository calendarIntegrationCalendarJpaRepository;

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

    @Test
    @DisplayName("외부 계정 연결별 Google 캘린더 선택 설정을 저장하고 이름순으로 조회한다")
    void findAllByCalendarIntegrationId() {
        LocalDateTime now = LocalDateTime.of(2026, 9, 10, 10, 0);
        Long memberId = memberJpaRepository.save(MemberEntity.from(
                Member.createApprovedInitialAdminGoogleMember(
                        "member@example.com", "Member", null, "google-member-id",
                        ReferralCode.of("AB12CD"), now
                )
        )).getId();
        Long integrationId = calendarIntegrationJpaRepository.save(CalendarIntegrationEntity.from(
                CalendarIntegration.connectGoogle(
                        memberId, "google-account-id", "calendar@example.com", "encrypted-refresh-token", now
                )
        )).getId();
        calendarIntegrationCalendarJpaRepository.saveAll(List.of(
                CalendarIntegrationCalendarEntity.from(CalendarIntegrationCalendar.create(
                        integrationId, "primary", "개인", "#20b977", true, now
                )),
                CalendarIntegrationCalendarEntity.from(CalendarIntegrationCalendar.create(
                        integrationId, "family", "가족", "#4285F4", false, now
                ))
        ));

        var found = calendarIntegrationCalendarJpaRepository
                .findAllByCalendarIntegrationIdOrderByCalendarNameAsc(integrationId);

        assertThat(found).extracting(CalendarIntegrationCalendarEntity::getProviderCalendarId)
                .containsExactly("family", "primary");
    }
}
