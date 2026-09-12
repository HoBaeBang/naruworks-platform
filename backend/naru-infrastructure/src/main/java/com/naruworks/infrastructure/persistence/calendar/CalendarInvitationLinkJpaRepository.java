package com.naruworks.infrastructure.persistence.calendar;

import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CalendarInvitationLinkJpaRepository extends JpaRepository<CalendarInvitationLinkEntity, Long> {

    Optional<CalendarInvitationLinkEntity> findByTokenHash(String tokenHash);

    List<CalendarInvitationLinkEntity> findAllByCalendarIdAndRevokedAtIsNull(Long calendarId);
}
