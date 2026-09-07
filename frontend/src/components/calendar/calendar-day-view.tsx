import { CalendarTimeGrid } from "@/components/calendar/calendar-time-grid";
import type { CalendarEvent } from "@/types/calendar";

export function CalendarDayView({ date, events }: { date: Date; events: CalendarEvent[] }) {
  return <CalendarTimeGrid days={[date]} events={events} view="day" />;
}
