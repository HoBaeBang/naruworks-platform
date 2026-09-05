package com.naruworks.core.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.mockito.BDDMockito.then;

import com.naruworks.core.exception.NotFoundException;
import com.naruworks.core.port.MemberReader;
import com.naruworks.core.port.MemberWriter;
import com.naruworks.domain.model.Member;
import com.naruworks.domain.type.AuthProvider;
import com.naruworks.domain.type.MemberRole;
import com.naruworks.domain.type.MemberStatus;
import com.naruworks.domain.value.ReferralCode;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class MemberAdministrationServiceTest {

    @Mock
    private MemberReader memberReader;

    @Mock
    private MemberWriter memberWriter;

    @Test
    @DisplayName("회원 목록을 최신 가입 순서로 조회한다")
    void getMembers() {
        List<Member> members = List.of(member(2L, MemberStatus.APPROVED), member(1L, MemberStatus.APPROVED));
        given(memberReader.findAllByOrderByCreatedAtDesc()).willReturn(members);

        List<Member> result = service().getMembers();

        assertThat(result).containsExactlyElementsOf(members);
    }

    @Test
    @DisplayName("회원 이용 상태를 SUSPENDED로 변경해 저장한다")
    void changeMemberStatus() {
        Member targetMember = member(1L, MemberStatus.APPROVED);
        given(memberReader.findById(1L)).willReturn(Optional.of(targetMember));
        given(memberWriter.save(any(Member.class))).willAnswer(invocation -> invocation.getArgument(0));

        Member result = service().changeMemberStatus(1L, MemberStatus.SUSPENDED);

        ArgumentCaptor<Member> savedMember = ArgumentCaptor.forClass(Member.class);
        then(memberWriter).should().save(savedMember.capture());
        assertThat(savedMember.getValue().getStatus()).isEqualTo(MemberStatus.SUSPENDED);
        assertThat(result.getStatus()).isEqualTo(MemberStatus.SUSPENDED);
    }

    @Test
    @DisplayName("존재하지 않는 회원의 상태는 변경할 수 없다")
    void changeMemberStatus_memberNotFound() {
        given(memberReader.findById(999L)).willReturn(Optional.empty());

        assertThatThrownBy(() -> service().changeMemberStatus(999L, MemberStatus.SUSPENDED))
                .isInstanceOf(NotFoundException.class)
                .hasMessage("회원을 찾을 수 없습니다.");

        then(memberWriter).shouldHaveNoInteractions();
    }

    private MemberAdministrationService service() {
        return new MemberAdministrationService(memberReader, memberWriter);
    }

    private Member member(Long id, MemberStatus status) {
        LocalDateTime now = LocalDateTime.of(2026, 9, 5, 12, 0);

        return Member.builder()
                .id(id)
                .email("member" + id + "@naruworks.com")
                .displayName("Naru Member " + id)
                .provider(AuthProvider.GOOGLE)
                .providerUserId("provider-user-id-" + id)
                .role(MemberRole.USER)
                .status(status)
                .referralCode(ReferralCode.of(id == 1L ? "AB12CD" : "EF34GH"))
                .createdAt(now)
                .approvedAt(now)
                .lastLoginAt(now)
                .build();
    }
}
