import { CalendarTimeGrid } from "@/components/calendar/calendar-time-grid";
import type { CalendarEvent } from "@/types/calendar";

export function CalendarWeekView({ anchorDate, events }: { anchorDate: Date; events: CalendarEvent[] }) {
  const weekStart = new Date(anchorDate);
  weekStart.setDate(anchorDate.getDate() - anchorDate.getDay());
  const days = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(weekStart);
    day.setDate(weekStart.getDate() + index);
    return day;
  });

  return <CalendarTimeGrid days={days} events={events} view="week" />;
}
