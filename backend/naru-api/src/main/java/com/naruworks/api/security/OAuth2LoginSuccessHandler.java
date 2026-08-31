package com.naruworks.api.security;

import com.naruworks.core.port.InitialAdminPolicy;
import com.naruworks.core.service.MemberService;
import com.naruworks.domain.model.Member;
import com.naruworks.domain.type.MemberStatus;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.core.user.OAuth2User;
import org.springframework.security.web.authentication.AuthenticationSuccessHandler;
import org.springframework.security.web.authentication.logout.SecurityContextLogoutHandler;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.util.Optional;

@Component
@RequiredArgsConstructor
public class OAuth2LoginSuccessHandler implements AuthenticationSuccessHandler {

    private final MemberService memberService;

    @Value("${naru.frontend-base-url}")
    private String frontendBaseUrl;

    private final InitialAdminPolicy initialAdminPolicy;

    @Override
    public void onAuthenticationSuccess(
            HttpServletRequest request,
            HttpServletResponse response,
            Authentication authentication
    ) throws IOException {
        OAuth2User oAuth2User = (OAuth2User) authentication.getPrincipal();

        String providerUserId = oAuth2User.getAttribute("sub");
        String email = oAuth2User.getAttribute("email");

        Optional<Member> member = memberService.findAndUpdateExistingGoogleMember(
                providerUserId
        );

        if (member.isPresent()) {
            response.sendRedirect(getRedirectUrl(member.get().getStatus()));
            return;
        }

        if (hasPendingReferralCode(request) || isInitialAdminCandidate(email)) {
            response.sendRedirect(frontendBaseUrl + "/join/terms");
            return;
        }

        new SecurityContextLogoutHandler().logout(request, response, authentication);
        response.sendRedirect(frontendBaseUrl + "/join?error=invitation-required");
    }

    private String getRedirectUrl(MemberStatus status) {
        return switch (status) {
            case PENDING -> frontendBaseUrl + "/join/pending";
            case APPROVED -> frontendBaseUrl + "/calendar";
            case REJECTED -> frontendBaseUrl + "/join/rejected";
            case SUSPENDED -> frontendBaseUrl + "/join/suspended";
        };
    }

    private boolean hasPendingReferralCode(HttpServletRequest request) {
        HttpSession session = request.getSession(false);

        return session != null
                && session.getAttribute(AuthSessionAttribute.PENDING_REFERRAL_CODE) != null;
    }

    private boolean isInitialAdminCandidate(String email) {
        return initialAdminPolicy.matches(email)
                && memberService.hasNoMember();
    }
}
