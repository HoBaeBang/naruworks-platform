package com.naruworks.core.service;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.BDDMockito.then;
import static org.mockito.Mockito.doThrow;

import com.naruworks.core.port.IdentityProviderUserWriter;
import com.naruworks.domain.model.Member;
import com.naruworks.domain.type.AuthProvider;
import com.naruworks.domain.type.MemberRole;
import com.naruworks.domain.type.MemberStatus;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class MemberRoleSynchronizerTest {

    @Mock
    private IdentityProviderUserWriter identityProviderUserWriter;

    @Test
    @DisplayName("승인된 회원은 역할을 부여하고, 정지된 회원은 제거한다")
    void syncByStatus() {
        MemberRoleSynchronizer synchronizer = new MemberRoleSynchronizer(identityProviderUserWriter);

        synchronizer.sync(member(MemberStatus.APPROVED));
        synchronizer.sync(member(MemberStatus.SUSPENDED));

        then(identityProviderUserWriter).should().setMemberRole("sub-1", true);
        then(identityProviderUserWriter).should().setMemberRole("sub-1", false);
    }

    @Test
    @DisplayName("IdP 호출이 실패해도 예외를 밖으로 던지지 않는다")
    void syncFailureIsIsolated() {
        doThrow(new IllegalStateException("down")).when(identityProviderUserWriter).setMemberRole("sub-1", true);

        assertThatCode(() -> new MemberRoleSynchronizer(identityProviderUserWriter)
                .sync(member(MemberStatus.APPROVED))).doesNotThrowAnyException();
    }

    @Test
    @DisplayName("syncOrThrow는 IdP 호출 실패를 그대로 던진다")
    void syncOrThrowPropagates() {
        doThrow(new IllegalStateException("down")).when(identityProviderUserWriter).setMemberRole("sub-1", false);

        assertThatThrownBy(() -> new MemberRoleSynchronizer(identityProviderUserWriter)
                .syncOrThrow(member(MemberStatus.SUSPENDED))).isInstanceOf(IllegalStateException.class);
    }

    private static Member member(MemberStatus status) {
        return Member.builder()
                .id(1L)
                .email("a@example.com")
                .provider(AuthProvider.GOOGLE)
                .providerUserId("sub-1")
                .role(MemberRole.USER)
                .status(status)
                .build();
    }
}
