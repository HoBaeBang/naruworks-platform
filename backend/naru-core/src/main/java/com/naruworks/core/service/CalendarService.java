package com.naruworks.core.service;

import com.naruworks.core.port.CalendarEventReader;
import com.naruworks.core.port.CalendarEventWriter;
import com.naruworks.core.port.CalendarEventExceptionReader;
import com.naruworks.core.port.CalendarEventExceptionWriter;
import com.naruworks.core.port.LunarCalendarConverter;
import com.naruworks.domain.model.CalendarEvent;
import com.naruworks.domain.model.CalendarEventException;
import com.naruworks.domain.model.CalendarEventOccurrence;
import com.naruworks.domain.type.CalendarEventExceptionType;
import com.naruworks.domain.type.CalendarEventOccurrenceScope;
import com.naruworks.domain.type.CalendarEventRecurrenceRule;
import com.naruworks.domain.type.CalendarEventStatus;
import com.naruworks.domain.value.LunarDate;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.List;
import java.util.Map;
import java.util.function.Function;

@Service
@RequiredArgsConstructor
public class CalendarService {

    private final CalendarEventReader calendarEventReader;
    private final CalendarEventWriter calendarEventWriter;
    private final CalendarEventRecurrenceExpander calendarEventRecurrenceExpander;
    private final CalendarEventExceptionReader calendarEventExceptionReader;
    private final CalendarEventExceptionWriter calendarEventExceptionWriter;
    private final LunarCalendarConverter lunarCalendarConverter;

    /**
     * 회원의 일정 원본을 조회하고, 반복 발생 일정과 회차별 예외를 적용해 화면용 목록을 만든다.
     */
    public List<CalendarEventOccurrence> findEvents(
            Long memberId,
            LocalDateTime from,
            LocalDateTime to
    ) {
        List<CalendarEvent> events = calendarEventReader.findEvents(memberId, from, to);
        // 반복 원본 ID와 원래 발생 시작 시각을 키로 사용해 각 회차의 예외를 빠르게 찾는다.
        Map<String, CalendarEventException> exceptionsByOccurrence = calendarEventExceptionReader
                .findAllByCalendarEventIds(events.stream().map(CalendarEvent::getId).toList())
                .stream()
                .collect(java.util.stream.Collectors.toMap(
                        exception -> occurrenceKey(exception.calendarEventId(), exception.occurrenceStartAt()),
                        Function.identity(),
                        (left, right) -> right
                ));

        return events
                .stream()
                .flatMap(event -> calendarEventRecurrenceExpander.expand(event, from, to).stream())
                .map(occurrence -> applyException(occurrence, exceptionsByOccurrence))
                .flatMap(java.util.Optional::stream)
                .sorted((left, right) -> left.event().getStartAt().compareTo(right.event().getStartAt()))
                .toList();
    }

    /** 새 일정을 검증한 뒤, 요청한 회원의 활성 일정으로 저장한다. */
    public CalendarEvent createEvent(Long memberId, CalendarEvent event) {
        validateEvent(event);

        CalendarEvent newEvent = CalendarEvent.of(
                null,
                memberId,
                event.getTitle(),
                event.getDescription(),
                event.getStartAt(),
                event.getEndAt(),
                event.isAllDay(),
                event.getLocation(),
                event.getColor(),
                event.getRecurrenceRule(),
                recurrenceLunarDate(event),
                event.getRecurrenceEndAt(),
                CalendarEventStatus.ACTIVE
        );

        return calendarEventWriter.save(newEvent);
    }

    /** 단일 일정 또는 반복 시리즈 전체의 내용을 수정한다. */
    public CalendarEvent updateEvent(
            Long memberId,
            Long id,
            CalendarEvent event
    ) {
        validateEvent(event);

        CalendarEvent updateEvent = CalendarEvent.of(
                id,
                memberId,
                event.getTitle(),
                event.getDescription(),
                event.getStartAt(),
                event.getEndAt(),
                event.isAllDay(),
                event.getLocation(),
                event.getColor(),
                event.getRecurrenceRule(),
                recurrenceLunarDate(event),
                event.getRecurrenceEndAt(),
                CalendarEventStatus.ACTIVE
        );

        return calendarEventWriter.update(memberId, updateEvent);
    }

    /** 회원이 소유한 일정 원본 한 건을 조회한다. */
    public CalendarEvent findEvent(Long memberId, Long id) {
        return calendarEventReader.findEvent(memberId, id);
    }

    /** 일정 원본과 그 원본에 연결된 모든 회차 예외를 삭제한다. */
    @Transactional
    public void deleteEvent(Long memberId, Long id) {
        calendarEventExceptionWriter.deleteAllByCalendarEventId(id);
        calendarEventWriter.delete(memberId, id);
    }

