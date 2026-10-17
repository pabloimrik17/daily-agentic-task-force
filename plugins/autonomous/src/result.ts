// The one result shape shared by the session, workspace and attempt modules:
// a value, or an error message that names the command or file that failed.
// Trackers keep their own `TrackerResult`, which has the same shape.

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
