package com.naruworks.infrastructure.calendar;

import com.naruworks.core.port.CalendarDayMetadataReader;
import com.naruworks.core.port.CalendarHolidayOverrideReader;
import com.naruworks.core.port.LunarCalendarConverter;
import com.naruworks.domain.model.CalendarHolidayOverride;
import com.naruworks.domain.type.CalendarHolidayOverrideOperation;
import com.naruworks.domain.value.CalendarDayMetadata;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 오프라인 한국 음력 변환 라이브러리와 법정 공휴일 규칙으로 날짜 메타데이터를 만든다.
 * 외부 API를 조회하지 않으므로 화면 요청마다 네트워크 지연이나 공급자 장애가 전파되지 않는다.
 */
@Component
@RequiredArgsConstructor
public class KoreanCalendarMetadataAdapter implements CalendarDayMetadataReader {

    private final LunarCalendarConverter lunarCalendarConverter;
    private final CalendarHolidayOverrideReader calendarHolidayOverrideReader;

    @Override
    public List<CalendarDayMetadata> findBetween(LocalDate from, LocalDate to) {
        Map<LocalDate, String> holidays = KoreanHolidayCalculator.holidaysBetween(
                from,
                to,
                lunarCalendarConverter
        );
        applyOverrides(holidays, calendarHolidayOverrideReader.findAllBetween(from, to));
        List<CalendarDayMetadata> metadata = new ArrayList<>();

        for (LocalDate date = from; !date.isAfter(to); date = date.plusDays(1)) {
            metadata.add(CalendarDayMetadata.of(
                    date,
                    lunarCalendarConverter.toLunarDate(date),
                    holidays.get(date)
            ));
        }

        return metadata;
    }

    private void applyOverrides(
            Map<LocalDate, String> holidays,
            List<CalendarHolidayOverride> overrides
    ) {
        for (CalendarHolidayOverride override : overrides) {
            if (override.operation() == CalendarHolidayOverrideOperation.ADD) {
                holidays.put(override.holidayDate(), override.holidayName());
            } else {
                holidays.remove(override.holidayDate());
            }
        }
    }

    private static final class KoreanHolidayCalculator {

        private KoreanHolidayCalculator() {
        }

        static Map<LocalDate, String> holidaysBetween(
                LocalDate from,
                LocalDate to,
                LunarCalendarConverter lunarCalendarConverter
        ) {
            Map<LocalDate, String> holidays = new LinkedHashMap<>();

            for (int year = from.getYear(); year <= to.getYear(); year++) {
                addYearlyHolidays(year, holidays, lunarCalendarConverter);
            }

            return holidays.entrySet().stream()
                    .filter(entry -> !entry.getKey().isBefore(from) && !entry.getKey().isAfter(to))
                    .collect(java.util.stream.Collectors.toMap(
                            Map.Entry::getKey,
                            Map.Entry::getValue,
                            (left, right) -> left,
                            LinkedHashMap::new
                    ));
        }

        private static void addYearlyHolidays(
                int year,
                Map<LocalDate, String> holidays,
                LunarCalendarConverter lunarCalendarConverter
        ) {
            Map<LocalDate, String> yearlyHolidays = new LinkedHashMap<>();
            List<HolidayGroup> substituteCandidates = new ArrayList<>();

            add(yearlyHolidays, LocalDate.of(year, 1, 1), "신정");
            add(yearlyHolidays, LocalDate.of(year, 3, 1), "삼일절");
            add(yearlyHolidays, LocalDate.of(year, 5, 5), "어린이날");
            add(yearlyHolidays, LocalDate.of(year, 6, 6), "현충일");
            add(yearlyHolidays, LocalDate.of(year, 8, 15), "광복절");
            add(yearlyHolidays, LocalDate.of(year, 10, 3), "개천절");
            add(yearlyHolidays, LocalDate.of(year, 10, 9), "한글날");
            add(yearlyHolidays, LocalDate.of(year, 12, 25), "성탄절");

            substituteCandidates.add(HolidayGroup.single(LocalDate.of(year, 3, 1)));
            substituteCandidates.add(HolidayGroup.single(LocalDate.of(year, 5, 5)));
            substituteCandidates.add(HolidayGroup.single(LocalDate.of(year, 8, 15)));
            substituteCandidates.add(HolidayGroup.single(LocalDate.of(year, 10, 3)));
            substituteCandidates.add(HolidayGroup.single(LocalDate.of(year, 10, 9)));
            substituteCandidates.add(HolidayGroup.single(LocalDate.of(year, 12, 25)));

            for (int lunarYear = year - 1; lunarYear <= year + 1; lunarYear++) {
                addLunarHolidayGroups(
                        lunarYear,
                        year,
                        yearlyHolidays,
                        substituteCandidates,
                        lunarCalendarConverter
                );
            }

            applySubstituteHolidays(yearlyHolidays, substituteCandidates);
            yearlyHolidays.forEach((date, name) -> add(holidays, date, name));
        }