    /**
     * 반복 일정의 선택 회차를 수정한다.
     * 범위에 따라 단일 회차 예외 저장, 시리즈 분리, 전체 시리즈 수정으로 나뉜다.
     */
    @Transactional
    public CalendarEvent updateOccurrence(
            Long memberId,
            Long id,
            LocalDateTime occurrenceStartAt,
            CalendarEventOccurrenceScope scope,
            CalendarEvent event
    ) {
        CalendarEvent series = calendarEventReader.findEvent(memberId, id);
        validateRecurringSeries(series);
        validateOccurrence(series, occurrenceStartAt);
        validateEvent(event);

        return switch (scope) {
            case THIS -> updateThisOccurrence(series, occurrenceStartAt, event);
            case THIS_AND_FOLLOWING -> updateThisAndFollowing(memberId, series, occurrenceStartAt, event);
            case ALL -> updateEvent(memberId, id, event);
        };
    }

    /**
     * 반복 일정의 선택 회차를 삭제한다.
     * 단일 회차는 취소 예외로 남기고, 이후 범위는 기존 시리즈를 종료한다.
     */
    @Transactional
    public void deleteOccurrence(
            Long memberId,
            Long id,
            LocalDateTime occurrenceStartAt,
            CalendarEventOccurrenceScope scope
    ) {
        CalendarEvent series = calendarEventReader.findEvent(memberId, id);
        validateRecurringSeries(series);
        validateOccurrence(series, occurrenceStartAt);

        switch (scope) {
            case THIS -> calendarEventExceptionWriter.save(
                    CalendarEventException.cancelled(id, occurrenceStartAt)
            );
            case THIS_AND_FOLLOWING -> endSeriesAtPreviousOccurrence(memberId, series, occurrenceStartAt);
            case ALL -> deleteEvent(memberId, id);
        }
    }

    /** 생성·수정 요청에 공통으로 적용하는 일정 시간과 반복 규칙 검증 */
    private void validateEvent(CalendarEvent event) {
        validateEventPeriod(event);
        validateAllDayEvent(event);
        validateRecurrence(event);
    }

    /** 시작 일시가 종료 일시보다 반드시 앞서는지 확인한다. */
    private void validateEventPeriod(CalendarEvent event) {
        if (!event.getStartAt().isBefore(event.getEndAt())) {
            throw new IllegalArgumentException("일정 시작 일시는 종료 일시보다 빨라야 합니다.");
        }
    }

    /** 종일 일정은 날짜 경계를 명확히 하기 위해 시작과 종료 시각을 자정으로만 허용한다. */
    private void validateAllDayEvent(CalendarEvent event) {
        if (event.isAllDay()
                && (!event.getStartAt().toLocalTime().equals(LocalTime.MIDNIGHT)
                || !event.getEndAt().toLocalTime().equals(LocalTime.MIDNIGHT))) {
            throw new IllegalArgumentException("종일 일정은 시작과 종료 시각을 자정으로 설정해야 합니다.");
        }
    }

    /** 반복하지 않는 일정의 종료일 설정과, 시작 전 종료일 설정을 막는다. */
    private void validateRecurrence(CalendarEvent event) {
        if (event.getRecurrenceRule() == CalendarEventRecurrenceRule.NONE
                && event.getRecurrenceEndAt() != null) {
            throw new IllegalArgumentException("반복하지 않는 일정에는 반복 종료일을 설정할 수 없습니다.");
        }

        if (event.getRecurrenceEndAt() != null
                && event.getRecurrenceEndAt().isBefore(event.getStartAt())) {
            throw new IllegalArgumentException("반복 종료 일시는 일정 시작 일시보다 빠를 수 없습니다.");
        }
    }

    /**
     * 이번 회차에만 변경 내용을 적용한다.
     * 원본 시리즈는 유지하고 해당 회차의 재정의 예외만 저장한다.
     */
    private CalendarEvent updateThisOccurrence(
            CalendarEvent series,
            LocalDateTime occurrenceStartAt,
            CalendarEvent event
    ) {
        calendarEventExceptionWriter.save(
                CalendarEventException.overridden(series.getId(), occurrenceStartAt, event)
        );

        return eventWithSeriesIdentity(series, event);
    }

    /**
     * 선택 회차부터 새 규칙을 적용하도록 기존 시리즈를 둘로 분리한다.
     * 선택 회차가 원본 시작 회차면 분리할 필요 없이 전체 시리즈를 수정한다.
     */
    private CalendarEvent updateThisAndFollowing(
            Long memberId,
            CalendarEvent series,
            LocalDateTime occurrenceStartAt,
            CalendarEvent event
    ) {
        if (occurrenceStartAt.equals(series.getStartAt())) {
            return updateEvent(memberId, series.getId(), event);
        }

        endSeriesAtPreviousOccurrence(memberId, series, occurrenceStartAt);

        return createEvent(memberId, event);
    }

