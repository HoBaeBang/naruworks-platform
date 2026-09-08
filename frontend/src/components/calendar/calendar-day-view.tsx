import { CalendarTimeGrid } from "@/components/calendar/calendar-time-grid";
import type { CalendarEvent } from "@/types/calendar";
import type { CalendarDayMetadata } from "@/types/calendar-day-metadata";

export function CalendarDayView({ date, events, dayMetadataByDate }: { date: Date; events: CalendarEvent[]; dayMetadataByDate: ReadonlyMap<string, CalendarDayMetadata> }) {
  return <CalendarTimeGrid days={[date]} events={events} view="day" dayMetadataByDate={dayMetadataByDate} />;
}
