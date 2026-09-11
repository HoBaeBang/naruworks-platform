package com.naruworks.core.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.mockito.BDDMockito.then;

import com.naruworks.core.exception.AuthorizationException;
import com.naruworks.core.port.CalendarMemberReader;
import com.naruworks.core.port.CalendarMemberWriter;
import com.naruworks.core.port.CalendarReader;
import com.naruworks.core.port.CalendarWriter;
import com.naruworks.core.port.MemberReader;
import com.naruworks.domain.model.Calendar;
import com.naruworks.domain.model.CalendarMember;
import com.naruworks.domain.model.Member;
import com.naruworks.domain.type.CalendarMemberRole;
import com.naruworks.domain.type.CalendarType;
import java.util.Optional;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class CalendarManagementServiceTest {

    @Mock private CalendarReader calendarReader;
    @Mock private CalendarWriter calendarWriter;
    @Mock private CalendarMemberReader calendarMemberReader;
    @Mock private CalendarMemberWriter calendarMemberWriter;
    @Mock private MemberReader memberReader;

    @Test
    @DisplayName("공유 캘린더 생성자는 OWNER로 함께 저장된다")
    void createSharedCalendar_savesOwnerMembership() {
        Calendar saved = Calendar.builder()
                .id(10L).ownerMemberId(1L).name("가족").type(CalendarType.SHARED).build();
        given(calendarWriter.save(any(Calendar.class))).willReturn(saved);

        var result = service().createSharedCalendar(1L, " 가족 ");

        assertThat(result.calendar().getName()).isEqualTo("가족");
        assertThat(result.role()).isEqualTo(CalendarMemberRole.OWNER);
        ArgumentCaptor<CalendarMember> membership = ArgumentCaptor.forClass(CalendarMember.class);
        then(calendarMemberWriter).should().save(membership.capture());
        assertThat(membership.getValue().role()).isEqualTo(CalendarMemberRole.OWNER);
        assertThat(membership.getValue().calendarId()).isEqualTo(10L);
    }

    @Test
    @DisplayName("EDITOR는 공유 캘린더에 회원을 초대할 수 없다")
    void addMember_editorIsDenied() {
        given(calendarReader.findById(10L)).willReturn(Optional.of(sharedCalendar()));
        given(calendarMemberReader.findByCalendarIdAndMemberId(10L, 1L))
                .willReturn(Optional.of(new CalendarMember(1L, 10L, 1L, CalendarMemberRole.EDITOR, null)));

        assertThatThrownBy(() -> service().addMember(1L, 10L, "friend@example.com", CalendarMemberRole.VIEWER))
                .isInstanceOf(AuthorizationException.class)
                .hasMessage("공유 캘린더 관리 권한이 없습니다.");
        then(memberReader).shouldHaveNoInteractions();
    }

    @Test
    @DisplayName("OWNER는 승인된 회원을 EDITOR로 초대할 수 있다")
    void addMember_ownerInvitesApprovedMember() {
        given(calendarReader.findById(10L)).willReturn(Optional.of(sharedCalendar()));
        given(calendarMemberReader.findByCalendarIdAndMemberId(10L, 1L))
                .willReturn(Optional.of(new CalendarMember(1L, 10L, 1L, CalendarMemberRole.OWNER, null)));
        given(memberReader.findApprovedByEmail("friend@example.com"))
                .willReturn(Optional.of(Member.builder().id(2L).email("friend@example.com").build()));
        given(calendarMemberReader.findByCalendarIdAndMemberId(10L, 2L)).willReturn(Optional.empty());

        service().addMember(1L, 10L, "friend@example.com", CalendarMemberRole.EDITOR);

        ArgumentCaptor<CalendarMember> membership = ArgumentCaptor.forClass(CalendarMember.class);
        then(calendarMemberWriter).should().save(membership.capture());
        assertThat(membership.getValue().memberId()).isEqualTo(2L);
        assertThat(membership.getValue().role()).isEqualTo(CalendarMemberRole.EDITOR);
    }

    private CalendarManagementService service() {
        return new CalendarManagementService(
                calendarReader, calendarWriter, calendarMemberReader, calendarMemberWriter, memberReader
        );
    }

    private Calendar sharedCalendar() {
        return Calendar.builder()
                .id(10L).ownerMemberId(1L).name("가족").type(CalendarType.SHARED).build();
    }
}
