package com.naruworks.infrastructure.persistence.member;

import static org.assertj.core.api.Assertions.assertThat;

import com.naruworks.domain.model.Member;
import com.naruworks.domain.type.AuthProvider;
import com.naruworks.infrastructure.InfrastructureTestApplication;
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
class MemberJpaRepositoryTest {

    @Autowired
    private MemberJpaRepository memberJpaRepository;

    @Test
    @DisplayName("provider와 providerUserId로 회원을 조회한다")
    void findByProviderAndProviderUserId() {
        LocalDateTime now = LocalDateTime.of(2026, 7, 29, 10, 0);

        Member member = Member.createPendingGoogleMember(
                "naru@example.com",
                "Naru User",
                "https://example.com/profile.png",
                "google-user-id",
                now
        );

        memberJpaRepository.save(MemberEntity.from(member));

        var found = memberJpaRepository.findByProviderAndProviderUserId(
                AuthProvider.GOOGLE,
                "google-user-id"
        );

        assertThat(found).isPresent();
        assertThat(found.get().getEmail()).isEqualTo("naru@example.com");
        assertThat(found.get().getStatus().name()).isEqualTo("PENDING");
    }
}
