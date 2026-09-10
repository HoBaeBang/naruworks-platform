package com.naruworks.core.service;

import com.naruworks.core.model.GoogleCalendarEvent;
import com.naruworks.core.port.CalendarIntegrationCalendarReader;
import com.naruworks.core.port.CalendarIntegrationReader;
import com.naruworks.core.port.ExternalCalendarEventReader;
import com.naruworks.core.port.ExternalCalendarEventWriter;
import com.naruworks.core.port.GoogleCalendarOAuthClient;
import com.naruworks.core.port.SensitiveDataEncryptor;
import com.naruworks.domain.model.CalendarIntegration;
import com.naruworks.domain.model.CalendarIntegrationCalendar;
import com.naruworks.domain.model.ExternalCalendarEvent;
import com.naruworks.domain.type.CalendarIntegrationProvider;
import com.naruworks.domain.type.CalendarIntegrationStatus;
import java.time.Clock;
import java.time.LocalDateTime;
import java.util.List;
import java.util.logging.Level;
import java.util.logging.Logger;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 선택한 외부 캘린더를 읽어 전용 저장소에 반영하고 표시용 이벤트를 조회한다. */
@Service
@RequiredArgsConstructor
public class ExternalCalendarEventService {

    private static final Logger LOGGER = Logger.getLogger(ExternalCalendarEventService.class.getName());

    private final CalendarIntegrationReader calendarIntegrationReader;
    private final CalendarIntegrationCalendarReader calendarIntegrationCalendarReader;
    private final ExternalCalendarEventReader externalCalendarEventReader;
    private final ExternalCalendarEventWriter externalCalendarEventWriter;
    private final GoogleCalendarOAuthClient googleCalendarOAuthClient;
    private final SensitiveDataEncryptor sensitiveDataEncryptor;
    private final Clock clock;

    @Transactional
    public List<ExternalCalendarEvent> synchronizeAndFindEvents(
            Long memberId,
            LocalDateTime from,
            LocalDateTime to
    ) {
        calendarIntegrationReader.findByMemberIdAndProvider(memberId, CalendarIntegrationProvider.GOOGLE)
                .filter(integration -> integration.getStatus() == CalendarIntegrationStatus.CONNECTED)
                .ifPresent(integration -> synchronize(integration, from, to));

        return externalCalendarEventReader.findAllDisplayEvents(memberId, from, to);
    }

    private void synchronize(CalendarIntegration integration, LocalDateTime from, LocalDateTime to) {
        List<CalendarIntegrationCalendar> selectedCalendars = calendarIntegrationCalendarReader
                .findAllByCalendarIntegrationId(integration.getId())
                .stream()
                .filter(CalendarIntegrationCalendar::isEnabled)
                .toList();
        if (selectedCalendars.isEmpty()) {
            return;
        }

        try {
            String refreshToken = sensitiveDataEncryptor.decrypt(integration.getEncryptedRefreshToken());
            String accessToken = googleCalendarOAuthClient.refreshAccessToken(refreshToken);
            for (CalendarIntegrationCalendar calendar : selectedCalendars) {
                saveCalendarEvents(calendar, googleCalendarOAuthClient.findEvents(
                        accessToken, calendar.getProviderCalendarId(), from, to
                ));
            }
        } catch (RuntimeException exception) {
            // 외부 API 장애가 내부 캘린더 조회 자체를 막지 않도록 마지막 저장본을 사용한다.
            LOGGER.log(
                    Level.WARNING,
                    "Google Calendar 일정 동기화에 실패했습니다. 저장된 일정으로 계속 표시합니다.",
                    exception
            );
        }
    }

    private void saveCalendarEvents(
            CalendarIntegrationCalendar calendar,
            List<GoogleCalendarEvent> googleEvents
    ) {
        if (googleEvents.isEmpty()) {
            return;
        }
        LocalDateTime now = LocalDateTime.now(clock);
        externalCalendarEventWriter.upsertAll(googleEvents.stream()
                .map(event -> toExternalEvent(calendar, event, now))
                .toList());
    }

    private ExternalCalendarEvent toExternalEvent(
            CalendarIntegrationCalendar calendar,
            GoogleCalendarEvent event,
            LocalDateTime now
    ) {
        // Google Event.colorId는 색상 코드가 아니라 제공자 내부 번호다.
        // 현재 UI에는 Calendar List가 돌려준 실제 색상을 일관되게 사용한다.
        String color = calendar.getCalendarColor();
        return ExternalCalendarEvent.create(
                calendar.getId(), event.eventId(), event.title(), event.description(),
                event.startAt(), event.endAt(), event.allDay(), event.location(), color,
                event.updatedAt(), now
        );
    }
}
