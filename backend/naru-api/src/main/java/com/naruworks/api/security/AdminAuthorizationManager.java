package com.naruworks.api.security;

import com.naruworks.core.exception.AuthorizationException;
import com.naruworks.core.service.MemberService;
import com.naruworks.domain.model.Member;
import com.naruworks.domain.type.MemberRole;
import lombok.RequiredArgsConstructor;
import org.springframework.security.authorization.AuthorizationDecision;
import org.springframework.security.authorization.AuthorizationManager;
import org.springframework.security.authorization.AuthorizationResult;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.core.user.OAuth2User;
import org.springframework.security.web.access.intercept.RequestAuthorizationContext;
import org.springframework.stereotype.Component;

import java.util.function.Supplier;

/**
 * Restricts the administrative API boundary to approved members with the ADMIN role.
 */
@Component
@RequiredArgsConstructor
public class AdminAuthorizationManager
        implements AuthorizationManager<RequestAuthorizationContext> {

    private final MemberService memberService;

    @Override
    public AuthorizationResult authorize(
            Supplier<? extends Authentication> authenticationSupplier,
            RequestAuthorizationContext context
    ) {
        Authentication authentication = authenticationSupplier.get();

        if (!(authentication != null && authentication.getPrincipal() instanceof OAuth2User oAuth2User)) {
            return new AuthorizationDecision(false);
        }

        try {
            String providerUserId = oAuth2User.getAttribute("sub");
            Member member = memberService.findApprovedGoogleMember(providerUserId);

            return new AuthorizationDecision(member.getRole() == MemberRole.ADMIN);
        } catch (AuthorizationException exception) {
            return new AuthorizationDecision(false);
        }
    }
}