    /**
     * 기존 시리즈가 선택 회차 직전까지만 발생하도록 반복 종료일을 자른다.
     * 원본 시작 회차부터 삭제할 때는 시리즈 전체를 제거한다.
     */
    private void endSeriesAtPreviousOccurrence(
            Long memberId,
            CalendarEvent series,
            LocalDateTime occurrenceStartAt
    ) {
        if (occurrenceStartAt.equals(series.getStartAt())) {
            deleteEvent(memberId, series.getId());
            return;
        }

        CalendarEvent shortenedSeries = CalendarEvent.of(
                series.getId(),
                memberId,
                series.getTitle(),
                series.getDescription(),
                series.getStartAt(),
                series.getEndAt(),
                series.isAllDay(),
                series.getLocation(),
                series.getColor(),
                series.getRecurrenceRule(),
                series.getRecurrenceLunarDate(),
                // 선택 회차는 포함하지 않도록 1 나노초 전으로 종료 시점을 설정한다.
                occurrenceStartAt.minusNanos(1),
                series.getStatus()
        );

        calendarEventWriter.update(memberId, shortenedSeries);
    }

    /** 반복 회차 전용 API가 단일 일정에 적용되지 않도록 막는다. */
    private void validateRecurringSeries(CalendarEvent series) {
        if (series.getRecurrenceRule() == CalendarEventRecurrenceRule.NONE) {
            throw new IllegalArgumentException("단일 일정에는 반복 일정 범위를 적용할 수 없습니다.");
        }
    }

    /** 전달받은 회차가 원본의 반복 규칙으로 실제 생성되는 회차인지 확인한다. */
    private void validateOccurrence(CalendarEvent series, LocalDateTime occurrenceStartAt) {
        if (!calendarEventRecurrenceExpander.isOccurrence(series, occurrenceStartAt)) {
            throw new IllegalArgumentException("반복 규칙에 없는 일정 회차입니다.");
        }
    }

    /**
     * 계산된 발생 회차에 취소 또는 재정의 예외를 적용한다.
     * 취소 회차는 목록에서 제거하고, 재정의 회차는 저장된 상세 값으로 교체한다.
     */
    private java.util.Optional<CalendarEventOccurrence> applyException(
            CalendarEventOccurrence occurrence,
            Map<String, CalendarEventException> exceptionsByOccurrence
    ) {
        CalendarEventException exception = exceptionsByOccurrence.get(occurrence.occurrenceKey());

        if (exception == null) {
            return java.util.Optional.of(occurrence);
        }
        if (exception.type() == CalendarEventExceptionType.CANCELLED) {
            return java.util.Optional.empty();
        }

        CalendarEvent event = occurrence.event();
        CalendarEvent overriddenEvent = CalendarEvent.of(
                event.getId(),
                event.getMemberId(),
                exception.title(),
                exception.description(),
                exception.startAt(),
                exception.endAt(),
                exception.allDay(),
                exception.location(),
                exception.color(),
                event.getRecurrenceRule(),
                event.getRecurrenceLunarDate(),
                event.getRecurrenceEndAt(),
                event.getStatus()
        );

        return java.util.Optional.of(new CalendarEventOccurrence(
                overriddenEvent,
                occurrence.occurrenceStartAt(),
                false
        ));
    }

    /**
     * 단일 회차 재정의 결과에 원본 시리즈의 식별자와 반복 메타데이터를 유지한다.
     */
    private CalendarEvent eventWithSeriesIdentity(CalendarEvent series, CalendarEvent event) {
        return CalendarEvent.of(
                series.getId(),
                series.getMemberId(),
                event.getTitle(),
                event.getDescription(),
                event.getStartAt(),
                event.getEndAt(),
                event.isAllDay(),
                event.getLocation(),
                event.getColor(),
                series.getRecurrenceRule(),
                series.getRecurrenceLunarDate(),
                series.getRecurrenceEndAt(),
                series.getStatus()
        );
    }

    /** 원본 일정 ID와 원래 회차 시작 시각으로 회차 예외를 식별하는 내부 키 */
    private String occurrenceKey(Long calendarEventId, LocalDateTime occurrenceStartAt) {
        return calendarEventId + ":" + occurrenceStartAt;
    }

    /** 음력 반복은 생성·수정 시 양력 시작일을 평달 기준의 음력 월·일로 고정한다. */
    private LunarDate recurrenceLunarDate(CalendarEvent event) {
        if (event.getRecurrenceRule() != CalendarEventRecurrenceRule.LUNAR_YEARLY) {
            return null;
        }

        return lunarCalendarConverter.toLunarDate(event.getStartAt().toLocalDate())
                .asRegularMonth();
    }
}
