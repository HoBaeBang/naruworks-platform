package com.naruworks.api.controller;

import com.naruworks.api.dto.response.CalendarDayMetadataResponse;
import com.naruworks.api.security.CurrentMember;
import com.naruworks.core.service.CalendarDayMetadataService;
import com.naruworks.domain.model.Member;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.List;

@RestController
@RequiredArgsConstructor
@RequestMapping("/api/calendar/day-metadata")
public class CalendarDayMetadataController {

    private final CalendarDayMetadataService calendarDayMetadataService;

    /** 로그인한 회원의 달력 화면에 필요한 공휴일과 음력 보조 정보를 제공한다. */
    @GetMapping
    public List<CalendarDayMetadataResponse> getDayMetadata(
            @CurrentMember Member member,
            @RequestParam LocalDate from,
            @RequestParam LocalDate to
    ) {
        return calendarDayMetadataService.findBetween(from, to)
                .stream()
                .map(CalendarDayMetadataResponse::from)
                .toList();
    }
}
