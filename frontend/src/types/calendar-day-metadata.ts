export type CalendarDayMetadata = {
  date: string;
  lunarMonth: number;
  lunarDay: number;
  lunarIntercalation: boolean;
  holidayName: string | null;
};
