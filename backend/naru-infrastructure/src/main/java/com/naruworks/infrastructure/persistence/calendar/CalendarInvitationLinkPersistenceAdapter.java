package com.naruworks.infrastructure.persistence.calendar;

import com.naruworks.core.port.CalendarInvitationLinkReader;
import com.naruworks.core.port.CalendarInvitationLinkWriter;
import com.naruworks.domain.model.CalendarInvitationLink;
import java.time.LocalDateTime;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Repository;

@Repository
@RequiredArgsConstructor
public class CalendarInvitationLinkPersistenceAdapter
        implements CalendarInvitationLinkReader, CalendarInvitationLinkWriter {

    private final CalendarInvitationLinkJpaRepository calendarInvitationLinkJpaRepository;

    @Override
    public java.util.Optional<CalendarInvitationLink> findByTokenHash(String tokenHash) {
        return calendarInvitationLinkJpaRepository.findByTokenHash(tokenHash)
                .map(CalendarInvitationLinkEntity::toDomain);
    }

    @Override
    public CalendarInvitationLink save(CalendarInvitationLink invitationLink) {
        return calendarInvitationLinkJpaRepository.save(CalendarInvitationLinkEntity.from(invitationLink)).toDomain();
    }

    @Override
    public void revokeActiveByCalendarId(Long calendarId) {
        calendarInvitationLinkJpaRepository.findAllByCalendarIdAndRevokedAtIsNull(calendarId).stream()
                .forEach(link -> link.revoke(LocalDateTime.now()));
    }
}
