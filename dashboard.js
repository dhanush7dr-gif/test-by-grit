import { addWorkout, deleteWorkout, EXERCISES, ICONS, saveAchievements, state } from "./storage.js";
import { aggregateWorkouts, consistency, dailySeries, getDateRange } from "./analytics.js";
import { getRecords } from "./records.js";
import { getAchievements } from "./achievements.js";

const RANGE_LABELS = {
  today: "today",
  week: "this week",
  month: "this month",
  year: "this year",
  lifetime: "all time"
};

function setText(selector, value) {
  const element = document.querySelector(selector);
  if (element) element.textContent = String(value);
}

function activeRange(selector, fallback) {
  return document.querySelector(`${selector}.active`)?.dataset.range ||
    document.querySelector(`${selector}.active`)?.dataset.progressRange || fallback;
}

function targetScale(period) {
  if (period === "today") return 1 / 7;
  if (period === "week") return 1;
  if (period === "month") return 4.35;
  if (period === "year") return 52;
  return 0;
}

function targetFor(period) {
  const scale = targetScale(period);
  if (!scale) return null;
  return Math.max(1, Math.round(Number(state.profile.weeklyGoal || 3) * scale));
}

function calculateGoalRate(period, totals) {
  let workoutTarget;
  let stepsTarget;
  let distanceTarget;
  let durationTarget;
  if (period === "lifetime") {
    const dates = state.workouts.map((entry) => new Date(entry.date).getTime())
      .filter(Number.isFinite);
    if (!dates.length) return 0;
    const days = Math.max(1, Math.ceil((Date.now() - Math.min(...dates)) / 86400000) + 1);
    const weeks = Math.max(1, days / 7);
    workoutTarget = Number(state.profile.weeklyGoal ?? 3) * weeks;
    stepsTarget = Number(state.profile.dailyStepGoal ?? 7000) * days;
    distanceTarget = Number(state.profile.weeklyDistanceGoalKm ?? 10) * weeks;
    durationTarget = Number(state.profile.weeklyDurationGoalMinutes ?? 150) * weeks;
  } else {
    const scale = targetScale(period);
    if (!scale) return 0;
    workoutTarget = Number(state.profile.weeklyGoal ?? 3) * scale;
    stepsTarget = Number(state.profile.dailyStepGoal ?? 7000) * (period === "today" ? 1 : period === "week" ? 7 : scale * 7);
    distanceTarget = Number(state.profile.weeklyDistanceGoalKm ?? 10) * scale;
    durationTarget = Number(state.profile.weeklyDurationGoalMinutes ?? 150) * scale;
  }
  const targets = [
    [totals.workoutCount, Math.max(1, workoutTarget)],
    [totals.steps, Math.max(1, stepsTarget)],
    [totals.distanceMeters / 1000, Math.max(0.1, distanceTarget)],
    [totals.durationMinutes, Math.max(1, durationTarget)]
  ];
  return Math.round(targets.reduce((sum, [value, target]) => sum + Math.min(value / target, 1), 0) /
    targets.length * 100);
}

function formatShortDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Date unavailable"
    : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Date unavailable"
    : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function makeWorkoutRow(entry, shortDate = true) {
  const row = document.createElement("div");
  row.className = "workout-row";
  const dot = document.createElement("span");
  dot.className = "workout-dot";
  dot.setAttribute("aria-hidden", "true");
  dot.textContent = ICONS[entry.exercise] || "✦";

  const copy = document.createElement("div");
  copy.className = "workout-row-copy";
  const title = document.createElement("strong");
  title.textContent = entry.exercise;
  const details = document.createElement("span");
  details.textContent = entry.mode === "activity"
    ? `${Number(entry.steps || 0).toLocaleString()} steps · ${(Number(entry.distanceMeters || 0) / 1000).toFixed(2)} km`
    : `${entry.sets} set${Number(entry.sets) === 1 ? "" : "s"} · ${entry.reps} reps/set${entry.duration ? ` · ${entry.duration} min` : ""}`;
  copy.append(title, details);

  const date = document.createElement("span");
  date.className = "workout-date";
  date.textContent = shortDate ? formatShortDate(entry.date) : formatDate(entry.date);
  row.append(dot, copy, date);
  return row;
}

