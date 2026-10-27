package com.naruworks.api.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.lenient;

import com.naruworks.core.port.InitialAdminPolicy;
import com.naruworks.core.service.MemberService;
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

    private OAuth2LoginSuccessHandler handler;

    @BeforeEach
    void setUp() {
        handler = new OAuth2LoginSuccessHandler(memberService, initialAdminPolicy);
        ReflectionTestUtils.setField(handler, "frontendBaseUrl", FRONTEND_BASE_URL);

        given(memberService.findAndUpdateExistingGoogleMember("idp-sub"))
                .willReturn(Optional.empty());
        lenient().when(initialAdminPolicy.matches(ADMIN_EMAIL)).thenReturn(true);
        lenient().when(memberService.hasNoMember()).thenReturn(true);
    }

    @Test
    @DisplayName("이메일이 검증된 초대 없는 최초 관리자 후보는 약관 동의로 이동한다")
    void verifiedInitialAdminCandidateGoesToTerms() throws Exception {
        MockHttpServletResponse response = login(true);

        assertThat(response.getRedirectedUrl()).isEqualTo(FRONTEND_BASE_URL + "/join/terms");
    }

    @Test
    @DisplayName("이메일이 검증되지 않았으면 최초 관리자 이메일이어도 가입할 수 없다")
    void unverifiedInitialAdminCandidateIsRejected() throws Exception {
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
