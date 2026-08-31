package com.naruworks.infrastructure.persistence.member;

import com.naruworks.domain.model.MemberTermsAgreement;
import com.naruworks.domain.type.TermsAgreementType;
import jakarta.persistence.*;
import lombok.Getter;

import java.time.LocalDateTime;

@Getter
@Entity
@Table(
        name = "member_terms_agreements",
        uniqueConstraints = {
                @UniqueConstraint(
                        name = "uk_member_terms_agreements_member_type_version",
                        columnNames = {
                                "member_id",
                                "agreement_type",
                                "agreement_version"
                        }
                )
        }
)
public class MemberTermsAgreementEntity {

    /** 약관 동의 이력 내부 식별자 */
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** 약관에 동의한 회원의 내부 식별자 */
    @Column(name = "member_id", nullable = false)
    private Long memberId;

    /** 동의한 약관 유형 */
    @Enumerated(EnumType.STRING)
    @Column(name = "agreement_type", nullable = false, length = 30)
    private TermsAgreementType agreementType;

    /** 동의한 약관 버전 */
    @Column(name = "agreement_version", nullable = false, length = 30)
    private String agreementVersion;

    /** 약관 동의 시각 */
    @Column(name = "agreed_at", nullable = false)
    private LocalDateTime agreedAt;

    public static MemberTermsAgreementEntity from(
            MemberTermsAgreement memberTermsAgreement
    ) {
        MemberTermsAgreementEntity entity = new MemberTermsAgreementEntity();
        entity.id = memberTermsAgreement.getId();
        entity.memberId = memberTermsAgreement.getMemberId();
        entity.agreementType = memberTermsAgreement.getAgreementType();
        entity.agreementVersion = memberTermsAgreement.getAgreementVersion();
        entity.agreedAt = memberTermsAgreement.getAgreedAt();

        return entity;
    }

    public MemberTermsAgreement toDomain() {
        return MemberTermsAgreement.builder()
                .id(id)
                .memberId(memberId)
                .agreementType(agreementType)
                .agreementVersion(agreementVersion)
                .agreedAt(agreedAt)
                .build();
    }
}
