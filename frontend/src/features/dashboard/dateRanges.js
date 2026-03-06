import { subDays } from "date-fns";
import { toInputDate } from "../../app/utils/formatters";

export function quickDateRange(days) {
  if (days <= 0) return { startDate: "", endDate: "" };
  const end = new Date();
  const start = subDays(end, Math.max(0, days - 1));
  return {
    startDate: toInputDate(start),
    endDate: toInputDate(end),
  };
}

export function inferQuickPreset(startDate, endDate) {
  const start = String(startDate || "").trim();
  const end = String(endDate || "").trim();
  if (!start && !end) return 7;
  if (!start || !end) return null;
  for (const days of [1, 7, 30, 90]) {
    const range = quickDateRange(days);
    if (start === range.startDate && end === range.endDate) return days;
  }
  return null;
}
