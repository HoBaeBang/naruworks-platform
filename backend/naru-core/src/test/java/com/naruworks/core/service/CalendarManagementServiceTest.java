package com.naruworks.core.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.mockito.BDDMockito.then;

import com.naruworks.core.port.CalendarMemberReader;
import com.naruworks.core.port.CalendarMemberWriter;
import com.naruworks.core.port.CalendarEventWriter;
import com.naruworks.core.port.CalendarReader;
import com.naruworks.core.port.CalendarWriter;
import com.naruworks.domain.model.Calendar;
import com.naruworks.domain.model.CalendarMember;
import com.naruworks.domain.type.CalendarMemberRole;
import com.naruworks.domain.type.CalendarType;
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
    @Mock private CalendarEventWriter calendarEventWriter;

    @Test
    @DisplayName("공유 캘린더 생성자는 OWNER로 함께 저장된다")
    void createCalendar_savesOwnerMembership() {
        Calendar saved = Calendar.builder()
                .id(10L).ownerMemberId(1L).name("가족").type(CalendarType.SHARED)
                .displayColor("#f4b942").build();
        given(calendarWriter.save(any(Calendar.class))).willReturn(saved);

        var result = service().createCalendar(1L, " 가족 ", true, "#f4b942");

        assertThat(result.calendar().getName()).isEqualTo("가족");
        assertThat(result.role()).isEqualTo(CalendarMemberRole.OWNER);
        ArgumentCaptor<CalendarMember> membership = ArgumentCaptor.forClass(CalendarMember.class);
        then(calendarMemberWriter).should().save(membership.capture());
        assertThat(membership.getValue().role()).isEqualTo(CalendarMemberRole.OWNER);
        assertThat(membership.getValue().calendarId()).isEqualTo(10L);
    }

    @Test
    @DisplayName("개인 캘린더는 지정한 색상으로 만들고 기본 캘린더로 바꾸지 않는다")
    void createCalendar_createsAdditionalPersonalCalendar() {
        Calendar saved = Calendar.builder()
                .id(11L).ownerMemberId(1L).name("운동").type(CalendarType.PERSONAL)
                .displayColor("#3b82f6").defaultCalendar(false).build();
        given(calendarWriter.save(any(Calendar.class))).willReturn(saved);

        var result = service().createCalendar(1L, " 운동 ", false, "#3b82f6");

        ArgumentCaptor<Calendar> calendar = ArgumentCaptor.forClass(Calendar.class);
        then(calendarWriter).should().save(calendar.capture());
        assertThat(calendar.getValue().getType()).isEqualTo(CalendarType.PERSONAL);
        assertThat(calendar.getValue().getDisplayColor()).isEqualTo("#3b82f6");
        assertThat(calendar.getValue().isDefaultCalendar()).isFalse();
        assertThat(result.calendar().getName()).isEqualTo("운동");
    }

    @Test
    @DisplayName("기본 개인 캘린더를 삭제하면 다른 개인 캘린더가 기본 캘린더가 된다")
    void deleteCalendar_replacesDefaultPersonalCalendar() {
        Calendar defaultCalendar = Calendar.builder()
                .id(1L).ownerMemberId(1L).name("내 캘린더").type(CalendarType.PERSONAL)
                .displayColor("#20b977").defaultCalendar(true).build();
        Calendar exerciseCalendar = Calendar.builder()
                .id(2L).ownerMemberId(1L).name("운동").type(CalendarType.PERSONAL)
                .displayColor("#3b82f6").defaultCalendar(false).build();
        given(calendarReader.findById(1L)).willReturn(java.util.Optional.of(defaultCalendar));
        given(calendarReader.findAllByOwnerMemberId(1L)).willReturn(java.util.List.of(defaultCalendar, exerciseCalendar));

        service().deleteCalendar(1L, 1L);

        ArgumentCaptor<Calendar> replacement = ArgumentCaptor.forClass(Calendar.class);
        then(calendarWriter).should().save(replacement.capture());
        assertThat(replacement.getValue().getId()).isEqualTo(2L);
        assertThat(replacement.getValue().isDefaultCalendar()).isTrue();
        then(calendarEventWriter).should().deleteAllByCalendarId(1L);
        then(calendarWriter).should().delete(1L);
    }

    @Test
    @DisplayName("유일한 개인 캘린더는 삭제할 수 없다")
    void deleteCalendar_rejectsOnlyPersonalCalendar() {
        Calendar personalCalendar = Calendar.personal(1L);
        given(calendarReader.findById(1L)).willReturn(java.util.Optional.of(
                Calendar.builder().id(1L).ownerMemberId(1L).name("내 캘린더")
                        .type(CalendarType.PERSONAL).displayColor("#20b977").defaultCalendar(true).build()
        ));
        given(calendarReader.findAllByOwnerMemberId(1L)).willReturn(java.util.List.of(personalCalendar));

        org.assertj.core.api.Assertions.assertThatThrownBy(() -> service().deleteCalendar(1L, 1L))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("개인 캘린더는 하나 이상 유지해야 합니다.");
        then(calendarWriter).shouldHaveNoInteractions();
        then(calendarEventWriter).shouldHaveNoInteractions();
    }

    private CalendarManagementService service() {
        return new CalendarManagementService(
                calendarReader, calendarWriter, calendarMemberReader, calendarMemberWriter, calendarEventWriter
        );
    }

}
