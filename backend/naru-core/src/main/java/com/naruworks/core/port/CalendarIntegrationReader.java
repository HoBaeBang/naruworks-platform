package com.naruworks.core.port;

import com.naruworks.domain.model.CalendarIntegration;
import com.naruworks.domain.type.CalendarIntegrationProvider;
import com.naruworks.domain.type.CalendarIntegrationStatus;
import java.util.List;
import java.util.Optional;

public interface CalendarIntegrationReader {

    List<CalendarIntegration> findAllByMemberIdAndProvider(
            Long memberId,
            CalendarIntegrationProvider provider
    );

    List<CalendarIntegration> findAllByProviderAndStatus(
            CalendarIntegrationProvider provider,
            CalendarIntegrationStatus status
    );

    Optional<CalendarIntegration> findByMemberIdAndProviderAndProviderAccountId(
            Long memberId,
            CalendarIntegrationProvider provider,
            String providerAccountId
    );

    Optional<CalendarIntegration> findByIdAndMemberId(Long integrationId, Long memberId);
}
