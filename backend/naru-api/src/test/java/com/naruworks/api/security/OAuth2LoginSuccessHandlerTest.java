package com.naruworks.api.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.lenient;

import com.naruworks.core.port.IdentityProviderUserWriter;
import com.naruworks.core.port.InitialAdminPolicy;
import com.naruworks.core.service.MemberRoleSynchronizer;
import com.naruworks.core.service.MemberService;
import com.naruworks.domain.model.Member;
import com.naruworks.domain.type.AuthProvider;
import com.naruworks.domain.type.MemberRole;
import com.naruworks.domain.type.MemberStatus;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.AuthorityUtils;
import org.springframework.security.oauth2.core.user.DefaultOAuth2User;
import org.springframework.test.util.ReflectionTestUtils;

@ExtendWith(MockitoExtension.class)
class OAuth2LoginSuccessHandlerTest {

    private static final String FRONTEND_BASE_URL = "https://app.naruworks.com";
    private static final String ADMIN_EMAIL = "admin@example.com";

    @Mock
    private MemberService memberService;

    @Mock
    private InitialAdminPolicy initialAdminPolicy;

    @Mock
    private IdentityProviderUserWriter identityProviderUserWriter;

    @Mock
    private MemberRoleSynchronizer memberRoleSynchronizer;

    private OAuth2LoginSuccessHandler handler;

    @BeforeEach
    void setUp() {
        handler = new OAuth2LoginSuccessHandler(
                memberService, initialAdminPolicy, identityProviderUserWriter, memberRoleSynchronizer);
        ReflectionTestUtils.setField(handler, "frontendBaseUrl", FRONTEND_BASE_URL);

        lenient().when(memberService.findAndUpdateExistingGoogleMember("idp-sub"))
                .thenReturn(Optional.empty());
        lenient().when(initialAdminPolicy.matches(ADMIN_EMAIL)).thenReturn(true);
        lenient().when(memberService.hasNoMember()).thenReturn(true);
    }

    @Test
    @DisplayName("이메일이 검증된 초대 없는 최초 관리자 후보는 약관 동의로 이동한다")
    void verifiedInitialAdminCandidateGoesToTerms() throws Exception {
        MockHttpServletResponse response = login(true);

        assertThat(response.getRedirectedUrl()).isEqualTo(FRONTEND_BASE_URL + "/join/terms");
        verify(identityProviderUserWriter, never()).deleteUser("idp-sub");
    }

    @Test
    @DisplayName("기존 회원이 로그인하면 IdP 회원 역할을 맞추고 삭제하지 않는다")
    void existingMemberRoleIsSynchronized() throws Exception {
        Member member = Member.builder()
                .id(1L)
                .email(ADMIN_EMAIL)
                .provider(AuthProvider.GOOGLE)
                .providerUserId("idp-sub")
                .role(MemberRole.USER)
                .status(MemberStatus.APPROVED)
                .build();
        given(memberService.findAndUpdateExistingGoogleMember("idp-sub")).willReturn(Optional.of(member));

        MockHttpServletResponse response = login(true);

        assertThat(response.getRedirectedUrl()).isEqualTo(FRONTEND_BASE_URL + "/");
        verify(memberRoleSynchronizer).sync(member);
        verify(identityProviderUserWriter, never()).deleteUser("idp-sub");
    }

    @Test
    @DisplayName("이메일이 검증되지 않았으면 최초 관리자 이메일이어도 가입할 수 없다")
    void unverifiedInitialAdminCandidateIsRejected() throws Exception {
        MockHttpServletResponse response = login(false);

        assertThat(response.getRedirectedUrl())
                .isEqualTo(FRONTEND_BASE_URL + "/join?error=invitation-required");
        verify(identityProviderUserWriter).deleteUser("idp-sub");
    }

    @Test
    @DisplayName("IdP 사용자 삭제가 실패해도 로그인 거절 응답은 나간다")
    void rejectionIsNotBlockedByCleanupFailure() throws Exception {
        org.mockito.Mockito.doThrow(new IllegalStateException("down"))
                .when(identityProviderUserWriter).deleteUser("idp-sub");

        MockHttpServletResponse response = login(false);

        assertThat(response.getRedirectedUrl())
                .isEqualTo(FRONTEND_BASE_URL + "/join?error=invitation-required");
    }

    private MockHttpServletResponse login(boolean emailVerified) throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest();
        MockHttpServletResponse response = new MockHttpServletResponse();
        Authentication authentication = new TestingAuthenticationToken(
                new DefaultOAuth2User(
                        AuthorityUtils.NO_AUTHORITIES,
                        Map.of("sub", "idp-sub", "email", ADMIN_EMAIL, "email_verified", emailVerified),
                        "sub"
                ),
                null
        );

        handler.onAuthenticationSuccess(request, response, authentication);

        return response;
    }
}
