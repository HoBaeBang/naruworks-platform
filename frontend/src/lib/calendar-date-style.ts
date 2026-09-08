import type { CalendarDayMetadata } from "@/types/calendar-day-metadata";

const SUNDAY_TEXT_CLASS = "text-[#d9363e]";
const SATURDAY_TEXT_CLASS = "text-[#2d67c4]";

export function getCalendarDayMetadata(
  dayMetadataByDate: ReadonlyMap<string, CalendarDayMetadata>,
  date: Date,
) {
  return dayMetadataByDate.get(formatDate(date));
}

export function getCalendarDateTextClass(
  date: Date,
  metadata?: CalendarDayMetadata,
) {
  if (metadata?.holidayName || date.getDay() === 0) {
    return SUNDAY_TEXT_CLASS;
  }

  if (date.getDay() === 6) {
    return SATURDAY_TEXT_CLASS;
  }

  return "text-[var(--foreground)]";
}

export function getCalendarWeekdayTextClass(weekdayIndex: number) {
  if (weekdayIndex === 0) {
    return SUNDAY_TEXT_CLASS;
  }

  if (weekdayIndex === 6) {
    return SATURDAY_TEXT_CLASS;
  }

  return "text-[var(--muted)]";
}

export function formatLunarDate(metadata?: CalendarDayMetadata) {
  if (!metadata) {
    return null;
  }

  return `음 ${metadata.lunarIntercalation ? "윤" : ""}${metadata.lunarMonth}.${metadata.lunarDay}`;
}

export function formatDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