export function renderDashboard() {
  const period = activeRange(".summary-chip", "today");
  const totals = aggregateWorkouts(state.workouts, { period, weightKg: state.profile.weight });
  const target = targetFor(period);
  const labels = {
    today: { workouts: "Sessions today", reps: "Reps today", minutes: "Minutes today" },
    week: { workouts: "Sessions this week", reps: "Reps this week", minutes: "Minutes this week" },
    month: { workouts: "Sessions this month", reps: "Reps this month", minutes: "Minutes this month" },
    year: { workouts: "Sessions this year", reps: "Reps this year", minutes: "Minutes this year" },
    lifetime: { workouts: "Sessions all time", reps: "Reps all time", minutes: "Minutes all time" }
  }[period] || { workouts: "Sessions today", reps: "Reps today", minutes: "Minutes today" };

  setText("#stat-workouts-label", labels.workouts);
  setText("#stat-reps-label", labels.reps);
  setText("#stat-minutes-label", labels.minutes);
  setText("#stat-goal-label", target === null ? "Workout target" : `${RANGE_LABELS[period]} target`);
  setText("#stat-workouts", totals.workoutCount);
  setText("#stat-reps", totals.reps.toLocaleString());
  setText("#stat-minutes", Math.round(totals.durationMinutes));
  setText("#stat-goal", target ?? "—");
  setText("#goal-progress", target === null
    ? "Set a daily or weekly target in your profile"
    : totals.workoutCount >= target
      ? "Workout goal reached — keep your rhythm"
      : `${target - totals.workoutCount} more to reach this workout goal`);

  const recent = [...state.workouts]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 4);
  const list = document.querySelector("#recent-workouts");
  if (list) list.replaceChildren(...recent.map((entry) => makeWorkoutRow(entry)));
  const empty = document.querySelector("#empty-recent");
  if (empty) empty.hidden = recent.length > 0;

  const { currentStreak } = consistency(state.workouts);
  const recommendation = document.querySelector("#recommendation-copy");
  if (recommendation) recommendation.textContent = recent.length === 0
    ? "Begin with a short, comfortable session; the first entry starts your progress story."
    : currentStreak === 0
      ? "A missed day does not erase your work. Choose one small session to begin again."
      : currentStreak >= Number(state.profile.streakGoalDays || 7)
        ? `Your ${currentStreak}-day streak is strong. Protect your recovery and keep the habit sustainable.`
        : `You have a ${currentStreak}-day streak. A manageable session today keeps the chain alive.`;
  const milestone = getAchievements(state.workouts, state.achievements)
    .filter((item) => !item.unlocked)
    .sort((first, second) =>
        first.progressValue / first.target - second.progressValue / second.target)[0];
  const milestoneText = document.querySelector("#next-milestone");
  if (milestoneText) milestoneText.textContent = milestone
    ? `Next honor: ${milestone.name} — ${milestone.progressValue.toLocaleString()} of ${milestone.target.toLocaleString()}.`
    : "Every current honor is yours. Keep building your own standards.";
}

