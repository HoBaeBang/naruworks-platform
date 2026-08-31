package com.naruworks.core.service;

import com.naruworks.core.port.InitialAdminPolicy;
import com.naruworks.core.port.MemberReader;
import com.naruworks.core.port.MemberTermsAgreementWriter;
import com.naruworks.core.port.MemberWriter;
import com.naruworks.domain.model.Member;
import com.naruworks.domain.model.MemberTermsAgreement;
import com.naruworks.domain.type.AuthProvider;
import com.naruworks.domain.type.TermsAgreementType;
import com.naruworks.domain.value.ReferralCode;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.LocalDateTime;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class MemberRegistrationService {

    private static final char[] REFERRAL_CODE_CHARACTERS =
            "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".toCharArray();

    private static final SecureRandom SECURE_RANDOM = new SecureRandom();

    private final MemberReader memberReader;
    private final MemberWriter memberWriter;
    private final MemberTermsAgreementWriter memberTermsAgreementWriter;
    private final InvitationService invitationService;
    private final InitialAdminPolicy initialAdminPolicy;
    private final Clock clock;

    @Transactional
    public Member registerGoogleMember(
            String providerUserId,
            String email,
            String displayName,
            String profileImageUrl,
            String pendingReferralCode
    ) {
        validateNotRegistered(providerUserId);

        LocalDateTime now = LocalDateTime.now(clock);
        Member savedMember = createMember(
                providerUserId,
                email,
                displayName,
                profileImageUrl,
                pendingReferralCode,
                now
        );

        saveTermsAgreements(savedMember.getId(), now);

        return savedMember;
    }

    private void validateNotRegistered(String providerUserId) {
        boolean alreadyRegistered = memberReader.findByProviderAndProviderUserId(
                AuthProvider.GOOGLE,
                providerUserId
        ).isPresent();

        if (alreadyRegistered) {
            throw new IllegalArgumentException("이미 가입된 회원입니다.");
        }
    }

    private Member createMember(
            String providerUserId,
            String email,
            String displayName,
            String profileImageUrl,
            String pendingReferralCode,
            LocalDateTime now
    ) {
        if (isInitialAdmin(email)) {
            return memberWriter.save(
                    Member.createApprovedInitialAdminGoogleMember(
                            email,
                            displayName,
                            profileImageUrl,
                            providerUserId,
                            issueReferralCode(),
                            now
                    )
            );
        }

        if (pendingReferralCode == null || pendingReferralCode.isBlank()) {
            throw new IllegalArgumentException("초대 정보가 없습니다.");
        }

        Member referrer = invitationService.findApprovedReferrer(
                ReferralCode.of(pendingReferralCode)
        );

        return memberWriter.save(
                Member.createApprovedInvitedGoogleMember(
                        email,
                        displayName,
                        profileImageUrl,
                        providerUserId,
                        referrer.getId(),
                        issueReferralCode(),
                        now
                )
        );
    }

    private boolean isInitialAdmin(String email) {
        return initialAdminPolicy.matches(email)
                && !memberReader.existsAnyMember();
    }

    private void saveTermsAgreements(Long memberId, LocalDateTime now) {
        memberTermsAgreementWriter.saveAll(List.of(
                MemberTermsAgreement.agree(
                        memberId,
                        TermsAgreementType.TERMS_OF_SERVICE,
                        now
                ),
                MemberTermsAgreement.agree(
                        memberId,
                        TermsAgreementType.PRIVACY_POLICY,
                        now
                )
        ));
    }

    private ReferralCode issueReferralCode() {
        for (int attempt = 0; attempt < 20; attempt++) {
            StringBuilder value = new StringBuilder(6);

            for (int index = 0; index < 6; index++) {
                value.append(
                        REFERRAL_CODE_CHARACTERS[
                                SECURE_RANDOM.nextInt(
                                        REFERRAL_CODE_CHARACTERS.length
                                )
                                ]
                );
            }

            ReferralCode referralCode = ReferralCode.of(value.toString());

            if (memberReader.findByReferralCode(referralCode).isEmpty()) {
                return referralCode;
            }
        }

        throw new IllegalStateException("추천 코드 발급에 실패했습니다.");
    }
}
