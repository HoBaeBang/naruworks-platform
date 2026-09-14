package com.naruworks.core.service;

import com.naruworks.core.model.GoogleCalendarEvent;
import com.naruworks.core.model.GoogleCalendarSyncResult;
import com.naruworks.core.port.CalendarIntegrationCalendarReader;
import com.naruworks.core.port.CalendarIntegrationCalendarWriter;
import com.naruworks.core.port.CalendarIntegrationReader;
import com.naruworks.core.port.CalendarIntegrationWriter;
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
    private final CalendarIntegrationWriter calendarIntegrationWriter;
    private final CalendarIntegrationCalendarReader calendarIntegrationCalendarReader;
    private final CalendarIntegrationCalendarWriter calendarIntegrationCalendarWriter;
    private final ExternalCalendarEventReader externalCalendarEventReader;
    private final ExternalCalendarEventWriter externalCalendarEventWriter;
    private final GoogleCalendarOAuthClient googleCalendarOAuthClient;
    private final SensitiveDataEncryptor sensitiveDataEncryptor;
    private final Clock clock;

    /** Calendar 화면은 외부 API를 호출하지 않고 마지막으로 동기화한 저장본을 조회한다. */
    @Transactional(readOnly = true)
    public List<ExternalCalendarEvent> findEvents(Long memberId, LocalDateTime from, LocalDateTime to) {
        return externalCalendarEventReader.findAllDisplayEvents(memberId, from, to);
    }

    /** 모든 연결 Google 계정을 한 번씩 순회해 변경분을 반영한다. */
    @Transactional
    public void synchronizeAllConnectedGoogleCalendars() {
        calendarIntegrationReader.findAllByProviderAndStatus(
                        CalendarIntegrationProvider.GOOGLE, CalendarIntegrationStatus.CONNECTED
                )
                .forEach(this::synchronize);
    }

    /** 회원이 요청한 특정 Google 계정만 즉시 동기화한다. */
    @Transactional
    public CalendarIntegration synchronizeGoogleCalendar(Long memberId, Long integrationId) {
        CalendarIntegration integration = calendarIntegrationReader.findByIdAndMemberId(integrationId, memberId)
                .filter(item -> item.getProvider() == CalendarIntegrationProvider.GOOGLE)
                .filter(item -> item.getStatus() == CalendarIntegrationStatus.CONNECTED)
                .orElseThrow(() -> new IllegalArgumentException("연결된 Google Calendar 계정을 찾을 수 없습니다."));
        return synchronize(integration);
    }

    private CalendarIntegration synchronize(CalendarIntegration integration) {
        LocalDateTime now = LocalDateTime.now(clock);
        List<CalendarIntegrationCalendar> selectedCalendars = calendarIntegrationCalendarReader
                .findAllByCalendarIntegrationId(integration.getId())
                .stream()
                .filter(CalendarIntegrationCalendar::isEnabled)
                .toList();
        if (selectedCalendars.isEmpty()) {
            return calendarIntegrationWriter.save(integration.synchronizedSuccessfully(now));
        }

        try {
            String refreshToken = sensitiveDataEncryptor.decrypt(integration.getEncryptedRefreshToken());
            String accessToken = googleCalendarOAuthClient.refreshAccessToken(refreshToken);
            selectedCalendars.forEach(calendar -> synchronizeCalendar(calendar, accessToken));
            return calendarIntegrationWriter.save(integration.synchronizedSuccessfully(now));
        } catch (RuntimeException exception) {
            // 외부 API 장애가 내부 캘린더 조회 자체를 막지 않도록 마지막 저장본을 사용한다.
            LOGGER.log(
                    Level.WARNING,
                    "Google Calendar 일정 동기화에 실패했습니다. 저장된 일정으로 계속 표시합니다.",
                    exception
            );
            return calendarIntegrationWriter.save(integration.synchronizationFailed(
                    now,
                    summarizeException(exception)
            ));
        }
    }

    private String summarizeException(RuntimeException exception) {
        String message = exception.getMessage();
        if (message == null || message.isBlank()) {
            return "Google Calendar 동기화 요청에 실패했습니다.";
        }
        return message.length() <= 500 ? message : message.substring(0, 500);
    }

    private void synchronizeCalendar(CalendarIntegrationCalendar calendar, String accessToken) {
        LocalDateTime now = LocalDateTime.now(clock);
        GoogleCalendarSyncResult result = googleCalendarOAuthClient.synchronizeEvents(
                accessToken, calendar.getProviderCalendarId(), calendar.getSyncToken()
        );
        boolean replaceSnapshot = result.syncTokenExpired();
        if (result.syncTokenExpired()) {
            result = googleCalendarOAuthClient.synchronizeEvents(accessToken, calendar.getProviderCalendarId(), null);
        }

        if (replaceSnapshot) {
            externalCalendarEventWriter.deleteAllByCalendarIntegrationCalendarId(calendar.getId());
        }
        if (!result.events().isEmpty()) {
            externalCalendarEventWriter.upsertAll(result.events().stream()
                .map(event -> toExternalEvent(calendar, event, now))
                .toList());
        }
        if (!result.cancelledEventIds().isEmpty()) {
            externalCalendarEventWriter.deleteByCalendarIntegrationCalendarIdAndProviderEventIds(
                    calendar.getId(), result.cancelledEventIds()
            );
        }
        calendarIntegrationCalendarWriter.saveAll(List.of(
                calendar.withSynchronizationState(now, result.nextSyncToken())
        ));
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
