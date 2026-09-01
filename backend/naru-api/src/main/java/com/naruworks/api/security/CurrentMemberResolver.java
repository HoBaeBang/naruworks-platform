package com.naruworks.api.security;

import com.naruworks.core.exception.AuthorizationException;
import com.naruworks.core.service.MemberService;
import com.naruworks.domain.model.Member;
import lombok.RequiredArgsConstructor;
import org.springframework.security.oauth2.core.user.OAuth2User;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
public class CurrentMemberResolver {

    private final MemberService memberService;

    public Member getCurrentMember(OAuth2User oAuth2User) {
        if (oAuth2User == null) {
            throw new AuthorizationException("로그인이 필요합니다.");
        }

        String providerUserId = oAuth2User.getAttribute("sub");

        return memberService.findApprovedGoogleMember(providerUserId);
    }
}
