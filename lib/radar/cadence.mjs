export const INTERVAL_MS = 30 * 60000;
const valid = value => Number.isSafeInteger(value) && value > 0;
// Keep the planned timestamp even when a relay starts late. Missing cycles are
// skipped after collecting once; the cadence never shifts to task start time.
export function initialNextAt(previous, now, interval = INTERVAL_MS) {
 if (previous.activeIntervalMinutes === 30 && valid(previous.nextRun)) return previous.nextRun;
 return valid(previous.lastRun) ? previous.lastRun + interval : now;
}
export function advanceNextAt(nextAt, finishedAt, interval = INTERVAL_MS) {
 return finishedAt < nextAt ? nextAt : nextAt + (Math.floor((finishedAt-nextAt)/interval)+1)*interval;
}
// Ignore stale pulses and clients that try to reset the 30-minute grid.
export function preserveNextAt(previous, proposed, interval = INTERVAL_MS) {
 if (!valid(previous)) return proposed;
 return proposed >= previous && (proposed-previous)%interval === 0 ? proposed : previous;
}
