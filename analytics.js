/**
 * Pure workout analytics helpers.
 *
 * Workout durations are interpreted as minutes, and reps are reps per set.
 * Dates are grouped by the browser's local calendar day. Calorie values are
 * conservative MET-based estimates, not measured energy expenditure.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const EMPTY_TOTALS = () => ({
  workoutCount: 0,
  reps: 0,
  sets: 0,
  durationMinutes: 0,
  steps: 0,
  distanceMeters: 0,
  activeDays: 0
});

function nonNegativeNumber(value) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function parseDate(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
  }
  if (typeof value !== "string" || !value.trim()) return null;
  const text = value.trim();
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (dateOnly) {
    const date = new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
    if (date.getFullYear() !== Number(dateOnly[1]) ||
        date.getMonth() !== Number(dateOnly[2]) - 1 ||
        date.getDate() !== Number(dateOnly[3])) return null;
    return date;
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateFromKey(key) {
  return parseDate(key);
}

function addDays(date, amount) {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  result.setDate(result.getDate() + amount);
  return result;
}

function finiteRound(value, digits = 2) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

/**
 * Return a sanitized copy of a workout, without changing its input.
 * Invalid dates become an empty string; missing or malformed measurements
 * become zero so they cannot inflate totals.
 */
export function normalizeWorkout(entry) {
  const source = entry && typeof entry === "object" ? entry : {};
  const date = parseDate(source.date);
  return {
    id: source.id == null ? "" : String(source.id),
    exercise: typeof source.exercise === "string" ? source.exercise.trim() : "",
    sets: nonNegativeNumber(source.sets),
    reps: nonNegativeNumber(source.reps),
    duration: nonNegativeNumber(source.duration),
    mode: typeof source.mode === "string" ? source.mode.trim().toLowerCase() : "",
    date: date ? date.toISOString() : "",
    steps: nonNegativeNumber(source.steps),
    distanceMeters: nonNegativeNumber(source.distanceMeters)
  };
}

function workoutDay(workout) {
  const date = parseDate(workout.date);
  return date ? dateKey(date) : "";
}

/**
 * Estimate calories for one entry using a conservative activity MET.
 * @returns {{calories: number, label: string, estimated: boolean, met: number}}
 */
export function estimateCalories(workout, weightKg) {
  const item = normalizeWorkout(workout);
  const weight = nonNegativeNumber(weightKg);
  if (!weight || !item.duration) {
    return {
      calories: 0,
      label: "Estimated calories unavailable without valid weight and duration.",
      estimated: false,
      met: 0
    };
  }

  const exercise = item.exercise.toLowerCase();
  let met = 0;
  if (/\brun(?:ning)?\b/.test(exercise)) met = 6;
  else if (/\bwalk(?:ing)?\b/.test(exercise)) met = 3;
  else if (/\byoga\b|\bstretch/.test(exercise)) met = 2.5;
  else if (item.mode === "manual" || item.mode === "camera") met = 3.5;
  if (!met) {
    return {
      calories: 0,
      label: "Estimated calories unavailable for an unrecognized activity.",
      estimated: false,
      met: 0
    };
  }

  const calories = met * 3.5 * weight * item.duration / 200;
  return {
    calories: finiteRound(calories, 1),
    label: "Estimated calories (conservative MET-based estimate).",
    estimated: true,
    met
  };
}

/**
 * Resolve a calendar range. Weeks start on Monday unless `weekStartsOn`
 * (0=Sunday through 6=Saturday) is supplied.
 */
export function getDateRange(period = "today", options = {}) {
  const selected = parseDate(options.date) || new Date();
  const day = new Date(selected.getFullYear(), selected.getMonth(), selected.getDate());
  const normalizedPeriod = String(period).toLowerCase();
  let start;
  let end;

  if (normalizedPeriod === "today" || normalizedPeriod === "day") {
    start = end = day;
  } else if (normalizedPeriod === "week") {
    const firstDay = Number.isInteger(options.weekStartsOn) &&
      options.weekStartsOn >= 0 && options.weekStartsOn <= 6 ? options.weekStartsOn : 1;
    const offset = (day.getDay() - firstDay + 7) % 7;
    start = addDays(day, -offset);
    end = addDays(start, 6);
  } else if (normalizedPeriod === "month") {
    start = new Date(day.getFullYear(), day.getMonth(), 1);
    end = new Date(day.getFullYear(), day.getMonth() + 1, 0);
  } else if (normalizedPeriod === "year") {
    start = new Date(day.getFullYear(), 0, 1);
    end = new Date(day.getFullYear(), 11, 31);
  } else if (normalizedPeriod === "lifetime") {
    return { period: normalizedPeriod, startDate: "", endDate: "" };
  } else {
    return { period: normalizedPeriod, startDate: "", endDate: "" };
  }

  return { period: normalizedPeriod, startDate: dateKey(start), endDate: dateKey(end) };
}

function inRange(key, range) {
  return Boolean(key) && (!range.startDate || key >= range.startDate) &&
    (!range.endDate || key <= range.endDate);
}

/**
 * Aggregate entries by today/day, week, month, year, or lifetime.
 * `date` selects the day (and therefore the containing week/month/year).
 * Passing `weightKg` adds a clearly labeled calorie estimate.
 */
