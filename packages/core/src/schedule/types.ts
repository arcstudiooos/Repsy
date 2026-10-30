export type SlotKey = { weekIndex: number; dayIndex: number };

/** ISO weekday, Monday = 1 ... Sunday = 7. */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type ScheduledSlot = {
  slot: SlotKey;
  /** Intended local calendar date (YYYY-MM-DD) in the client's timezone. */
  localDate: string;
  /** 00:00 local on localDate, as a UTC instant. */
  scheduledAtUtc: Date;
  /** 23:59:00 local on localDate, as a UTC instant. */
  dueAtUtc: Date;
};

export type ScheduleSlotsInput = {
  slots: SlotKey[];
  weekdays: IsoWeekday[];
  startLocalDate: string;
  timeZone: string;
};
