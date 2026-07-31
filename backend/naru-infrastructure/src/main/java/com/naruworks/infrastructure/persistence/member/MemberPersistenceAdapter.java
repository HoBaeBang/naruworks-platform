package com.naruworks.infrastructure.persistence.member;

import com.naruworks.core.port.MemberReader;
import com.naruworks.core.port.MemberWriter;
import com.naruworks.domain.model.Member;
import com.naruworks.domain.type.AuthProvider;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
@RequiredArgsConstructor
public class MemberPersistenceAdapter implements MemberReader, MemberWriter {

    private final MemberJpaRepository memberJpaRepository;

    @Override
    public Optional<Member> findByProviderAndProviderUserId(
            AuthProvider provider,
            String providerUserId
    ) {
        return memberJpaRepository.findByProviderAndProviderUserId(provider, providerUserId)
                .map(MemberEntity::toDomain);
    }

    @Override
    public Member save(Member member) {
        return memberJpaRepository.save(MemberEntity.from(member)).toDomain();
    }
}
