/**
 * Personal-best records derived from workout history.
 * Durations are minutes; distance is meters; reps are reps per set.
 */

function numberOrZero(value) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function parsedDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== "string" || !value.trim()) return null;
  const text = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (match) {
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (date.getFullYear() !== Number(match[1]) ||
        date.getMonth() !== Number(match[2]) - 1 ||
        date.getDate() !== Number(match[3])) return null;
    return date;
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dayKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addDays(date, amount) {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  result.setDate(result.getDate() + amount);
  return result;
}

function normalize(entry) {
  const source = entry && typeof entry === "object" ? entry : {};
  const date = parsedDate(source.date);
  return {
    id: source.id == null ? "" : String(source.id),
    exercise: typeof source.exercise === "string" ? source.exercise.trim() : "",
    sets: numberOrZero(source.sets),
    reps: numberOrZero(source.reps),
    duration: numberOrZero(source.duration),
    mode: typeof source.mode === "string" ? source.mode.trim().toLowerCase() : "",
    date: date ? date.toISOString() : "",
    steps: numberOrZero(source.steps),
    distanceMeters: numberOrZero(source.distanceMeters)
  };
}

function recordWorkout(item, value, unit, extra = {}) {
  return {
    workout: { ...item },
    value,
    unit,
    ...extra
  };
}

function dayStreaks(keys, asOfDate) {
  const days = [...new Set(keys)].sort();
  let longestStreak = 0;
  let count = 0;
  let previous = null;
  const activeDays = new Set(days);
  for (const key of days) {
    const date = parsedDate(key);
    count = previous && dayKey(addDays(previous, 1)) === key ? count + 1 : 1;
    longestStreak = Math.max(longestStreak, count);
    previous = date;
  }
  const asOf = parsedDate(asOfDate) || new Date();
  const today = new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate());
  let key = activeDays.has(dayKey(today)) ? dayKey(today) :
    (activeDays.has(dayKey(addDays(today, -1))) ? dayKey(addDays(today, -1)) : "");
  let currentStreak = 0;
  while (key && activeDays.has(key)) {
    currentStreak += 1;
    key = dayKey(addDays(parsedDate(key), -1));
  }
  return { currentStreak, longestStreak };
}

/**
 * Return the requested personal-best records. Unavailable records are null,
 * rather than synthetic zero-valued records.
 */
export function getRecords(workouts, { asOfDate } = {}) {
  const items = Array.isArray(workouts) ? workouts.map(normalize) : [];
  const runs = items.filter((item) =>
    /\brun(?:ning)?\b/i.test(item.exercise) &&
    item.distanceMeters > 0 && item.duration > 0
  );
  const walks = items.filter((item) =>
    /\bwalk(?:ing)?\b/i.test(item.exercise) &&
    item.distanceMeters > 0
  );
  const durations = items.filter((item) => item.duration > 0);
  const steps = items.filter((item) => item.steps > 0);
  const reps = items
    .map((item) => ({ item, total: item.mode === "activity" ? 0 : item.reps * item.sets }))
    .filter(({ total }) => total > 0);
  const distances = items.filter((item) => item.distanceMeters > 0);
  const fastestRunItem = runs.reduce((best, item) => {
    const speed = item.distanceMeters / 1000 / (item.duration / 60);
    const bestSpeed = best
      ? best.distanceMeters / 1000 / (best.duration / 60)
      : 0;
    return !best || speed > bestSpeed ? item : best;
  }, null);

  const monthCounts = new Map();
  for (const item of items) {
    const date = parsedDate(item.date);
    if (!date) continue;
    const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    monthCounts.set(month, (monthCounts.get(month) || 0) + 1);
  }
  let mostActiveMonth = null;
  for (const [month, workoutCount] of monthCounts) {
    if (!mostActiveMonth || workoutCount > mostActiveMonth.workoutCount ||
        (workoutCount === mostActiveMonth.workoutCount && month < mostActiveMonth.month)) {
      mostActiveMonth = { month, workoutCount };
    }
  }

  const streaks = dayStreaks(items.map((item) => {
    const date = parsedDate(item.date);
    return date ? dayKey(date) : "";
  }).filter(Boolean), asOfDate);
  const longestWalk = walks.reduce((best, item) =>
    !best || item.distanceMeters > best.distanceMeters ? item : best, null);
  const longestWorkout = durations.reduce((best, item) =>
    !best || item.duration > best.duration ? item : best, null);
  const maxSteps = steps.reduce((best, item) =>
    !best || item.steps > best.steps ? item : best, null);
  const mostReps = reps.reduce((best, candidate) =>
    !best || candidate.total > best.total ? candidate : best, null);
  const largestDistance = distances.reduce((best, item) =>
    !best || item.distanceMeters > best.distanceMeters ? item : best, null);

  return {
    fastestRun: fastestRunItem ? recordWorkout(
      fastestRunItem,
      Number((fastestRunItem.distanceMeters / 1000 / (fastestRunItem.duration / 60)).toFixed(2)),
      "km/h",
      { paceSecondsPerKm: Math.round(fastestRunItem.duration * 60 / (fastestRunItem.distanceMeters / 1000)) }
    ) : null,
    longestWorkout: longestWorkout
      ? recordWorkout(longestWorkout, longestWorkout.duration, "minutes")
      : null,
    longestWalk: longestWalk
      ? recordWorkout(longestWalk, longestWalk.distanceMeters, "meters")
      : null,
    maxSteps: maxSteps ? recordWorkout(maxSteps, maxSteps.steps, "steps") : null,
    mostReps: mostReps
      ? recordWorkout(mostReps.item, mostReps.total, "reps")
      : null,
    longestStreak: streaks.longestStreak
      ? { value: streaks.longestStreak, unit: "days" }
      : null,
    largestDistance: largestDistance
      ? recordWorkout(largestDistance, largestDistance.distanceMeters, "meters")
      : null,
    mostActiveMonth
  };
}

