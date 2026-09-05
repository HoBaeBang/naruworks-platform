package com.naruworks.api.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.BDDMockito.given;

import com.naruworks.core.service.MemberService;
import com.naruworks.domain.model.Member;
import com.naruworks.domain.type.AuthProvider;
import com.naruworks.domain.type.MemberRole;
import com.naruworks.domain.type.MemberStatus;
import com.naruworks.domain.value.ReferralCode;
import java.time.LocalDateTime;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.core.user.DefaultOAuth2User;
import org.springframework.security.oauth2.core.user.OAuth2User;
import org.springframework.security.web.access.intercept.RequestAuthorizationContext;

@ExtendWith(MockitoExtension.class)
class AdminAuthorizationManagerTest {

    @Mock
    private MemberService memberService;

    @Mock
    private Authentication authentication;

    @Test
    @DisplayName("승인된 ADMIN 회원만 관리자 API 접근 권한을 가진다")
    void authorize_adminMember() {
        OAuth2User oAuth2User = oAuth2User("admin-google-id");
        given(authentication.getPrincipal()).willReturn(oAuth2User);
        given(memberService.findApprovedGoogleMember("admin-google-id"))
                .willReturn(member(MemberRole.ADMIN));

        var result = authorizationManager().authorize(
                () -> authentication,
                requestContext()
        );

        assertThat(result.isGranted()).isTrue();
    }

    @Test
    @DisplayName("일반 회원은 관리자 API 접근 권한이 없다")
    void authorize_userMember() {
        OAuth2User oAuth2User = oAuth2User("user-google-id");
        given(authentication.getPrincipal()).willReturn(oAuth2User);
        given(memberService.findApprovedGoogleMember("user-google-id"))
                .willReturn(member(MemberRole.USER));

        var result = authorizationManager().authorize(
                () -> authentication,
                requestContext()
        );

        assertThat(result.isGranted()).isFalse();
    }

    @Test
    @DisplayName("OAuth2 인증 주체가 없으면 관리자 API 접근 권한이 없다")
    void authorize_nonOAuth2Principal() {
        given(authentication.getPrincipal()).willReturn("anonymous-user");

        var result = authorizationManager().authorize(
                () -> authentication,
                requestContext()
        );

        assertThat(result.isGranted()).isFalse();
    }

    private AdminAuthorizationManager authorizationManager() {
        return new AdminAuthorizationManager(memberService);
    }

    private RequestAuthorizationContext requestContext() {
        return new RequestAuthorizationContext(new MockHttpServletRequest());
    }

    private OAuth2User oAuth2User(String providerUserId) {
        return new DefaultOAuth2User(
                java.util.List.of(),
                Map.of("sub", providerUserId),
                "sub"
        );
    }

    private Member member(MemberRole role) {
        LocalDateTime now = LocalDateTime.of(2026, 9, 5, 12, 0);

        return Member.builder()
                .id(1L)
                .email("member@naruworks.com")
                .displayName("Naru Member")
                .provider(AuthProvider.GOOGLE)
                .providerUserId("provider-user-id")
                .role(role)
                .status(MemberStatus.APPROVED)
                .referralCode(ReferralCode.of("AB12CD"))
                .createdAt(now)
                .approvedAt(now)
                .lastLoginAt(now)
                .build();
    }
}
