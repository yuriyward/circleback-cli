import type { Meeting, Segment } from "./api.ts";

const parts = (zone: string, instant: Date, options: Intl.DateTimeFormatOptions) =>
  Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: zone, ...options }).formatToParts(instant).map((p) => [p.type, p.value]),
  ) as Record<string, string>;
/** Offset of `zone` from UTC at `instant`, in ms. */
function offset(zone: string, instant: number) {
  const p = parts(zone, new Date(instant), { day: "numeric", hour: "numeric", hourCycle: "h23", minute: "numeric", month: "numeric", second: "numeric", year: "numeric" });
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second)) - Math.floor(instant / 1000) * 1000;
}
/** 00:00 in `zone` on the date, as a UTC instant (ms). */
export function midnight(zone: string, date: { y: number; m: number; d: number }) {
  const wall = Date.UTC(date.y, date.m - 1, date.d);
  const first = wall - offset(zone, wall);
  return wall - offset(zone, first);
}
/** `2026-11-07 14:30` in `zone`. */
export function localDateTime(zone: string, iso: string | undefined) {
  const instant = new Date(iso ?? "");
  if (Number.isNaN(instant.getTime())) {
    return "?";
  }
  const p = parts(zone, instant, { day: "2-digit", hour: "2-digit", hourCycle: "h23", minute: "2-digit", month: "2-digit", year: "numeric" });
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}
/** `Monday, October 19, 2026 at 8:45 AM` in `zone`: the Circleback export's Date line. */
export function longDate(zone: string, iso: string | undefined) {
  const instant = new Date(iso ?? "");
  if (Number.isNaN(instant.getTime())) {
    return "?";
  }
  const p = parts(zone, instant, { day: "numeric", hour: "numeric", hour12: true, minute: "2-digit", month: "long", weekday: "long", year: "numeric" });
  return `${p.weekday}, ${p.month} ${p.day}, ${p.year} at ${p.hour}:${p.minute} ${p.dayPeriod}`;
}
/** Seconds as `m:ss`, or `h:mm:ss` from an hour. */
export function clock(seconds: number | null | undefined) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}
/** A meeting's duration in seconds, rounded to the nearest second. */
export const duration = (meeting: Meeting) => clock(Math.round(Number(meeting.duration) || 0));
export const people = (meeting: Meeting) =>
  (meeting.attendees ?? [])
    .map((a) => a?.name || a?.email || "")
    .filter(Boolean)
    .join(", ");
/** One line per meeting: id, local date-time, duration, name, attendee names. */
export function listLine(zone: string, meeting: Meeting) {
  return [meeting.id, localDateTime(zone, meeting.createdAt), duration(meeting), oneLine(meeting.name) || "(untitled)", people(meeting)].join("  ");
}
const oneLine = (text: string | null | undefined) => (text ?? "").replace(/\s+/g, " ").trim();
export function actionLines(meeting: Meeting) {
  return (meeting.actionItems ?? []).map((item) => {
    const who = item?.assignee?.name || item?.assignee?.email;
    const description = oneLine(item?.description);
    return `- ${oneLine(item?.title) || "(untitled)"}${who ? ` (${oneLine(who)})` : ""}${description ? `: ${description}` : ""}`;
  });
}
export function transcriptLines(segments: Segment[]) {
  return segments.map((s) => `[${clock(s.timestamp)}] **${oneLine(s.speaker) || "Unknown"}**: ${oneLine(s.text)}`);
}
/** The Markdown of one meeting, shaped like Circleback's own Markdown export. */
export function markdown(zone: string, meeting: Meeting, segments: Segment[]) {
  const actions = actionLines(meeting);
  return [
    `# ${oneLine(meeting.name) || "(untitled)"}`,
    `**Date**: ${longDate(zone, meeting.createdAt)}`,
    `**Duration**: ${duration(meeting)}`,
    `**People**: ${people(meeting)}`,
    `**Circleback**: ${meeting.id}`,
    "",
    "## Notes",
    (meeting.notes ?? "").trim(),
    "",
    "## Action items",
    ...(actions.length ? actions : ["(none)"]),
    "",
    "## Transcript",
    ...transcriptLines(segments),
    "",
  ].join("\n");
}
