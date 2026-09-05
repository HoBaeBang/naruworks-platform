package com.naruworks.infrastructure.persistence.member;

import com.naruworks.core.port.MemberReader;
import com.naruworks.core.port.MemberWriter;
import com.naruworks.domain.model.Member;
import com.naruworks.domain.type.AuthProvider;
import com.naruworks.domain.value.ReferralCode;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Repository;

import java.util.Collection;
import java.util.List;
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
    public Optional<Member> findByReferralCode(ReferralCode referralCode) {
        return memberJpaRepository.findByReferralCode(referralCode.value())
                .map(MemberEntity::toDomain);
    }

    @Override
    public Optional<Member> findById(Long memberId) {
        return memberJpaRepository.findById(memberId)
                .map(MemberEntity::toDomain);
    }

    @Override
    public List<Member> findAllByIdIn(Collection<Long> memberIds) {
        return memberJpaRepository.findAllById(memberIds).stream()
                .map(MemberEntity::toDomain)
                .toList();
    }

    @Override
    public List<Member> findAllByOrderByCreatedAtDesc() {
        return memberJpaRepository.findAllByOrderByCreatedAtDesc().stream()
                .map(MemberEntity::toDomain)
                .toList();
    }

    @Override
    public boolean existsAnyMember() {
        return memberJpaRepository.count() > 0;
    }

    @Override
    public Member save(Member member) {
        return memberJpaRepository.save(MemberEntity.from(member)).toDomain();
    }
}
