package com.naruworks.core.service;

import com.naruworks.core.model.GoogleCalendarAccount;
import com.naruworks.core.model.GoogleCalendar;
import com.naruworks.core.model.GoogleCalendarSelection;
import com.naruworks.core.exception.NotFoundException;
import com.naruworks.core.port.CalendarIntegrationCalendarReader;
import com.naruworks.core.port.CalendarIntegrationCalendarWriter;
import com.naruworks.core.model.GoogleCalendarOAuthToken;
import com.naruworks.core.port.CalendarIntegrationReader;
import com.naruworks.core.port.CalendarIntegrationWriter;
import com.naruworks.core.port.GoogleCalendarOAuthClient;
import com.naruworks.core.port.SensitiveDataEncryptor;
import com.naruworks.domain.model.CalendarIntegration;
import com.naruworks.domain.model.CalendarIntegrationCalendar;
import com.naruworks.domain.type.CalendarIntegrationProvider;
import java.time.Clock;
import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class CalendarIntegrationService {

    private final CalendarIntegrationReader calendarIntegrationReader;
    private final CalendarIntegrationWriter calendarIntegrationWriter;
    private final CalendarIntegrationCalendarReader calendarIntegrationCalendarReader;
    private final CalendarIntegrationCalendarWriter calendarIntegrationCalendarWriter;
    private final GoogleCalendarOAuthClient googleCalendarOAuthClient;
    private final SensitiveDataEncryptor sensitiveDataEncryptor;
    private final Clock clock;

    @Transactional(readOnly = true)
    public String createGoogleAuthorizationUrl(String state) {
        return googleCalendarOAuthClient.createAuthorizationUrl(state);
    }

    /** Google 인가 코드 교환 결과를 암호화해 회원별 연결 정보로 저장한다. */
    @Transactional
    public CalendarIntegration connectGoogleCalendar(Long memberId, String authorizationCode) {
        GoogleCalendarOAuthToken token = googleCalendarOAuthClient
                .exchangeAuthorizationCode(authorizationCode);
        validateRefreshToken(token);

        GoogleCalendarAccount account = googleCalendarOAuthClient.findAccount(token.accessToken());
        String encryptedRefreshToken = sensitiveDataEncryptor.encrypt(token.refreshToken());
        LocalDateTime now = LocalDateTime.now(clock);

        CalendarIntegration integration = calendarIntegrationReader
                .findByMemberIdAndProvider(memberId, CalendarIntegrationProvider.GOOGLE)
                .map(existing -> existing.reconnect(
                        account.providerAccountId(),
                        account.email(),
                        encryptedRefreshToken,
                        now
                ))
                .orElseGet(() -> CalendarIntegration.connectGoogle(
                        memberId,
                        account.providerAccountId(),
                        account.email(),
                        encryptedRefreshToken,
                        now
                ));

        return calendarIntegrationWriter.save(integration);
    }

    @Transactional(readOnly = true)
    public Optional<CalendarIntegration> findGoogleIntegration(Long memberId) {
        return calendarIntegrationReader.findByMemberIdAndProvider(
                memberId,
                CalendarIntegrationProvider.GOOGLE
        );
    }

    /** 연결된 Google 계정의 캘린더 목록과 현재 NaruWorks 표시 선택 상태를 반환한다. */
    @Transactional(readOnly = true)
    public List<GoogleCalendarSelection> findGoogleCalendars(Long memberId) {
        CalendarIntegration integration = findConnectedGoogleIntegration(memberId);
        Map<String, CalendarIntegrationCalendar> selectionsByCalendarId = calendarIntegrationCalendarReader
                .findAllByCalendarIntegrationId(integration.getId())
                .stream()
                .collect(java.util.stream.Collectors.toMap(
                        CalendarIntegrationCalendar::getProviderCalendarId,
                        item -> item
                ));

        return readGoogleCalendars(integration).stream()
                .map(calendar -> toSelection(calendar, selectionsByCalendarId.get(calendar.calendarId())))
                .toList();
    }

    /** 요청한 Google 캘린더만 NaruWorks 화면에 표시하도록 저장한다. */
    @Transactional
    public List<GoogleCalendarSelection> updateGoogleCalendarSelections(
            Long memberId,
            Set<String> requestedCalendarIds
    ) {
        CalendarIntegration integration = findConnectedGoogleIntegration(memberId);
        List<GoogleCalendar> googleCalendars = readGoogleCalendars(integration);
        Set<String> availableCalendarIds = googleCalendars.stream()
                .map(GoogleCalendar::calendarId)
                .collect(java.util.stream.Collectors.toSet());

        if (!availableCalendarIds.containsAll(requestedCalendarIds)) {
            throw new IllegalArgumentException("Google 계정에 없는 캘린더는 선택할 수 없습니다.");
        }

        Map<String, CalendarIntegrationCalendar> existingByCalendarId = new HashMap<>();
        for (CalendarIntegrationCalendar existing : calendarIntegrationCalendarReader
                .findAllByCalendarIntegrationId(integration.getId())) {
            existingByCalendarId.put(existing.getProviderCalendarId(), existing);
        }

        LocalDateTime now = LocalDateTime.now(clock);
        List<CalendarIntegrationCalendar> savedCalendars = calendarIntegrationCalendarWriter.saveAll(
                googleCalendars.stream()
                        .map(calendar -> existingByCalendarId.containsKey(calendar.calendarId())
                                ? existingByCalendarId.get(calendar.calendarId()).updateFromProvider(
                                        calendar.name(), calendar.color(),
                                        requestedCalendarIds.contains(calendar.calendarId()), now
                                )
                                : CalendarIntegrationCalendar.create(
                                        integration.getId(), calendar.calendarId(), calendar.name(), calendar.color(),
                                        requestedCalendarIds.contains(calendar.calendarId()), now
                                ))
                        .toList()
        );
        Map<String, CalendarIntegrationCalendar> savedByCalendarId = savedCalendars.stream()
                .collect(java.util.stream.Collectors.toMap(
                        CalendarIntegrationCalendar::getProviderCalendarId,
                        item -> item
                ));

        return googleCalendars.stream()
                .map(calendar -> toSelection(calendar, savedByCalendarId.get(calendar.calendarId())))
                .toList();
    }

    private CalendarIntegration findConnectedGoogleIntegration(Long memberId) {
        return findGoogleIntegration(memberId)
                .filter(integration -> integration.getStatus()
                        == com.naruworks.domain.type.CalendarIntegrationStatus.CONNECTED)
                .orElseThrow(() -> new NotFoundException("연결된 Google Calendar 계정을 찾을 수 없습니다."));
    }

    private List<GoogleCalendar> readGoogleCalendars(CalendarIntegration integration) {
        String refreshToken = sensitiveDataEncryptor.decrypt(integration.getEncryptedRefreshToken());
        String accessToken = googleCalendarOAuthClient.refreshAccessToken(refreshToken);
        return googleCalendarOAuthClient.findCalendars(accessToken);
    }

    private GoogleCalendarSelection toSelection(
            GoogleCalendar calendar,
            CalendarIntegrationCalendar selection
    ) {
        return new GoogleCalendarSelection(
                calendar.calendarId(),
                calendar.name(),
                calendar.color(),
                calendar.primary(),
                selection != null && selection.isEnabled()
        );
    }

    private void validateRefreshToken(GoogleCalendarOAuthToken token) {
        if (token.refreshToken() == null || token.refreshToken().isBlank()) {
            throw new IllegalStateException(
                    "Google Calendar 연결에 필요한 refresh token을 받지 못했습니다. 다시 연결해주세요."
            );
        }
    }
}
