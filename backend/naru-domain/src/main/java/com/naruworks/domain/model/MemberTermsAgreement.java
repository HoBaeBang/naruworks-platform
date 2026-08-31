package com.naruworks.domain.model;

import com.naruworks.domain.type.TermsAgreementType;
import lombok.Builder;
import lombok.Getter;

import java.time.LocalDateTime;

@Getter
@Builder
public class MemberTermsAgreement {

    private final Long id;
    private final Long memberId;
    private final TermsAgreementType agreementType;
    private final String agreementVersion;
    private final LocalDateTime agreedAt;

    public static MemberTermsAgreement agree(
            Long memberId,
            TermsAgreementType agreementType,
            LocalDateTime agreedAt
    ) {
        return MemberTermsAgreement.builder()
                .memberId(memberId)
                .agreementType(agreementType)
                .agreementVersion(agreementType.getVersion())
                .agreedAt(agreedAt)
                .build();
    }
}
