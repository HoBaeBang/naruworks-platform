package com.naruworks.core.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.mockito.BDDMockito.then;

import com.naruworks.core.exception.AuthorizationException;
import com.naruworks.core.port.CalendarInvitationLinkReader;
import com.naruworks.core.port.CalendarInvitationLinkWriter;
import com.naruworks.core.port.CalendarMemberReader;
import com.naruworks.core.port.CalendarMemberWriter;
import com.naruworks.core.port.CalendarReader;
import com.naruworks.core.port.MemberReader;
import com.naruworks.domain.model.Calendar;
import com.naruworks.domain.model.CalendarInvitationLink;
import com.naruworks.domain.model.CalendarMember;
import com.naruworks.domain.model.Member;
import com.naruworks.domain.type.CalendarMemberRole;
import com.naruworks.domain.type.CalendarType;
import com.naruworks.domain.type.MemberStatus;
import java.time.LocalDateTime;
import java.util.Optional;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class CalendarInvitationLinkServiceTest {

    @Mock private CalendarReader calendarReader;
    @Mock private CalendarMemberReader calendarMemberReader;
    @Mock private CalendarMemberWriter calendarMemberWriter;
    @Mock private CalendarInvitationLinkReader calendarInvitationLinkReader;
    @Mock private CalendarInvitationLinkWriter calendarInvitationLinkWriter;
    @Mock private MemberReader memberReader;

    @Test
    @DisplayName("OWNER가 발급한 초대 링크는 7일 뒤 만료되고 이전 링크를 폐기한다")
    void create_ownerCreatesSevenDayLink() {
        given(calendarReader.findById(10L)).willReturn(Optional.of(sharedCalendar()));
        given(calendarMemberReader.findByCalendarIdAndMemberId(10L, 1L))
                .willReturn(Optional.of(ownerMembership()));
        given(calendarInvitationLinkWriter.save(any())).willAnswer(invocation -> invocation.getArgument(0));

        LocalDateTime before = LocalDateTime.now();
        var created = service().create(1L, 10L, CalendarMemberRole.EDITOR);

        ArgumentCaptor<CalendarInvitationLink> link = ArgumentCaptor.forClass(CalendarInvitationLink.class);
        then(calendarInvitationLinkWriter).should().revokeActiveByCalendarId(10L);
        then(calendarInvitationLinkWriter).should().save(link.capture());
        assertThat(created.token()).isNotBlank();
        assertThat(link.getValue().getTokenHash()).doesNotContain(created.token());
        assertThat(link.getValue().getExpiresAt()).isBetween(before.plusDays(7).minusSeconds(1), before.plusDays(7).plusSeconds(1));
    }

    @Test
    @DisplayName("승인 회원이 유효한 링크를 수락하면 링크 역할로 구성원이 된다")
    void accept_approvedMemberCreatesMembership() {
        given(memberReader.findById(2L)).willReturn(Optional.of(Member.builder().id(2L).status(MemberStatus.APPROVED).build()));
        given(calendarInvitationLinkReader.findByTokenHash(any()))
                .willReturn(Optional.of(CalendarInvitationLink.builder().calendarId(10L)
                        .role(CalendarMemberRole.EDITOR).expiresAt(LocalDateTime.now().plusDays(1)).build()));
        given(calendarMemberReader.findByCalendarIdAndMemberId(10L, 2L)).willReturn(Optional.empty());

        service().accept(2L, "shared-link-token");

        ArgumentCaptor<CalendarMember> member = ArgumentCaptor.forClass(CalendarMember.class);
        then(calendarMemberWriter).should().save(member.capture());
        assertThat(member.getValue().calendarId()).isEqualTo(10L);
        assertThat(member.getValue().memberId()).isEqualTo(2L);
        assertThat(member.getValue().role()).isEqualTo(CalendarMemberRole.EDITOR);
    }

    @Test
    @DisplayName("EDITOR는 초대 링크를 만들 수 없다")
    void create_editorIsDenied() {
        given(calendarReader.findById(10L)).willReturn(Optional.of(sharedCalendar()));
        given(calendarMemberReader.findByCalendarIdAndMemberId(10L, 2L))
                .willReturn(Optional.of(new CalendarMember(2L, 10L, 2L, CalendarMemberRole.EDITOR, null)));

        assertThatThrownBy(() -> service().create(2L, 10L, CalendarMemberRole.VIEWER))
                .isInstanceOf(AuthorizationException.class);
        then(calendarInvitationLinkWriter).shouldHaveNoInteractions();
    }

    @Test
    @DisplayName("OWNER는 참여자의 보기 권한을 수정 권한으로 변경할 수 있다")
    void updateMemberRole_ownerChangesViewerToEditor() {
        CalendarMember viewer = new CalendarMember(2L, 10L, 2L, CalendarMemberRole.VIEWER, LocalDateTime.now());
        given(calendarReader.findById(10L)).willReturn(Optional.of(sharedCalendar()));
        given(calendarMemberReader.findByCalendarIdAndMemberId(10L, 1L))
                .willReturn(Optional.of(ownerMembership()));
        given(calendarMemberReader.findByCalendarIdAndMemberId(10L, 2L)).willReturn(Optional.of(viewer));

        service().updateMemberRole(1L, 10L, 2L, CalendarMemberRole.EDITOR);

        ArgumentCaptor<CalendarMember> updated = ArgumentCaptor.forClass(CalendarMember.class);
        then(calendarMemberWriter).should().save(updated.capture());
        assertThat(updated.getValue().id()).isEqualTo(2L);
        assertThat(updated.getValue().role()).isEqualTo(CalendarMemberRole.EDITOR);
    }

    @Test
    @DisplayName("참여자는 공유 캘린더에서 스스로 나갈 수 있다")
    void leave_memberRemovesOwnMembership() {
        given(calendarReader.findById(10L)).willReturn(Optional.of(sharedCalendar()));
        given(calendarMemberReader.findByCalendarIdAndMemberId(10L, 2L))
                .willReturn(Optional.of(new CalendarMember(2L, 10L, 2L, CalendarMemberRole.EDITOR, null)));

        service().leave(2L, 10L);

        then(calendarMemberWriter).should().deleteByCalendarIdAndMemberId(10L, 2L);
    }

    @Test
    @DisplayName("소유자는 공유 캘린더에서 나갈 수 없다")
    void leave_ownerIsRejected() {
        given(calendarReader.findById(10L)).willReturn(Optional.of(sharedCalendar()));
        given(calendarMemberReader.findByCalendarIdAndMemberId(10L, 1L))
                .willReturn(Optional.of(ownerMembership()));

        assertThatThrownBy(() -> service().leave(1L, 10L))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("캘린더 소유자는 나갈 수 없습니다. 캘린더를 삭제하거나 소유권을 이전해주세요.");
        then(calendarMemberWriter).shouldHaveNoInteractions();
    }

    private CalendarInvitationLinkService service() {
        return new CalendarInvitationLinkService(calendarReader, calendarMemberReader, calendarMemberWriter,
                calendarInvitationLinkReader, calendarInvitationLinkWriter, memberReader);
    }

    private Calendar sharedCalendar() {
        return Calendar.builder().id(10L).ownerMemberId(1L).name("가족").type(CalendarType.SHARED).build();
    }

    private CalendarMember ownerMembership() {
        return new CalendarMember(1L, 10L, 1L, CalendarMemberRole.OWNER, null);
    }
}
