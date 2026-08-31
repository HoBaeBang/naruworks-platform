package com.naruworks.core.service;

import com.naruworks.core.port.MemberReader;
import com.naruworks.domain.model.Member;
import com.naruworks.domain.type.MemberStatus;
import com.naruworks.domain.value.ReferralCode;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class InvitationService {

    private final MemberReader memberReader;

    @Transactional(readOnly = true)
    public ReferralCode validateReferralCode(String rawReferralCode) {
        ReferralCode referralCode = ReferralCode.of(rawReferralCode);

        Member referrer = memberReader.findByReferralCode(referralCode)
                .orElseThrow(() -> new IllegalArgumentException("유효하지 않은 추천 코드입니다."));

        if (referrer.getStatus() != MemberStatus.APPROVED) {
            throw new IllegalArgumentException("현재 사용할 수 없는 추천 코드입니다.");
        }

        return referralCode;
    }

    @Transactional(readOnly = true)
    public Member findApprovedReferrer(ReferralCode referralCode) {
        Member referrer = memberReader.findByReferralCode(referralCode)
                .orElseThrow(() -> new IllegalArgumentException("유효하지 않은 추천 코드입니다."));

        if (referrer.getStatus() != MemberStatus.APPROVED) {
            throw new IllegalArgumentException("현재 사용할 수 없는 추천 코드입니다.");
        }

        return referrer;
    }
}
