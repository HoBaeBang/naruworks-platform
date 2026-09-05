package com.naruworks.infrastructure.persistence.member;

import com.naruworks.domain.type.AuthProvider;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface MemberJpaRepository extends JpaRepository<MemberEntity, Long> {

    Optional<MemberEntity> findByProviderAndProviderUserId(
            AuthProvider provider,
            String providerUserId
    );

    Optional<MemberEntity> findByReferralCode(String referralCode);

    List<MemberEntity> findAllByOrderByCreatedAtDesc();
}
