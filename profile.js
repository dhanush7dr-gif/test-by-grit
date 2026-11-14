import {
  clearAllStoredData,
  createBackup,
  downloadFile,
  restoreBackup,
  saveProfile,
  state
} from "./storage.js";

function numberValue(selector) {
  const raw = document.querySelector(selector)?.value ?? "";
  return raw === "" ? null : Number(raw);
}

function formatDay(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Date unavailable"
    : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function renderLog(container, records, format) {
  if (!container) return;
  const recent = [...records].slice(-12).reverse();
  if (!recent.length) {
    const empty = document.createElement("span");
    empty.className = "muted small";
    empty.textContent = "No check-ins recorded yet.";
    container.replaceChildren(empty);
    return;
  }
  container.replaceChildren(...recent.map((record) => {
    const row = document.createElement("div");
    row.className = "weight-row";
    const day = document.createElement("span");
    day.textContent = formatDay(record.date);
    const value = document.createElement("strong");
    value.textContent = format(record);
    row.append(day, value);
    return row;
  }));
}

export function renderProfile() {
  const profile = state.profile;
  const fields = {
    "#profile-name": profile.name || "",
    "#profile-age": profile.age ?? "",
    "#profile-weight": profile.weight ?? "",
    "#profile-height": profile.height ?? "",
    "#profile-target-weight": profile.targetWeight ?? "",
    "#profile-goal": profile.weeklyGoal || 3,
    "#profile-goal-steps": profile.dailyStepGoal || 7000,
    "#profile-goal-distance": profile.weeklyDistanceGoalKm || 10,
    "#profile-goal-duration": profile.weeklyDurationGoalMinutes || 150,
    "#profile-goal-streak": profile.streakGoalDays || 7,
    "#profile-focus": profile.focus || "general",
    "#profile-skill": profile.skillLevel || "beginner",
    "#profile-style": profile.preferredStyle || "balanced"
  };
  for (const [selector, value] of Object.entries(fields)) {
    const input = document.querySelector(selector);
    if (input) input.value = String(value);
  }
  const activities = document.querySelector("#profile-activities");
  if (activities) {
    const preferred = new Set(Array.isArray(profile.preferredActivities) ? profile.preferredActivities : []);
    for (const option of activities.options) option.selected = preferred.has(option.value);
  }
  const heightInMeters = Number(profile.height) / 100;
  const weight = Number(profile.weight);
  const validMetrics = heightInMeters > 0 && weight > 0 &&
    Number.isFinite(heightInMeters) && Number.isFinite(weight);
  const bmi = validMetrics ? weight / (heightInMeters * heightInMeters) : 0;
  const bmiValue = document.querySelector("#bmi-value");
  const bmiCaption = document.querySelector("#bmi-caption");
  if (bmiValue) bmiValue.textContent = validMetrics ? bmi.toFixed(1) : "—";
  if (bmiCaption) bmiCaption.textContent = validMetrics
    ? `Current estimate · target weight ${profile.targetWeight ? `${profile.targetWeight} kg` : "not set"}`
    : "Add height and weight to see an optional BMI estimate.";
  const weightGoal = document.querySelector("#weight-goal-progress");
  if (weightGoal) {
    weightGoal.replaceChildren();
    const targetWeight = Number(profile.targetWeight);
    if (validMetrics && targetWeight > 0) {
      const history = Array.isArray(profile.weightHistory) ? profile.weightHistory : [];
      const baseline = Number(history[0]?.weightKg || weight);
      const difference = targetWeight - baseline;
      const progressValue = difference === 0 ? 100 : (weight - baseline) / difference * 100;
      const percent = Math.max(0, Math.min(100, progressValue));
      const label = document.createElement("p");
      label.className = "muted small";
      label.textContent = `Weight goal: ${weight.toFixed(1)} / ${targetWeight.toFixed(1)} kg · ${Math.round(percent)}% from baseline`;
      const bar = document.createElement("div");
      bar.className = "goal-bar";
      bar.setAttribute("role", "progressbar");
      bar.setAttribute("aria-label", "Weight goal progress");
      bar.setAttribute("aria-valuemin", "0");
      bar.setAttribute("aria-valuemax", "100");
      bar.setAttribute("aria-valuenow", String(Math.round(percent)));
      const fill = document.createElement("span");
      fill.style.width = `${percent}%`;
      bar.append(fill);
      weightGoal.append(label, bar);
    } else {
      const hint = document.createElement("p");
      hint.className = "muted small";
      hint.textContent = "Set a current and target weight to track this optional goal.";
      weightGoal.append(hint);
    }
  }
  renderLog(
    document.querySelector("#weight-history"),
    Array.isArray(profile.weightHistory) ? profile.weightHistory : [],
    (record) => `${Number(record.weightKg).toFixed(1)} kg`
  );
  renderLog(
    document.querySelector("#body-metrics-history"),
    Array.isArray(profile.bodyMetrics) ? profile.bodyMetrics : [],
    (record) => `BMI ${Number(record.bmi).toFixed(1)} · ${Number(record.weightKg).toFixed(1)} kg`
  );
  renderLog(
    document.querySelector("#goal-history"),
    Array.isArray(profile.goalHistory) ? profile.goalHistory : [],
    (record) => `${record.goals?.weeklyGoal ?? 0} sessions/week · ${record.goals?.dailyStepGoal ?? 0} steps/day`
  );
}

function csvCell(value) {
  let text = String(value ?? "");
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function exportWorkoutsCsv() {
  const columns = ["date", "exercise", "mode", "sets", "repsPerSet", "durationMinutes", "steps", "distanceMeters", "averageSpeedKmh", "averagePaceSecondsPerKm", "cadenceStepsPerMinute", "notes"];
  const rows = state.workouts.map((entry) => [
    entry.date,
    entry.exercise,
    entry.mode,
    entry.sets,
    entry.reps,
    entry.duration,
    entry.steps,
    entry.distanceMeters,
    entry.averageSpeedKmh,
    entry.averagePaceSecondsPerKm,
    entry.cadenceStepsPerMinute,
    entry.notes
  ]);
  const csv = [columns, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
  downloadFile("gritcore-workouts.csv", csv, "text/csv;charset=utf-8");
}

function exportAchievements() {
  const history = Array.isArray(state.achievements) ? state.achievements : [];
  downloadFile(
    "gritcore-achievements.json",
    JSON.stringify({ app: "GRITCORE", exportedAt: new Date().toISOString(), achievements: history }, null, 2),
    "application/json"
  );
}

export function initializeProfile({ notify = () => {} } = {}) {
  renderProfile();
  document.querySelector("#profile-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const weeklyGoal = numberValue("#profile-goal");
    const dailyStepGoal = numberValue("#profile-goal-steps");
    const weeklyDistanceGoalKm = numberValue("#profile-goal-distance");
    const weeklyDurationGoalMinutes = numberValue("#profile-goal-duration");
    const streakGoalDays = numberValue("#profile-goal-streak");
    if (![weeklyGoal, dailyStepGoal, weeklyDistanceGoalKm, weeklyDurationGoalMinutes, streakGoalDays]
      .every((value) => Number.isFinite(value) && value > 0)) {
      notify("Check your goal values and try saving again.", "error");
      return;
    }
    if (!Number.isInteger(weeklyGoal) || !Number.isInteger(streakGoalDays) || weeklyGoal < 1 ||
      weeklyGoal > 14 || streakGoalDays < 1 || streakGoalDays > 365) {
      notify("Weekly workout and streak goals must be whole numbers within the allowed range.", "error");
      return;
    }
    const preferredActivities = [...(document.querySelector("#profile-activities")?.selectedOptions || [])]
      .map((option) => option.value);
    const next = {
      name: document.querySelector("#profile-name").value.trim(),
      age: numberValue("#profile-age"),
      weight: numberValue("#profile-weight"),
      height: numberValue("#profile-height"),
      targetWeight: numberValue("#profile-target-weight"),
      weeklyGoal,
      dailyStepGoal,
      weeklyDistanceGoalKm,
      weeklyDurationGoalMinutes,
      streakGoalDays,
      focus: document.querySelector("#profile-focus").value,
      skillLevel: document.querySelector("#profile-skill").value,
      preferredStyle: document.querySelector("#profile-style").value,
      preferredActivities
    };
    if (!saveProfile(next)) {
      notify("Profile could not be saved. Check available browser storage.", "error");
      return;
    }
    renderProfile();
    notify("Profile and fitness goals saved on this device.", "success");
  });

  document.querySelector("#export-json")?.addEventListener("click", () => {
    downloadFile(
      "gritcore-backup.json",
      JSON.stringify(createBackup(), null, 2),
      "application/json"
    );
    notify("Workout and profile backup downloaded.", "success");
  });
  document.querySelector("#export-csv")?.addEventListener("click", () => {
    exportWorkoutsCsv();
    notify("Workout CSV downloaded.", "success");
  });
  document.querySelector("#export-achievements")?.addEventListener("click", () => {
    exportAchievements();
    notify("Achievement history downloaded.", "success");
  });
  document.querySelector("#import-backup")?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!window.confirm("Restore this backup? It will replace workout, profile, achievement, quote, and theme data on this device.")) {
        event.target.value = "";
        return;
      }
      const result = restoreBackup(data);
      if (!result.ok) {
        notify(result.error, "error");
        return;
      }
      renderProfile();
      notify("Backup restored successfully.", "success");
    } catch (error) {
      console.error("Could not read the selected GRITCORE backup.", error);
      notify("That backup file could not be read as valid JSON.", "error");
    } finally {
      event.target.value = "";
    }
  });
  document.querySelector("#clear-data")?.addEventListener("click", () => {
    if (!window.confirm("Clear all workout history, profile details, achievements, quotes, and settings from this browser? This cannot be undone.")) return;
    if (!clearAllStoredData()) {
      notify("The browser could not clear app data.", "error");
      return;
    }
    renderProfile();
    notify("All GRITCORE data was cleared from this device.", "success");
  });
}
