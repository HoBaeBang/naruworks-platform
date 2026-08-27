package com.naruworks.api.security;

import com.naruworks.core.service.MemberService;
import com.naruworks.domain.model.Member;
import com.naruworks.domain.type.MemberStatus;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.core.user.OAuth2User;
import org.springframework.security.web.authentication.AuthenticationSuccessHandler;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.util.Optional;

@Component
@RequiredArgsConstructor
public class OAuth2LoginSuccessHandler implements AuthenticationSuccessHandler {

    private final MemberService memberService;

    @Value("${naru.frontend-base-url}")
    private String frontendBaseUrl;

    @Override
    public void onAuthenticationSuccess(
            HttpServletRequest request,
            HttpServletResponse response,
            Authentication authentication) throws IOException {
        OAuth2User oAuth2User = (OAuth2User) authentication.getPrincipal();

        String providerUserId = oAuth2User.getAttribute("sub");

        Optional<Member> member = memberService.findAndUpdateExistingGoogleMember(providerUserId);

        if (member.isPresent()) {
            response.sendRedirect(getRedirectUrl(member.get().getStatus()));
            return;
        }

        response.sendRedirect(frontendBaseUrl + "/join?error=invitation-required");    }

    private String getRedirectUrl(MemberStatus status) {
        return switch (status) {
            case PENDING -> frontendBaseUrl + "/join/pending";
            case APPROVED -> frontendBaseUrl + "/calendar";
            case REJECTED -> frontendBaseUrl + "/join/rejected";
            case SUSPENDED -> frontendBaseUrl + "/join/suspended";
        };
    }
}
