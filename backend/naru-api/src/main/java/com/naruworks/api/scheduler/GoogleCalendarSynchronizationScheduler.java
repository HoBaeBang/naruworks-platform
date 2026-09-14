package com.naruworks.api.scheduler;

import com.naruworks.core.service.ExternalCalendarEventService;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** 단일 홈서버 인스턴스에서 모든 연결 Google 계정을 순차 동기화한다. */
@Component
@RequiredArgsConstructor
@ConditionalOnProperty(prefix = "naru.google-calendar.sync", name = "enabled", havingValue = "true", matchIfMissing = true)
public class GoogleCalendarSynchronizationScheduler {

    private final ExternalCalendarEventService externalCalendarEventService;

    @Scheduled(
            fixedDelayString = "${naru.google-calendar.sync.fixed-delay:PT30M}",
            initialDelayString = "${naru.google-calendar.sync.initial-delay:PT1M}"
    )
    public void synchronize() {
        externalCalendarEventService.synchronizeAllConnectedGoogleCalendars();
    }
}
