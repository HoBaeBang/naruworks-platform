package com.naruworks.api.security;

import com.naruworks.core.port.IdentityProviderUserWriter;
import com.naruworks.core.port.InitialAdminPolicy;
import com.naruworks.core.service.MemberService;
import com.naruworks.domain.model.Member;
import com.naruworks.domain.type.MemberStatus;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
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

    private static final Logger log = LoggerFactory.getLogger(OAuth2LoginSuccessHandler.class);

    private final MemberService memberService;

    @Value("${naru.frontend-base-url}")
    private String frontendBaseUrl;

    private final InitialAdminPolicy initialAdminPolicy;

    private final IdentityProviderUserWriter identityProviderUserWriter;

    @Override
    public void onAuthenticationSuccess(
            HttpServletRequest request,
            HttpServletResponse response,
            Authentication authentication
    ) throws IOException {
        OAuth2User oAuth2User = (OAuth2User) authentication.getPrincipal();

        String providerUserId = oAuth2User.getAttribute("sub");
        String email = oAuth2User.getAttribute("email");
        boolean emailVerified = Boolean.TRUE.equals(oAuth2User.getAttribute("email_verified"));

        Optional<Member> member = memberService.findAndUpdateExistingGoogleMember(
                providerUserId
        );

        if (member.isPresent()) {
            response.sendRedirect(getRedirectUrl(member.get().getStatus()));
            return;
        }

        if (hasPendingReferralCode(request) || isInitialAdminCandidate(email, emailVerified)) {
            response.sendRedirect(frontendBaseUrl + "/join/terms");
            return;
        }

        new SecurityContextLogoutHandler().logout(request, response, authentication);
        deleteIdentityProviderUser(providerUserId);
        response.sendRedirect(frontendBaseUrl + "/join?error=invitation-required");
    }

    // 회원이 아닌 사람의 정보를 IdP에 남기지 않는다. 실패해도 로그인 거절 응답은 막지 않는다.
    private void deleteIdentityProviderUser(String providerUserId) {
        try {
            identityProviderUserWriter.deleteUser(providerUserId);
        } catch (RuntimeException exception) {
            log.warn("비회원의 IdP 사용자 삭제에 실패했다. sub={}", providerUserId, exception);
        }
    }

    private String getRedirectUrl(MemberStatus status) {
        return switch (status) {
            case PENDING -> frontendBaseUrl + "/join/pending";
            case APPROVED -> frontendBaseUrl + "/";
            case REJECTED -> frontendBaseUrl + "/join/rejected";
            case SUSPENDED -> frontendBaseUrl + "/join/suspended";
        };
    }

    private boolean hasPendingReferralCode(HttpServletRequest request) {
        HttpSession session = request.getSession(false);

        return session != null
                && session.getAttribute(AuthSessionAttribute.PENDING_REFERRAL_CODE) != null;
    }

    private boolean isInitialAdminCandidate(String email, boolean emailVerified) {
        return emailVerified
                && initialAdminPolicy.matches(email)
                && memberService.hasNoMember();
    }
}
