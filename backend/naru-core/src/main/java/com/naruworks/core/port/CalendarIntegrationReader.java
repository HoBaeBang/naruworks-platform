package com.naruworks.core.port;

import com.naruworks.domain.model.CalendarIntegration;
import com.naruworks.domain.type.CalendarIntegrationProvider;
import java.util.Optional;

public interface CalendarIntegrationReader {

    Optional<CalendarIntegration> findByMemberIdAndProvider(
            Long memberId,
            CalendarIntegrationProvider provider
    );
}
