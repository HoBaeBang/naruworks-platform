package com.naruworks.core.service;

import com.naruworks.core.exception.AuthorizationException;
import com.naruworks.core.exception.NotFoundException;
import com.naruworks.core.model.CalendarInvitationLinkPreview;
import com.naruworks.core.model.CreatedCalendarInvitationLink;
import com.naruworks.core.port.CalendarInvitationLinkReader;
import com.naruworks.core.port.CalendarInvitationLinkWriter;
import com.naruworks.core.port.CalendarMemberReader;
import com.naruworks.core.port.CalendarMemberWriter;
import com.naruworks.core.port.CalendarReader;
import com.naruworks.core.port.MemberReader;
import com.naruworks.domain.model.Calendar;
import com.naruworks.domain.model.CalendarInvitationLink;
import com.naruworks.domain.model.CalendarMember;
import com.naruworks.domain.model.Member;
import com.naruworks.domain.type.CalendarMemberRole;
import com.naruworks.domain.type.CalendarType;
import com.naruworks.domain.type.MemberStatus;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.util.Base64;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class CalendarInvitationLinkService {

    private static final SecureRandom SECURE_RANDOM = new SecureRandom();

    private final CalendarReader calendarReader;
    private final CalendarMemberReader calendarMemberReader;
    private final CalendarMemberWriter calendarMemberWriter;
    private final CalendarInvitationLinkReader calendarInvitationLinkReader;
    private final CalendarInvitationLinkWriter calendarInvitationLinkWriter;
    private final MemberReader memberReader;

    @Transactional
    public CreatedCalendarInvitationLink create(Long requesterMemberId, Long calendarId, CalendarMemberRole role) {
        requireOwner(requesterMemberId, calendarId);
        if (role == CalendarMemberRole.OWNER) {
            throw new IllegalArgumentException("초대 링크에는 OWNER 권한을 설정할 수 없습니다.");
        }

        String token = newToken();
        LocalDateTime now = LocalDateTime.now();
        calendarInvitationLinkWriter.revokeActiveByCalendarId(calendarId);
        CalendarInvitationLink link = CalendarInvitationLink.builder()
                .calendarId(calendarId)
                .createdByMemberId(requesterMemberId)
                .tokenHash(hash(token))
                .role(role)
                .expiresAt(now.plusDays(7))
                .createdAt(now)
                .build();
        CalendarInvitationLink saved = calendarInvitationLinkWriter.save(link);
        return new CreatedCalendarInvitationLink(token, saved.getExpiresAt());
    }

    @Transactional(readOnly = true)
    public CalendarInvitationLinkPreview preview(String token) {
        CalendarInvitationLink link = findUsableLink(token);
        Calendar calendar = calendarReader.findById(link.getCalendarId())
                .orElseThrow(() -> new NotFoundException("캘린더를 찾을 수 없습니다."));
        Member owner = memberReader.findById(calendar.getOwnerMemberId())
                .orElseThrow(() -> new NotFoundException("캘린더 소유자를 찾을 수 없습니다."));
        return new CalendarInvitationLinkPreview(calendar.getId(), calendar.getName(), owner.getDisplayName(), link.getRole(), link.getExpiresAt());
    }

    @Transactional
    public void accept(Long memberId, String token) {
        Member member = memberReader.findById(memberId)
                .orElseThrow(() -> new NotFoundException("회원을 찾을 수 없습니다."));
        if (member.getStatus() != MemberStatus.APPROVED) {
            throw new AuthorizationException("승인된 회원만 공유 캘린더에 참여할 수 있습니다.");
        }
        CalendarInvitationLink link = findUsableLink(token);
        if (calendarMemberReader.findByCalendarIdAndMemberId(link.getCalendarId(), memberId).isPresent()) {
            throw new IllegalArgumentException("이미 참여 중인 캘린더입니다.");
        }
        calendarMemberWriter.save(CalendarMember.of(link.getCalendarId(), memberId, link.getRole()));
    }

    @Transactional
    public void revoke(Long requesterMemberId, Long calendarId) {
        requireOwner(requesterMemberId, calendarId);
        calendarInvitationLinkWriter.revokeActiveByCalendarId(calendarId);
    }

    @Transactional
    public void removeMember(Long requesterMemberId, Long calendarId, Long memberId) {
        requireOwner(requesterMemberId, calendarId);
        CalendarMember membership = calendarMemberReader.findByCalendarIdAndMemberId(calendarId, memberId)
                .orElseThrow(() -> new NotFoundException("참여 중인 회원을 찾을 수 없습니다."));
        if (membership.role() == CalendarMemberRole.OWNER) {
            throw new IllegalArgumentException("캘린더 소유자는 제거할 수 없습니다.");
        }
        calendarMemberWriter.deleteByCalendarIdAndMemberId(calendarId, memberId);
    }

    @Transactional(readOnly = true)
    public List<CalendarMember> findMembers(Long requesterMemberId, Long calendarId) {
        requireOwner(requesterMemberId, calendarId);
        return calendarMemberReader.findAllByCalendarId(calendarId);
    }

    private CalendarInvitationLink findUsableLink(String token) {
        CalendarInvitationLink link = calendarInvitationLinkReader.findByTokenHash(hash(token))
                .orElseThrow(() -> new NotFoundException("유효하지 않은 초대 링크입니다."));
        if (!link.isUsableAt(LocalDateTime.now())) {
            throw new IllegalArgumentException("만료되었거나 폐기된 초대 링크입니다.");
        }
        return link;
    }

    private void requireOwner(Long requesterMemberId, Long calendarId) {
        Calendar calendar = calendarReader.findById(calendarId)
                .orElseThrow(() -> new NotFoundException("캘린더를 찾을 수 없습니다."));
        if (calendar.getType() != CalendarType.SHARED) {
            throw new IllegalArgumentException("공유 캘린더에서만 사용할 수 있습니다.");
        }
        CalendarMember requester = calendarMemberReader.findByCalendarIdAndMemberId(calendarId, requesterMemberId)
                .orElseThrow(() -> new AuthorizationException("공유 캘린더 관리 권한이 없습니다."));
        if (requester.role() != CalendarMemberRole.OWNER) {
            throw new AuthorizationException("공유 캘린더 관리 권한이 없습니다.");
        }
    }

    private String newToken() {
        byte[] bytes = new byte[32];
        SECURE_RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private String hash(String token) {
        try {
            return java.util.HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(token.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 알고리즘을 사용할 수 없습니다.", exception);
        }
    }
}
