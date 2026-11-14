import { saveSettings, saveQuoteHistory, state } from "./storage.js";
import { getRecords } from "./records.js";

const FALLBACK_QUOTES = [
  { id: "fallback-welcome", text: "A strong beginning can be as small as showing up today.", category: "welcome" },
  { id: "fallback-workout", text: "Train with purpose; leave enough in reserve to return tomorrow.", category: "workout" },
  { id: "fallback-comeback", text: "Return without shame. Begin again with what you have today.", category: "comeback" }
];

const KIND_LABELS = {
  welcome: "Welcome",
  workout: "Daily counsel",
  comeback: "A fresh start",
  achievement: "Honor earned",
  record: "A new standard",
  strength: "Strength",
  endurance: "Endurance",
  mobility: "Mobility",
  consistency: "Consistency"
};

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function validQuotes(value) {
  return Array.isArray(value) && value.length > 0 &&
    value.every((quote) => quote && typeof quote.id === "string" &&
      typeof quote.text === "string" && typeof quote.category === "string");
}

function categoryForToday() {
  if (!state.workouts.length) return "welcome";
  const latest = state.workouts.reduce((best, item) =>
    !best || new Date(item.date) > new Date(best.date) ? item : best, null);
  const latestDate = latest ? new Date(latest.date) : null;
  const daysSinceWorkout = latestDate && Number.isFinite(latestDate.getTime())
    ? Math.floor((new Date().setHours(0, 0, 0, 0) - latestDate.setHours(0, 0, 0, 0)) / 86400000)
    : Infinity;
  if (daysSinceWorkout >= 3) return "comeback";
  const today = localDateKey();
  if (state.achievements.some((item) => item?.unlockedAt?.slice(0, 10) === today)) return "achievement";
  const records = getRecords(state.workouts);
  if (Object.values(records).some((record) => record?.workout?.date?.slice(0, 10) === today)) return "record";
  const focus = state.profile.focus;
  if (["strength", "endurance", "mobility", "consistency"].includes(focus)) return `goal-${focus}`;
  if (state.workouts.some((item) => item.mode === "activity" && item.distanceMeters > 0)) return "endurance";
  return "workout";
}

function chooseQuote(quotes, category) {
  const history = state.quoteHistory && typeof state.quoteHistory === "object"
    ? state.quoteHistory
    : { cycleIds: [], history: [], lastDate: "", lastQuoteId: "" };
  const today = localDateKey();
  const lastEntry = Array.isArray(history.history)
    ? [...history.history].reverse().find((entry) => entry.date === today)
    : null;
  const existingId = lastEntry?.id || (history.lastDate === today ? history.lastQuoteId : "");
  const sameDayQuote = quotes.find((quote) => quote.id === existingId);
  if (sameDayQuote) return sameDayQuote;

  const cycleIds = Array.isArray(history.cycleIds) ? history.cycleIds : [];
  let unused = quotes.filter((quote) => !cycleIds.includes(quote.id));
  let nextCycle = cycleIds;
  if (!unused.length) {
    unused = [...quotes];
    nextCycle = [];
  }
  const preferred = category.startsWith("goal-") ? category : category;
  const matching = unused.filter((quote) => quote.category === preferred);
  const pool = matching.length ? matching : unused;
  const seed = [...today].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const quote = pool[seed % pool.length];
  const historyItems = Array.isArray(history.history) ? [...history.history] : [];
  const next = {
    cycleIds: [...nextCycle, quote.id],
    history: [...historyItems, { id: quote.id, date: today, category: quote.category }],
    lastDate: today,
    lastQuoteId: quote.id
  };
  if (!saveQuoteHistory(next)) {
    console.error("Could not save the displayed quote history.");
  }
  return quote;
}

async function updateQuoteCollection() {
  const updatedAt = Number(state.settings.quotesUpdatedAt) || 0;
  if (Date.now() - updatedAt < 30 * 24 * 60 * 60 * 1000 && validQuotes(state.settings.quoteCatalog)) {
    return state.settings.quoteCatalog;
  }
  try {
    const response = await fetch("./quotes.json", { cache: "no-cache" });
    if (!response.ok) throw new Error(`Quote catalogue request failed (${response.status}).`);
    const catalogue = await response.json();
    if (!validQuotes(catalogue.quotes)) throw new Error("The quote catalogue has an invalid format.");
    saveSettings({
      quoteCatalog: catalogue.quotes,
      quotesUpdatedAt: Date.now(),
      quoteCatalogueVersion: catalogue.version
    });
    return catalogue.quotes;
  } catch (error) {
    console.info("Using the cached quote collection while offline or when updates are unavailable.", error);
    return validQuotes(state.settings.quoteCatalog) ? state.settings.quoteCatalog : FALLBACK_QUOTES;
  }
}

function displayQuote(quotes) {
  const quote = chooseQuote(quotes, categoryForToday());
  const quoteOutput = document.querySelector("#daily-quote");
  const kindOutput = document.querySelector("#daily-quote-kind");
  if (quoteOutput) quoteOutput.textContent = `“${quote.text}”`;
  if (kindOutput) kindOutput.textContent = KIND_LABELS[quote.category] ||
    (quote.category.startsWith("goal-") ? `${quote.category.slice(5)} focus` : "Daily counsel");
}

export async function initializeQuotes() {
  const quotes = await updateQuoteCollection();
  displayQuote(quotes);
  return () => displayQuote(quotes);
}
