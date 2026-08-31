package com.naruworks.infrastructure.persistence.member;

import com.naruworks.core.port.MemberTermsAgreementWriter;
import com.naruworks.domain.model.MemberTermsAgreement;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
@RequiredArgsConstructor
public class MemberTermsAgreementPersistenceAdapter implements MemberTermsAgreementWriter {

    private final MemberTermsAgreementJpaRepository memberTermsAgreementJpaRepository;

    @Override
    public List<MemberTermsAgreement> saveAll(List<MemberTermsAgreement> memberTermsAgreements) {
        return memberTermsAgreementJpaRepository.saveAll(
                        memberTermsAgreements.stream()
                                .map(MemberTermsAgreementEntity::from)
                                .toList()
                )
                .stream()
                .map(MemberTermsAgreementEntity::toDomain)
                .toList();
    }
}