        private static void addLunarHolidayGroups(
                int lunarYear,
                int targetSolarYear,
                Map<LocalDate, String> holidays,
                List<HolidayGroup> substituteCandidates,
                LunarCalendarConverter lunarCalendarConverter
        ) {
            LocalDate lunarNewYear = lunarCalendarConverter.toSolarDate(lunarYear, 1, 1);
            addThreeDayGroup(
                    targetSolarYear,
                    holidays,
                    substituteCandidates,
                    lunarNewYear,
                    "설날 연휴",
                    "설날"
            );

            LocalDate buddhaBirthday = lunarCalendarConverter.toSolarDate(lunarYear, 4, 8);
            if (buddhaBirthday.getYear() == targetSolarYear) {
                add(holidays, buddhaBirthday, "부처님오신날");
                substituteCandidates.add(HolidayGroup.single(buddhaBirthday));
            }

            LocalDate chuseok = lunarCalendarConverter.toSolarDate(lunarYear, 8, 15);
            addThreeDayGroup(
                    targetSolarYear,
                    holidays,
                    substituteCandidates,
                    chuseok,
                    "추석 연휴",
                    "추석"
            );
        }

        private static void addThreeDayGroup(
                int targetSolarYear,
                Map<LocalDate, String> holidays,
                List<HolidayGroup> substituteCandidates,
                LocalDate center,
                String surroundingName,
                String centerName
        ) {
            List<LocalDate> dates = List.of(center.minusDays(1), center, center.plusDays(1));
            List<LocalDate> datesInYear = dates.stream()
                    .filter(date -> date.getYear() == targetSolarYear)
                    .toList();

            if (datesInYear.isEmpty()) {
                return;
            }

            datesInYear.forEach(date -> add(holidays, date, date.equals(center) ? centerName : surroundingName));
            substituteCandidates.add(new HolidayGroup(datesInYear));
        }

        private static void applySubstituteHolidays(
                Map<LocalDate, String> holidays,
                List<HolidayGroup> candidates
        ) {
            for (HolidayGroup candidate : candidates) {
                boolean needsSubstitute = candidate.dates().stream()
                        .anyMatch(date -> isWeekend(date) || hasOtherHoliday(holidays, date));

                if (!needsSubstitute) {
                    continue;
                }

                LocalDate substituteDate = candidate.latestDate().plusDays(1);
                while (isWeekend(substituteDate) || holidays.containsKey(substituteDate)) {
                    substituteDate = substituteDate.plusDays(1);
                }
                add(holidays, substituteDate, "대체공휴일");
            }
        }

        private static boolean hasOtherHoliday(Map<LocalDate, String> holidays, LocalDate date) {
            String holidayName = holidays.get(date);
            return holidayName != null && holidayName.contains("·");
        }

        private static boolean isWeekend(LocalDate date) {
            return date.getDayOfWeek() == DayOfWeek.SATURDAY
                    || date.getDayOfWeek() == DayOfWeek.SUNDAY;
        }

        private static void add(Map<LocalDate, String> holidays, LocalDate date, String name) {
            holidays.merge(date, name, (current, next) -> current.equals(next) ? current : current + "·" + next);
        }

        private record HolidayGroup(List<LocalDate> dates) {

            static HolidayGroup single(LocalDate date) {
                return new HolidayGroup(List.of(date));
            }

            LocalDate latestDate() {
                return dates.stream().max(LocalDate::compareTo).orElseThrow();
            }
        }
    }
}
