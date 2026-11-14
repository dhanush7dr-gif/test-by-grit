export const STORAGE_KEYS = {
  workouts: "gritcore-workouts-v1",
  profile: "gritcore-profile-v1",
  achievements: "gritcore-achievements-v1",
  quoteHistory: "gritcore-quote-history-v1",
  settings: "gritcore-settings-v1"
};

export const EXERCISES = [
  "Push-ups", "Wide push-ups", "Diamond push-ups", "Knee push-ups",
  "Incline push-ups", "Decline push-ups", "Pike push-ups", "Sit-ups",
  "Crunches", "Bicycle crunches", "Squats", "Reverse lunges", "Glute bridges",
  "Calf raises", "Plank", "Side plank", "Mountain climbers", "Jumping jacks",
  "Burpees", "High knees", "Wall sit", "Yoga or stretching",
  "Walking or running", "Custom activity"
];

export const ICONS = {
  "Push-ups": "↗", "Wide push-ups": "↗", "Diamond push-ups": "↗",
  "Knee push-ups": "↗", "Incline push-ups": "↗", "Decline push-ups": "↗",
  "Pike push-ups": "↗", "Sit-ups": "⌁", "Crunches": "⌁",
  "Bicycle crunches": "⌁", "Squats": "⌖", "Reverse lunges": "⌖",
  "Glute bridges": "⌖", "Calf raises": "⌖", "Plank": "◒", "Side plank": "◒",
  "Mountain climbers": "↟", "Jumping jacks": "✳", "Burpees": "↟",
  "High knees": "↟", "Wall sit": "◒", "Yoga or stretching": "✧",
  "Walking or running": "➜", "Walking": "➜", "Running": "➜"
};

export const DEFAULT_PROFILE = {
  name: "",
  age: null,
  weight: null,
  height: null,
  weeklyGoal: 3,
  dailyStepGoal: 7000,
  weeklyDistanceGoalKm: 10,
  weeklyDurationGoalMinutes: 150,
  streakGoalDays: 7,
  targetWeight: null,
  focus: "general",
  skillLevel: "beginner",
  preferredStyle: "balanced",
  preferredActivities: [],
  weightHistory: [],
  bodyMetrics: [],
  goalHistory: []
};

function readStorage(key, fallback) {
  try {
    const stored = localStorage.getItem(key);
    return stored === null ? fallback : JSON.parse(stored);
  } catch (error) {
    console.error(`Could not read saved app data (${key}).`, error);
    return fallback;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.error(`Could not save app data (${key}).`, error);
    return false;
  }
}

const savedWorkouts = readStorage(STORAGE_KEYS.workouts, []);
const savedProfile = readStorage(STORAGE_KEYS.profile, {});

export const state = {
  workouts: Array.isArray(savedWorkouts) ? savedWorkouts : [],
  profile: { ...DEFAULT_PROFILE, ...(savedProfile && typeof savedProfile === "object" ? savedProfile : {}) },
  achievements: readStorage(STORAGE_KEYS.achievements, []),
  quoteHistory: readStorage(STORAGE_KEYS.quoteHistory, { displayedIds: [], lastDate: "" }),
  settings: readStorage(STORAGE_KEYS.settings, { theme: "auto", weatherTheme: false })
};

function notifyDataChanged() {
  window.dispatchEvent(new CustomEvent("gritcore:datachange"));
}

export function persistWorkouts() {
  return writeStorage(STORAGE_KEYS.workouts, state.workouts);
}

export function persistAchievements() {
  return writeStorage(STORAGE_KEYS.achievements, state.achievements);
}

export function persistQuoteHistory() {
  return writeStorage(STORAGE_KEYS.quoteHistory, state.quoteHistory);
}

export function persistSettings() {
  return writeStorage(STORAGE_KEYS.settings, state.settings);
}

export function addWorkout(entry) {
  const record = {
    id: entry.id || globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    exercise: String(entry.exercise || "Workout"),
    sets: Math.max(0, Number(entry.sets) || 0),
    reps: Math.max(0, Number(entry.reps) || 0),
    duration: Math.max(0, Number(entry.duration) || 0),
    notes: String(entry.notes || "").trim(),
    mode: entry.mode === "activity" ? "activity" : entry.mode === "camera" ? "camera" : "manual",
    date: entry.date || new Date().toISOString()
  };
  if (record.mode === "activity") {
    record.steps = Math.max(0, Number(entry.steps) || 0);
    record.distanceMeters = Math.max(0, Number(entry.distanceMeters) || 0);
    if (Number.isFinite(Number(entry.averageSpeedKmh))) record.averageSpeedKmh = Number(entry.averageSpeedKmh);
    if (Number.isFinite(Number(entry.averagePaceSecondsPerKm))) record.averagePaceSecondsPerKm = Number(entry.averagePaceSecondsPerKm);
    if (Number.isFinite(Number(entry.cadenceStepsPerMinute))) record.cadenceStepsPerMinute = Number(entry.cadenceStepsPerMinute);
  }
  state.workouts = [record, ...state.workouts];
  if (!persistWorkouts()) {
    state.workouts.shift();
    return false;
  }
  notifyDataChanged();
  return true;
}

export function deleteWorkout(id) {
  const previous = state.workouts;
  state.workouts = previous.filter((entry) => entry.id !== id);
  if (state.workouts.length === previous.length) return false;
  if (!persistWorkouts()) {
    state.workouts = previous;
    return false;
  }
  notifyDataChanged();
  return true;
}