export function renderHistory(notify = () => {}) {
  const list = document.querySelector("#history-list");
  if (!list) return;
  list.replaceChildren();
  const entries = [...state.workouts].sort((a, b) =>
    new Date(b.date).getTime() - new Date(a.date).getTime());
  const empty = document.querySelector("#empty-history");
  if (empty) empty.hidden = entries.length > 0;
  for (const entry of entries) {
    const row = document.createElement("div");
    row.className = "history-row";
    const main = document.createElement("div");
    main.className = "history-main";
    const dot = document.createElement("span");
    dot.className = "workout-dot";
    dot.setAttribute("aria-hidden", "true");
    dot.textContent = ICONS[entry.exercise] || "✦";
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = entry.exercise;
    const details = document.createElement("span");
    details.textContent = entry.mode === "activity"
      ? `${Number(entry.steps || 0).toLocaleString()} steps · ${(Number(entry.distanceMeters || 0) / 1000).toFixed(2)} km`
      : `${entry.sets} set${Number(entry.sets) === 1 ? "" : "s"} · ${entry.reps} reps/set${entry.mode === "camera" ? " · camera count" : ""}`;
    copy.append(title, details);
    main.append(dot, copy);
    const meta = document.createElement("span");
    meta.className = "history-meta";
    meta.textContent = `${formatDate(entry.date)}${entry.duration ? ` · ${entry.duration} min` : ""}`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "delete-button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Delete ${entry.exercise} workout`);
    remove.addEventListener("click", () => {
      if (!deleteWorkout(entry.id)) notify("The workout could not be deleted.", "error");
    });
    row.append(main, meta, remove);
    if (entry.notes) {
      const note = document.createElement("span");
      note.className = "history-meta";
      note.textContent = entry.notes;
      row.append(note);
    }
    list.append(row);
  }
}

