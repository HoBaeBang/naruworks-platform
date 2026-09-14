package com.naruworks.api.scheduler;

import static org.mockito.BDDMockito.then;

import com.naruworks.core.service.ExternalCalendarEventService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class GoogleCalendarSynchronizationSchedulerTest {

    @Mock
    private ExternalCalendarEventService externalCalendarEventService;

    @Test
    void synchronize_delegatesToAllConnectedGoogleCalendarSynchronization() {
        new GoogleCalendarSynchronizationScheduler(externalCalendarEventService).synchronize();

        then(externalCalendarEventService).should().synchronizeAllConnectedGoogleCalendars();
    }
}
