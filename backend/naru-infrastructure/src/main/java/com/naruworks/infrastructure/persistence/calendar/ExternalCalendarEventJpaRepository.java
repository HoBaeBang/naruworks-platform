package com.naruworks.infrastructure.persistence.calendar;

import java.time.LocalDateTime;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ExternalCalendarEventJpaRepository extends JpaRepository<ExternalCalendarEventEntity, Long> {

    @org.springframework.data.jpa.repository.Modifying
    @Query(value = """
            INSERT INTO external_calendar_events (
                calendar_integration_calendar_id, provider_event_id, title, description,
                start_at, end_at, all_day, location, color, provider_updated_at, created_at, updated_at
            ) VALUES (
                :calendarIntegrationCalendarId, :providerEventId, :title, :description,
                :startAt, :endAt, :allDay, :location, :color, :providerUpdatedAt, :createdAt, :updatedAt
            ) ON CONFLICT (calendar_integration_calendar_id, provider_event_id) DO UPDATE SET
                title = EXCLUDED.title,
                description = EXCLUDED.description,
                start_at = EXCLUDED.start_at,
                end_at = EXCLUDED.end_at,
                all_day = EXCLUDED.all_day,
                location = EXCLUDED.location,
                color = EXCLUDED.color,
                provider_updated_at = EXCLUDED.provider_updated_at,
                updated_at = EXCLUDED.updated_at
            """, nativeQuery = true)
    void upsert(
            @Param("calendarIntegrationCalendarId") Long calendarIntegrationCalendarId,
            @Param("providerEventId") String providerEventId,
            @Param("title") String title,
            @Param("description") String description,
            @Param("startAt") LocalDateTime startAt,
            @Param("endAt") LocalDateTime endAt,
            @Param("allDay") boolean allDay,
            @Param("location") String location,
            @Param("color") String color,
            @Param("providerUpdatedAt") LocalDateTime providerUpdatedAt,
            @Param("createdAt") LocalDateTime createdAt,
            @Param("updatedAt") LocalDateTime updatedAt
    );

    @Query("""
            select event
            from ExternalCalendarEventEntity event,
                 CalendarIntegrationCalendarEntity calendar,
                 CalendarIntegrationEntity integration
            where event.calendarIntegrationCalendarId = calendar.id
              and calendar.calendarIntegrationId = integration.id
              and integration.memberId = :memberId
              and calendar.enabled = true
              and event.startAt < :to
              and event.endAt > :from
            order by event.startAt asc
            """)
    List<ExternalCalendarEventEntity> findAllDisplayEvents(
            @Param("memberId") Long memberId,
            @Param("from") LocalDateTime from,
            @Param("to") LocalDateTime to
    );
}
