package com.naruworks.core.service;

import com.naruworks.core.exception.AuthorizationException;
import com.naruworks.core.port.MemberReader;
import com.naruworks.core.port.MemberWriter;
import com.naruworks.domain.model.Member;
import com.naruworks.domain.type.AuthProvider;
import com.naruworks.domain.type.MemberStatus;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.LocalDateTime;
import java.util.Optional;

@Service
@RequiredArgsConstructor
public class MemberService {
    private final MemberReader memberReader;
    private final MemberWriter memberWriter;
    private final Clock clock;

    @Transactional
    public Optional<Member> findAndUpdateExistingGoogleMember(String providerUserId) {
        LocalDateTime now = LocalDateTime.now(clock);

        return memberReader.findByProviderAndProviderUserId(
                        AuthProvider.GOOGLE,
                        providerUserId
                )
                .map(member -> memberWriter.save(member.updateLastLoginAt(now)));
    }

    @Transactional(readOnly = true)
    public Member findApprovedGoogleMember(String providerUserId) {
        return memberReader.findByProviderAndProviderUserId(
                        AuthProvider.GOOGLE,
                        providerUserId
                )
                .filter(member -> member.getStatus() == MemberStatus.APPROVED)
                .orElseThrow(() -> new AuthorizationException(
                        "승인된 회원만 서비스를 이용할 수 있습니다."
                ));
    }

    @Transactional(readOnly = true)
    public boolean hasNoMember() {
        return !memberReader.existsAnyMember();
    }
}