export function aggregateWorkouts(workouts, {
  period = "lifetime",
  date,
  weekStartsOn,
  weightKg
} = {}) {
  const range = getDateRange(period, { date, weekStartsOn });
  const items = Array.isArray(workouts) ? workouts.map(normalizeWorkout) : [];
  const selected = items.filter((item) => inRange(workoutDay(item), range));
  const totals = EMPTY_TOTALS();
  const activeDays = new Set();
  let calories = 0;

  for (const item of selected) {
    totals.workoutCount += 1;
    totals.reps += item.mode === "activity" ? 0 : item.sets * item.reps;
    totals.sets += item.mode === "activity" ? 0 : item.sets;
    totals.durationMinutes += item.duration;
    totals.steps += item.steps;
    totals.distanceMeters += item.distanceMeters;
    activeDays.add(workoutDay(item));
    calories += estimateCalories(item, weightKg).calories;
  }
  totals.activeDays = activeDays.size;

  return {
    ...range,
    ...totals,
    reps: finiteRound(totals.reps),
    sets: finiteRound(totals.sets),
    durationMinutes: finiteRound(totals.durationMinutes),
    steps: finiteRound(totals.steps),
    distanceMeters: finiteRound(totals.distanceMeters),
    caloriesEstimate: finiteRound(calories, 1),
    calorieLabel: nonNegativeNumber(weightKg)
      ? "Estimated calories (conservative MET-based estimate)."
      : "Estimated calories unavailable without a valid user weight."
  };
}

/**
 * Create one chart point per day. Defaults to the seven days ending on `date`
 * (today by default). `startDate` and `endDate` can define a custom interval.
 */
export function dailySeries(workouts, {
  startDate,
  endDate,
  days = 7,
  date,
  weightKg
} = {}) {
  let end = parseDate(endDate) || parseDate(date) || new Date();
  let start = parseDate(startDate);
  end = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  if (!start) {
    const length = Number.isInteger(days) && days > 0 ? days : 7;
    start = addDays(end, -(length - 1));
  } else {
    start = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  }
  if (start > end) return [];

  const byDay = new Map();
  const items = Array.isArray(workouts) ? workouts.map(normalizeWorkout) : [];
  for (const item of items) {
    const key = workoutDay(item);
    if (!inRange(key, { startDate: dateKey(start), endDate: dateKey(end) })) continue;
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(item);
  }

  const series = [];
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) {
    const key = dateKey(cursor);
    const entries = byDay.get(key) || [];
    const totals = EMPTY_TOTALS();
    let calories = 0;
    for (const item of entries) {
      totals.workoutCount += 1;
      totals.reps += item.mode === "activity" ? 0 : item.sets * item.reps;
      totals.sets += item.mode === "activity" ? 0 : item.sets;
      totals.durationMinutes += item.duration;
      totals.steps += item.steps;
      totals.distanceMeters += item.distanceMeters;
      calories += estimateCalories(item, weightKg).calories;
    }
    totals.activeDays = entries.length ? 1 : 0;
    series.push({
      date: key,
      ...totals,
      reps: finiteRound(totals.reps),
      sets: finiteRound(totals.sets),
      durationMinutes: finiteRound(totals.durationMinutes),
      steps: finiteRound(totals.steps),
      distanceMeters: finiteRound(totals.distanceMeters),
      caloriesEstimate: finiteRound(calories, 1)
    });
  }
  return series;
}

function streakMetrics(dayKeys, asOfDate) {
  const days = [...new Set(dayKeys.filter(Boolean))].sort();
  const daySet = new Set(days);
  let longestStreak = 0;
  let run = 0;
  let prior = null;
  for (const key of days) {
    const current = dateFromKey(key);
    if (prior && dateKey(addDays(prior, 1)) === key) run += 1;
    else run = 1;
    longestStreak = Math.max(longestStreak, run);
    prior = current;
  }

  const todayKey = dateKey(asOfDate);
  const yesterdayKey = dateKey(addDays(asOfDate, -1));
  let cursorKey = daySet.has(todayKey) ? todayKey : (daySet.has(yesterdayKey) ? yesterdayKey : "");
  let currentStreak = 0;
  while (cursorKey && daySet.has(cursorKey)) {
    currentStreak += 1;
    cursorKey = dateKey(addDays(dateFromKey(cursorKey), -1));
  }
  return { currentStreak, longestStreak };
}

/**
 * Score consistency as active days divided by calendar days in a rolling
 * window (inclusive of `asOfDate`). Streaks are calculated over all history;
 * an inactive current day still permits a streak ending yesterday.
 */
export function consistency(workouts, { asOfDate, windowDays = 30 } = {}) {
  const asOf = parseDate(asOfDate) || new Date();
  const today = new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate());
  const length = Number.isInteger(windowDays) && windowDays > 0 ? windowDays : 30;
  const windowStart = addDays(today, -(length - 1));
  const dayKeys = Array.isArray(workouts)
    ? workouts.map(normalizeWorkout).map(workoutDay).filter(Boolean)
    : [];
  const activeInWindow = new Set(dayKeys.filter((key) =>
    key >= dateKey(windowStart) && key <= dateKey(today)
  ));
  const streaks = streakMetrics(dayKeys, today);
  const missedDays = Math.max(0, length - activeInWindow.size);

  return {
    consistencyScore: finiteRound(activeInWindow.size / length * 100, 1),
    currentStreak: streaks.currentStreak,
    longestStreak: streaks.longestStreak,
    missedDays,
    activeDays: activeInWindow.size,
    windowDays: length,
    startDate: dateKey(windowStart),
    endDate: dateKey(today)
  };
}

