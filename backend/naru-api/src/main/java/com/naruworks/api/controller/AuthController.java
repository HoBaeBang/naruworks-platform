package com.naruworks.api.controller;

import com.naruworks.api.dto.request.MemberRegistrationRequest;
import com.naruworks.api.dto.response.MemberRegistrationResponse;
import com.naruworks.api.security.AuthSessionAttribute;
import com.naruworks.core.service.InvitationService;
import com.naruworks.core.service.MemberRegistrationService;
import com.naruworks.domain.model.Member;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.core.user.OAuth2User;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;

@Controller
@RequiredArgsConstructor
@RequestMapping("/api/auth")
public class AuthController {

    private final InvitationService invitationService;
    private final MemberRegistrationService memberRegistrationService;

    @Value("${naru.frontend-base-url}")
    private String frontendBaseUrl;

    @GetMapping("/login")
    public void login(HttpServletResponse response) throws IOException {
        response.sendRedirect("/oauth2/authorization/google");
    }

    @GetMapping("/google")
    public void googleLogin(
            @RequestParam("ref") String rawReferralCode,
            HttpServletRequest request,
            HttpServletResponse response
    ) throws IOException {
        try {
            String referralCode = invitationService.validateReferralCode(rawReferralCode).value();

            request.getSession(true)
                    .setAttribute(AuthSessionAttribute.PENDING_REFERRAL_CODE, referralCode);

            response.sendRedirect("/oauth2/authorization/google");
        } catch (IllegalArgumentException exception) {
            response.sendRedirect(frontendBaseUrl + "/join?error=invalid-referral-code");
        }
    }

    @PostMapping("/registrations")
    @ResponseBody
    @ResponseStatus(HttpStatus.CREATED)
    public MemberRegistrationResponse register(
            @Valid @RequestBody MemberRegistrationRequest memberRegistrationRequest,
            @AuthenticationPrincipal OAuth2User oAuth2User,
            HttpServletRequest request
    ) {
        if (oAuth2User == null) {
            throw new IllegalArgumentException("Google 로그인 정보가 없습니다.");
        }

        HttpSession session = request.getSession(false);
        String pendingReferralCode = session == null
                ? null
                : (String) session.getAttribute(
                AuthSessionAttribute.PENDING_REFERRAL_CODE
        );

        String providerUserId = oAuth2User.getAttribute("sub");
        String email = oAuth2User.getAttribute("email");
        String displayName = oAuth2User.getAttribute("name");
        String profileImageUrl = oAuth2User.getAttribute("picture");

        Member member = memberRegistrationService.registerGoogleMember(
                providerUserId,
                email,
                displayName,
                profileImageUrl,
                pendingReferralCode
        );

        if (session != null) {
            session.removeAttribute(
                    AuthSessionAttribute.PENDING_REFERRAL_CODE
            );
        }

        return MemberRegistrationResponse.from(member);
    }
}
