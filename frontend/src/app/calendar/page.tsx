import { Suspense } from "react";
import { CalendarClientPage } from "@/components/calendar/calendar-client-page";

export default function CalendarPage() {
  return (
    <Suspense>
      <CalendarClientPage />
    </Suspense>
  );
}