export function saveProfile(nextProfile) {
  const previous = state.profile;
  const next = { ...previous, ...nextProfile };
  const today = new Date().toISOString().slice(0, 10);
  const weightHistory = Array.isArray(previous.weightHistory) ? [...previous.weightHistory] : [];
  const bodyMetrics = Array.isArray(previous.bodyMetrics) ? [...previous.bodyMetrics] : [];
  if (next.weight !== null && next.weight !== "" && Number.isFinite(Number(next.weight)) &&
    Number(next.weight) !== Number(previous.weight)) {
    const record = { date: today, weightKg: Number(next.weight) };
    if (weightHistory[weightHistory.length - 1]?.date === today) weightHistory[weightHistory.length - 1] = record;
    else weightHistory.push(record);
  }
  const heightCm = Number(next.height);
  const weightKg = Number(next.weight);
  if (heightCm > 0 && weightKg > 0 && Number.isFinite(heightCm) && Number.isFinite(weightKg)) {
    const record = {
      date: today,
      weightKg,
      heightCm,
      bmi: Number((weightKg / (heightCm / 100) ** 2).toFixed(1))
    };
    if (bodyMetrics[bodyMetrics.length - 1]?.date === today) bodyMetrics[bodyMetrics.length - 1] = record;
    else if (heightCm !== Number(previous.height) || weightKg !== Number(previous.weight)) bodyMetrics.push(record);
  }

  const goalHistory = Array.isArray(previous.goalHistory) ? [...previous.goalHistory] : [];
  const goalKeys = ["weeklyGoal", "dailyStepGoal", "weeklyDistanceGoalKm", "weeklyDurationGoalMinutes", "streakGoalDays"];
  if (goalKeys.some((key) => Number(next[key]) !== Number(previous[key]))) {
    goalHistory.push({
      date: new Date().toISOString(),
      goals: Object.fromEntries(goalKeys.map((key) => [key, Number(next[key]) || 0]))
    });
  }
  state.profile = { ...next, weightHistory, bodyMetrics, goalHistory };
  if (!writeStorage(STORAGE_KEYS.profile, state.profile)) {
    state.profile = previous;
    return false;
  }
  notifyDataChanged();
  return true;
}

export function saveAchievements(next) {
  const previous = state.achievements;
  state.achievements = next;
  if (!persistAchievements()) {
    state.achievements = previous;
    return false;
  }
  notifyDataChanged();
  return true;
}

export function saveQuoteHistory(next) {
  const previous = state.quoteHistory;
  state.quoteHistory = next;
  if (persistQuoteHistory()) return true;
  state.quoteHistory = previous;
  return false;
}

export function saveSettings(next) {
  const previous = state.settings;
  state.settings = { ...previous, ...next };
  if (!persistSettings()) {
    state.settings = previous;
    return false;
  }
  return true;
}

export function createBackup() {
  return {
    app: "GRITCORE",
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    workouts: state.workouts,
    profile: state.profile,
    achievements: state.achievements,
    quoteHistory: state.quoteHistory,
    settings: state.settings
  };
}

export function restoreBackup(data) {
  if (!data || data.app !== "GRITCORE" || !Array.isArray(data.workouts) ||
    !data.profile || typeof data.profile !== "object" ||
    data.workouts.some((entry) => !entry || typeof entry !== "object" ||
      typeof entry.exercise !== "string" || !Number.isFinite(new Date(entry.date).getTime()))) {
    return { ok: false, error: "This file is not a valid GRITCORE backup." };
  }
  const previous = { ...state };
  const previousRaw = {};
  try {
    for (const key of Object.values(STORAGE_KEYS)) previousRaw[key] = localStorage.getItem(key);
  } catch (error) {
    console.error("Could not read existing data before restoring a backup.", error);
    return { ok: false, error: "Existing data could not be protected before restore." };
  }
  state.workouts = data.workouts;
  state.profile = { ...DEFAULT_PROFILE, ...data.profile };
  state.achievements = Array.isArray(data.achievements) ? data.achievements : [];
  state.quoteHistory = data.quoteHistory && typeof data.quoteHistory === "object"
    ? data.quoteHistory
    : { displayedIds: [], lastDate: "" };
  state.settings = data.settings && typeof data.settings === "object"
    ? data.settings
    : { theme: "auto", weatherTheme: false };
  if (!persistWorkouts() || !writeStorage(STORAGE_KEYS.profile, state.profile) ||
    !persistAchievements() || !persistQuoteHistory() || !persistSettings()) {
    Object.assign(state, previous);
    try {
      for (const [key, value] of Object.entries(previousRaw)) {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      }
    } catch (error) {
      console.error("Could not roll back partially restored browser data.", error);
    }
    return { ok: false, error: "The backup could not be saved. Check available browser storage." };
  }
  notifyDataChanged();
  return { ok: true };
}

export function clearAllStoredData() {
  const previous = createBackup();
  try {
    Object.values(STORAGE_KEYS).forEach((key) => localStorage.removeItem(key));
  } catch (error) {
    console.error("Could not clear app data.", error);
    restoreBackup(previous);
    return false;
  }
  state.workouts = [];
  state.profile = { ...DEFAULT_PROFILE };
  state.achievements = [];
  state.quoteHistory = { displayedIds: [], lastDate: "" };
  state.settings = { theme: "auto", weatherTheme: false };
  notifyDataChanged();
  return true;
}

export function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