function monthSeries(period) {
  const today = new Date();
  const firstMonth = period === "year" ? 0 : today.getMonth() - 11;
  const yearStart = period === "year" ? today.getFullYear() : today.getFullYear() + Math.floor(firstMonth / 12);
  const monthStart = period === "year" ? 0 : ((firstMonth % 12) + 12) % 12;
  return Array.from({ length: 12 }, (_, index) => {
    const date = new Date(yearStart, monthStart + index, 1);
    const totals = aggregateWorkouts(state.workouts, {
      period: "month",
      date,
      weightKg: state.profile.weight
    });
    return {
      date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`,
      label: new Intl.DateTimeFormat(undefined, { month: "short" }).format(date),
      ...totals
    };
  });
}

function chartSeries(period) {
  if (period === "year" || period === "lifetime") return monthSeries(period);
  const today = new Date();
  if (period === "month") {
    const range = getDateRange("month");
    return dailySeries(state.workouts, {
      startDate: range.startDate,
      endDate: today,
      weightKg: state.profile.weight
    }).map((point) => ({ ...point, label: String(new Date(`${point.date}T12:00:00`).getDate()) }));
  }
  return dailySeries(state.workouts, { days: 7, weightKg: state.profile.weight })
    .map((point) => ({
      ...point,
      label: new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(new Date(`${point.date}T12:00:00`))
    }));
}

function drawProgressChart() {
  const canvas = document.querySelector("#progress-chart");
  if (!canvas) return;
  const metric = document.querySelector("#chart-metric")?.value || "workouts";
  const period = document.querySelector("[data-progress-range].active")?.dataset.progressRange || "week";
  const points = chartSeries(period);
  const values = points.map((point) => {
    if (metric === "workouts") return point.workoutCount;
    if (metric === "distance") return point.distanceMeters / 1000;
    return Number(point[metric] || 0);
  });
  const width = Math.max(1, canvas.clientWidth);
  const height = 240;
  const ratio = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  const padding = { top: 16, right: 12, bottom: 34, left: 36 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maximum = Math.max(1, ...values);
  const darkTheme = document.body.dataset.theme === "dark";
  const textColor = darkTheme ? "#d3bea3" : "#654d34";
  context.font = "11px sans-serif";
  context.textBaseline = "middle";
  context.strokeStyle = darkTheme ? "rgba(222, 187, 149, 0.18)" : "rgba(91, 71, 51, 0.18)";
  context.fillStyle = textColor;
  for (let tick = 0; tick <= 4; tick += 1) {
    const y = padding.top + plotHeight * tick / 4;
    context.beginPath();
    context.moveTo(padding.left, y);
    context.lineTo(width - padding.right, y);
    context.stroke();
    context.fillText(String(Math.round(maximum * (4 - tick) / 4)), 4, y);
  }
  const slot = points.length ? plotWidth / points.length : plotWidth;
  const barWidth = Math.max(2, Math.min(24, slot * 0.62));
  values.forEach((value, index) => {
    const barHeight = value > 0 ? Math.max(2, plotHeight * value / maximum) : 0;
    const x = padding.left + slot * index + (slot - barWidth) / 2;
    const y = padding.top + plotHeight - barHeight;
    context.fillStyle = darkTheme ? "#df9c5e" : "#bd7136";
    context.fillRect(x, y, barWidth, barHeight);
    if (points.length <= 14 || index % Math.ceil(points.length / 10) === 0) {
      context.fillStyle = textColor;
      context.textAlign = "center";
      context.fillText(points[index].label, x + barWidth / 2, height - 12);
    }
  });
  const summary = document.querySelector("#chart-summary");
  if (summary) {
    const total = values.reduce((sum, value) => sum + value, 0);
    const label = metric === "distance" ? "km" : metric;
    summary.textContent = `${total.toFixed(metric === "distance" ? 1 : 0)} ${label} across ${points.length} ${period === "year" || period === "lifetime" ? "months" : "days"}.`;
  }
}

function renderRecords() {
  const container = document.querySelector("#records-list");
  if (!container) return;
  const records = getRecords(state.workouts);
  const labels = [
    ["fastestRun", "Fastest run", (record) => `${record.value} km/h · ${Math.floor(record.paceSecondsPerKm / 60)}:${String(record.paceSecondsPerKm % 60).padStart(2, "0")} /km`],
    ["longestWorkout", "Longest workout", (record) => `${record.value} minutes · ${record.workout.exercise}`],
    ["longestWalk", "Longest walk", (record) => `${(record.value / 1000).toFixed(2)} km`],
    ["maxSteps", "Highest step count", (record) => `${record.value.toLocaleString()} steps`],
    ["mostReps", "Most reps in one workout", (record) => `${record.value.toLocaleString()} reps · ${record.workout.exercise}`],
    ["longestStreak", "Longest streak", (record) => `${record.value} days`],
    ["largestDistance", "Largest distance", (record) => `${(record.value / 1000).toFixed(2)} km`],
    ["mostActiveMonth", "Most active month", (record) => `${record.workoutCount} workouts · ${record.month}`]
  ];
  container.replaceChildren(...labels.map(([key, title, describe]) => {
    const record = records[key];
    const row = document.createElement("div");
    row.className = "record-row";
    const copy = document.createElement("div");
    copy.className = "record-copy";
    const name = document.createElement("strong");
    name.textContent = title;
    const value = document.createElement("span");
    value.textContent = record ? describe(record) : "Not recorded yet";
    copy.append(name, value);
    row.append(copy);
    return row;
  }));
}

function renderGoalProgress() {
  const container = document.querySelector("#goal-progress-list");
  if (!container) return;
  const week = aggregateWorkouts(state.workouts, { period: "week", weightKg: state.profile.weight });
  const today = aggregateWorkouts(state.workouts, { period: "today" });
  const streak = consistency(state.workouts);
  const goals = [
    { label: "Workouts this week", value: week.workoutCount, target: Number(state.profile.weeklyGoal ?? 3), unit: "sessions" },
    { label: "Steps today", value: today.steps, target: Number(state.profile.dailyStepGoal ?? 7000), unit: "steps" },
    { label: "Distance this week", value: week.distanceMeters / 1000, target: Number(state.profile.weeklyDistanceGoalKm ?? 10), unit: "km" },
    { label: "Workout time this week", value: week.durationMinutes, target: Number(state.profile.weeklyDurationGoalMinutes ?? 150), unit: "min" },
    { label: "Current streak", value: streak.currentStreak, target: Number(state.profile.streakGoalDays ?? 7), unit: "days" }
  ];
  container.replaceChildren(...goals.map((goal) => {
    const row = document.createElement("div");
    row.className = "goal-progress";
    const heading = document.createElement("div");
    heading.className = "goal-progress-heading";
    const label = document.createElement("strong");
    label.textContent = goal.label;
    const value = document.createElement("span");
    value.textContent = `${goal.value.toFixed(goal.unit === "km" ? 1 : 0)} / ${goal.target} ${goal.unit}`;
    heading.append(label, value);
    const bar = document.createElement("div");
    bar.className = "goal-bar";
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-label", goal.label);
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", String(goal.target));
    bar.setAttribute("aria-valuenow", String(Math.min(goal.value, goal.target)));
    const fill = document.createElement("span");
    fill.style.width = `${goal.target > 0 ? Math.min(100, goal.value / goal.target * 100) : 0}%`;
    bar.append(fill);
    row.append(heading, bar);
    return row;
  }));
}

function renderAchievements(notify = () => {}, announce = false) {
  const container = document.querySelector("#achievements-list");
  if (!container) return;
  const previouslyUnlocked = new Set((Array.isArray(state.achievements) ? state.achievements : [])
    .filter((item) => item?.unlocked || item?.unlockedAt)
    .map((item) => item.id));
  const next = getAchievements(state.workouts, state.achievements);
  const newlyUnlocked = next.filter((item) => item.unlocked && !previouslyUnlocked.has(item.id));
  if (JSON.stringify(next) !== JSON.stringify(state.achievements)) {
    if (!saveAchievements(next)) notify("Achievement progress could not be saved.", "error");
  }
  container.replaceChildren(...next.map((item) => {
    const card = document.createElement("article");
    card.className = "achievement-card";
    card.dataset.unlocked = String(item.unlocked);
    card.dataset.rarity = item.rarity;
    const badge = document.createElement("span");
    badge.className = "achievement-badge";
    badge.setAttribute("aria-hidden", "true");
    badge.textContent = item.unlocked ? "⚔" : "◇";
    const copy = document.createElement("div");
    copy.className = "achievement-copy";
    const name = document.createElement("strong");
    name.textContent = item.name;
    const detail = document.createElement("span");
    detail.textContent = `${item.description} ${item.progressValue.toLocaleString()} / ${item.target.toLocaleString()} · ${item.rarity}`;
    const progress = document.createElement("div");
    progress.className = "achievement-progress";
    progress.setAttribute("role", "progressbar");
    progress.setAttribute("aria-valuemin", "0");
    progress.setAttribute("aria-valuemax", String(item.target));
    progress.setAttribute("aria-valuenow", String(Math.min(item.progressValue, item.target)));
    const fill = document.createElement("span");
    fill.style.width = `${Math.min(100, item.progressValue / item.target * 100)}%`;
    progress.append(fill);
    copy.append(name, detail, progress);
    card.append(badge, copy);
    return card;
  }));
  if (announce && newlyUnlocked.length) {
    notify(`Achievement unlocked: ${newlyUnlocked[0].name}.`, "success");
  }
}

function renderHeatmap() {
  const container = document.querySelector("#activity-heatmap");
  if (!container) return;
  const days = dailySeries(state.workouts, { days: 84 });
  container.replaceChildren(...days.map((day) => {
    const cell = document.createElement("span");
    const count = day.workoutCount;
    cell.className = "heatmap-day";
    cell.dataset.level = count === 0 ? "0" : count === 1 ? "1" : count <= 3 ? "2" : "3";
    cell.title = `${day.date}: ${count} workout${count === 1 ? "" : "s"}`;
    cell.setAttribute("aria-label", cell.title);
    return cell;
  }));
}

export function renderProgress(notify = () => {}, announce = false) {
  const period = document.querySelector("[data-progress-range].active")?.dataset.progressRange || "week";
  const totals = aggregateWorkouts(state.workouts, {
    period,
    weightKg: state.profile.weight
  });
  const streak = consistency(state.workouts);
  const goalRate = calculateGoalRate(period, totals);
  setText("#analytics-workouts", totals.workoutCount);
  setText("#analytics-sets", totals.sets.toLocaleString());
  setText("#analytics-reps", totals.reps.toLocaleString());
  setText("#analytics-duration", `${Math.round(totals.durationMinutes)} min`);
  setText("#analytics-distance", `${(totals.distanceMeters / 1000).toFixed(2)} km`);
  setText("#analytics-calories", `${Math.round(totals.caloriesEstimate)}*`);
  setText("#analytics-consistency", `${streak.consistencyScore}%`);
  setText("#analytics-goal-rate", `${goalRate}%`);
  setText("#analytics-steps", totals.steps.toLocaleString());
  setText("#analytics-streak", `${streak.currentStreak} days`);
  setText("#analytics-longest-streak", `${streak.longestStreak} days`);
  setText("#analytics-missed-days", streak.missedDays);
  setText("#analytics-calorie-note", totals.calorieLabel);
  renderGoalProgress();
  renderRecords();
  renderAchievements(notify, announce);
  renderHeatmap();
  drawProgressChart();
}

export function initializeDashboard({ showView, notify = () => {} } = {}) {
  const exerciseSelect = document.querySelector("#exercise");
  exerciseSelect?.addEventListener("change", () => {
    const customWrap = document.querySelector("#custom-exercise-wrap");
    if (customWrap) customWrap.hidden = exerciseSelect.value !== "Custom activity";
  });
  if (exerciseSelect && !exerciseSelect.options.length) {
    for (const name of EXERCISES) {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      exerciseSelect.append(option);
    }
  }
  document.querySelectorAll(".summary-chip[data-range]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".summary-chip[data-range]").forEach((item) =>
        item.classList.toggle("active", item === button));
      renderDashboard();
    });
  });
  document.querySelectorAll("[data-progress-range]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-progress-range]").forEach((item) =>
        item.classList.toggle("active", item === button));
      renderProgress(notify);
    });
  });
  document.querySelector("#chart-metric")?.addEventListener("change", drawProgressChart);
  document.querySelectorAll("[data-go-workout], [data-view-link]").forEach((button) => {
    button.addEventListener("click", () => showView(button.dataset.viewLink || "workout"));
  });
  document.querySelectorAll("[data-quick-start]").forEach((button) => {
    button.addEventListener("click", () => {
      if (exerciseSelect) exerciseSelect.value = button.dataset.quickStart;
      showView("workout");
    });
  });
  document.querySelectorAll(".wellness-card").forEach((button) => {
    button.addEventListener("click", () => {
      state.profile.focus = button.dataset.focus;
      const focusSelect = document.querySelector("#profile-focus");
      if (focusSelect) focusSelect.value = button.dataset.focus;
      notify("Focus selected. Save your profile to keep this preference.");
    });
  });
  document.querySelector("#workout-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const selected = exerciseSelect?.value;
    const exercise = selected === "Custom activity"
      ? document.querySelector("#custom-exercise")?.value.trim()
      : selected;
    const sets = Number(document.querySelector("#sets")?.value);
    const reps = Number(document.querySelector("#reps")?.value);
    const duration = Number(document.querySelector("#duration")?.value);
    const notes = document.querySelector("#notes")?.value || "";
    if (!exercise) return notify("Enter a name for your custom activity.", "error");
    if (!Number.isInteger(sets) || sets < 1 || !Number.isInteger(reps) || reps < 0 ||
      !Number.isInteger(duration) || duration < 0 || (reps === 0 && duration === 0)) {
      return notify("Add at least one rep or one minute, and check your sets and values.", "error");
    }
    if (addWorkout({ exercise, sets, reps, duration, notes, mode: "manual" })) {
      event.target.reset();
      document.querySelector("#sets").value = "3";
      document.querySelector("#reps").value = "10";
      document.querySelector("#duration").value = "10";
      document.querySelector("#custom-exercise-wrap").hidden = true;
      showView("dashboard");
      notify(`${exercise} saved to your workout history.`, "success");
    } else {
      notify("The workout could not be saved. Check available browser storage.", "error");
    }
  });
  window.setSummaryRange = (range) => {
    const button = document.querySelector(`.summary-chip[data-range="${CSS.escape(range)}"]`);
    button?.click();
  };
}
