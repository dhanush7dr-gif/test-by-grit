/**
 * Stable achievement catalog and progress calculation.
 * Achievement timestamps represent the time the catalog first observes an
 * unlock; previously saved unlock timestamps are always retained.
 */

export const ACHIEVEMENT_CATALOG = Object.freeze([
  { id: "first-session", name: "First Steps", description: "Complete your first workout.", category: "workouts", rarity: "common", metric: "workouts", target: 1 },
  { id: "ten-sessions", name: "Finding a Rhythm", description: "Complete 10 workouts.", category: "workouts", rarity: "common", metric: "workouts", target: 10 },
  { id: "fifty-sessions", name: "Committed", description: "Complete 50 workouts.", category: "workouts", rarity: "rare", metric: "workouts", target: 50 },
  { id: "hundred-sessions", name: "Century Club", description: "Complete 100 workouts.", category: "workouts", rarity: "epic", metric: "workouts", target: 100 },
  { id: "hundred-reps", name: "Getting Stronger", description: "Log 100 total reps.", category: "strength", rarity: "common", metric: "reps", target: 100 },
  { id: "thousand-reps", name: "Rep Machine", description: "Log 1,000 total reps.", category: "strength", rarity: "rare", metric: "reps", target: 1000 },
  { id: "ten-thousand-reps", name: "Powerhouse", description: "Log 10,000 total reps.", category: "strength", rarity: "epic", metric: "reps", target: 10000 },
  { id: "one-hour", name: "An Hour In", description: "Log 60 workout minutes.", category: "time", rarity: "common", metric: "durationMinutes", target: 60 },
  { id: "ten-hours", name: "Time Well Spent", description: "Log 600 workout minutes.", category: "time", rarity: "rare", metric: "durationMinutes", target: 600 },
  { id: "ten-thousand-steps", name: "Step by Step", description: "Log 10,000 steps.", category: "activity", rarity: "common", metric: "steps", target: 10000 },
  { id: "hundred-thousand-steps", name: "On the Move", description: "Log 100,000 steps.", category: "activity", rarity: "rare", metric: "steps", target: 100000 },
  { id: "one-kilometer", name: "First Kilometer", description: "Cover 1 kilometer.", category: "distance", rarity: "common", metric: "distanceMeters", target: 1000 },
  { id: "marathon-distance", name: "Marathon Miles", description: "Cover 42.195 kilometers.", category: "distance", rarity: "legendary", metric: "distanceMeters", target: 42195 },
  { id: "three-day-streak", name: "Three in a Row", description: "Build a 3-day workout streak.", category: "consistency", rarity: "common", metric: "longestStreak", target: 3 },
  { id: "seven-day-streak", name: "Week of Wins", description: "Build a 7-day workout streak.", category: "consistency", rarity: "rare", metric: "longestStreak", target: 7 },
  { id: "thirty-day-streak", name: "Unstoppable Month", description: "Build a 30-day workout streak.", category: "consistency", rarity: "legendary", metric: "longestStreak", target: 30 }
].map((item) => Object.freeze(item)));

function positiveNumber(value) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function parseDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
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

function keyFor(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addDays(date, amount) {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  result.setDate(result.getDate() + amount);
  return result;
}

function normalize(entry) {
  const source = entry && typeof entry === "object" ? entry : {};
  const date = parseDate(source.date);
  return {
    exercise: typeof source.exercise === "string" ? source.exercise.trim() : "",
    sets: positiveNumber(source.sets),
    reps: positiveNumber(source.reps),
    duration: positiveNumber(source.duration),
    mode: typeof source.mode === "string" ? source.mode.trim().toLowerCase() : "",
    date: date ? date.toISOString() : "",
    steps: positiveNumber(source.steps),
    distanceMeters: positiveNumber(source.distanceMeters)
  };
}

function metricsFor(workouts, asOfDate) {
  const entries = Array.isArray(workouts) ? workouts.map(normalize) : [];
  const activeDays = [...new Set(entries.map((item) => {
    const date = parseDate(item.date);
    return date ? keyFor(date) : "";
  }).filter(Boolean))].sort();
  let totalReps = 0;
  let durationMinutes = 0;
  let steps = 0;
  let distanceMeters = 0;
  for (const item of entries) {
    if (item.mode !== "activity") totalReps += item.sets * item.reps;
    durationMinutes += item.duration;
    steps += item.steps;
    distanceMeters += item.distanceMeters;
  }

  let longestStreak = 0;
  let streak = 0;
  let previous = null;
  for (const key of activeDays) {
    const date = parseDate(key);
    streak = previous && keyFor(addDays(previous, 1)) === key ? streak + 1 : 1;
    longestStreak = Math.max(longestStreak, streak);
    previous = date;
  }
  const asOf = parseDate(asOfDate) || new Date();
  const today = new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate());
  const active = new Set(activeDays);
  let cursor = active.has(keyFor(today)) ? keyFor(today) :
    (active.has(keyFor(addDays(today, -1))) ? keyFor(addDays(today, -1)) : "");
  let currentStreak = 0;
  while (cursor && active.has(cursor)) {
    currentStreak += 1;
    cursor = keyFor(addDays(parseDate(cursor), -1));
  }

  return {
    workouts: entries.length,
    reps: totalReps,
    durationMinutes,
    steps,
    distanceMeters,
    longestStreak,
    currentStreak
  };
}

/**
 * Return the full permanent catalog with current progress and unlock metadata.
 *
 * @param {Array} workouts Workout history.
 * @param {Array} previousAchievements Previously persisted catalog entries.
 * @param {{now?: string|Date, asOfDate?: string|Date}} options
 * @returns {Array} Fresh catalog entries; the input arrays are not mutated.
 */
export function getAchievements(workouts, previousAchievements = [], { now, asOfDate } = {}) {
  const metrics = metricsFor(workouts, asOfDate);
  const previous = new Map(
    (Array.isArray(previousAchievements) ? previousAchievements : [])
      .filter((entry) => entry && typeof entry.id === "string")
      .map((entry) => [entry.id, entry])
  );
  const observedAt = parseDate(now) || new Date();
  const observedAtText = observedAt.toISOString();

  return ACHIEVEMENT_CATALOG.map((achievement) => {
    const prior = previous.get(achievement.id);
    const progress = metrics[achievement.metric] || 0;
    const previouslyUnlocked = Boolean(prior && (prior.unlocked || prior.unlockedAt));
    const unlocked = previouslyUnlocked || progress >= achievement.target;
    const unlockedAt = previouslyUnlocked
      ? (typeof prior.unlockedAt === "string" ? prior.unlockedAt : observedAtText)
      : (unlocked ? observedAtText : null);
    return {
      ...achievement,
      progress: Math.min(progress, achievement.target),
      progressValue: progress,
      unlocked,
      locked: !unlocked,
      unlockedAt
    };
  });
}

