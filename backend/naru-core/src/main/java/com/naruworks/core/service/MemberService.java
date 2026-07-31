package com.naruworks.core.service;

import com.naruworks.core.port.MemberReader;
import com.naruworks.core.port.MemberWriter;
import com.naruworks.domain.model.Member;
import com.naruworks.domain.type.AuthProvider;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.LocalDateTime;

@Service
@RequiredArgsConstructor
public class MemberService {
    private final MemberReader memberReader;
    private final MemberWriter memberWriter;
    private final Clock clock;


    public Member findOrCreateGoogleMember(
            String providerUserId,
            String email,
            String displayName,
            String profileImageUrl
    ) {
        LocalDateTime now = LocalDateTime.now(clock);

        return memberReader.findByProviderAndProviderUserId(
                        AuthProvider.GOOGLE,
                        providerUserId
                )
                .map(member -> memberWriter.save(member.updateLastLoginAt(now)))
                .orElseGet(() -> memberWriter.save(
                        Member.createPendingGoogleMember(
                                email,
                                displayName,
                                profileImageUrl,
                                providerUserId,
                                now
                        )
                ));
    }
}
