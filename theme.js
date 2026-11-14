import { saveSettings, state } from "./storage.js";

function dayOfYear(date) {
  const start = new Date(date.getFullYear(), 0, 0);
  return Math.floor((date - start) / 86400000);
}

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function seasonFor(date, southernHemisphere = false) {
  const month = date.getMonth();
  let season = month >= 2 && month <= 4 ? "spring"
    : month >= 5 && month <= 7 ? "summer"
      : month >= 8 && month <= 10 ? "autumn" : "winter";
  if (southernHemisphere) {
    season = { spring: "autumn", summer: "winter", autumn: "spring", winter: "summer" }[season];
  }
  return season;
}

function approximateSunTimes(date, latitude, longitude) {
  const declination = 23.44 * Math.PI / 180 *
    Math.sin(2 * Math.PI * (284 + dayOfYear(date)) / 365);
  const latitudeRadians = latitude * Math.PI / 180;
  const cosine = -Math.tan(latitudeRadians) * Math.tan(declination);
  if (cosine <= -1) return { sunrise: 0, sunset: 24 };
  if (cosine >= 1) return { sunrise: 12, sunset: 12 };
  const hourAngle = Math.acos(cosine) * 180 / Math.PI / 15;
  const timezoneOffset = -date.getTimezoneOffset() / 60;
  const solarNoon = 12 - longitude / 15 + timezoneOffset;
  return { sunrise: solarNoon - hourAngle, sunset: solarNoon + hourAngle };
}

function weatherCategory(code) {
  if (code === 0 || code === 1) return "clear";
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99].includes(code)) return "rain";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "snow";
  return "cloud";
}

function applyTheme() {
  const now = new Date();
  const settings = state.settings;
  const sun = settings.sunDate === localDateKey(now)
    ? settings
    : { sunrise: 6, sunset: 18 };
  const hour = now.getHours() + now.getMinutes() / 60;
  const night = hour < Number(sun.sunrise || 6) || hour >= Number(sun.sunset || 18);
  const autoDark = settings.theme === "auto" && (hour < 6 || hour >= 20);
  document.body.dataset.season = seasonFor(now, Boolean(settings.southernHemisphere));
  document.body.dataset.time = night ? "night" : "day";
  document.body.dataset.weather = settings.weatherTheme && Number.isFinite(Number(settings.weatherCode))
    ? weatherCategory(Number(settings.weatherCode))
    : "none";
  document.body.dataset.theme = settings.theme === "dark" || autoDark ? "dark" : "light";
  const button = document.querySelector("#theme-toggle");
  if (button) {
    button.textContent = settings.theme === "auto" ? "Theme: auto" : `Theme: ${settings.theme}`;
    button.setAttribute("aria-label", `Current theme ${settings.theme}. Activate to change theme.`);
  }
  const weatherButton = document.querySelector("#weather-opt-in");
  if (weatherButton) weatherButton.textContent = settings.weatherTheme
    ? "Refresh optional local-weather theme"
    : "Enable optional local-weather theme";
}

function requestLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("This browser does not support location access."));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      maximumAge: 60 * 60 * 1000,
      timeout: 12000
    });
  });
}

async function updateLocalWeather(notify) {
  const button = document.querySelector("#weather-opt-in");
  if (!window.isSecureContext) {
    notify("Location-based weather requires HTTPS or localhost.", "error");
    return;
  }
  if (button) button.disabled = true;
  try {
    const position = await requestLocation();
    const latitude = position.coords.latitude;
    const longitude = position.coords.longitude;
    const endpoint = new URL("https://api.open-meteo.com/v1/forecast");
    endpoint.search = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      current: "weather_code",
      timezone: "auto"
    });
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    let response;
    try {
      response = await fetch(endpoint, { signal: controller.signal });
    } finally {
      window.clearTimeout(timeout);
    }
    if (!response.ok) throw new Error(`Weather request failed (${response.status}).`);
    const forecast = await response.json();
    const code = Number(forecast.current?.weather_code);
    if (!Number.isInteger(code)) throw new Error("The weather service returned an invalid response.");
    const sun = approximateSunTimes(new Date(), latitude, longitude);
    if (!saveSettings({
      weatherTheme: true,
      weatherCode: code,
      weatherDate: localDateKey(),
      sunDate: localDateKey(),
      sunrise: sun.sunrise,
      sunset: sun.sunset,
      southernHemisphere: latitude < 0
    })) {
      notify("Weather theme settings could not be saved.", "error");
      return;
    }
    applyTheme();
    notify("Local-weather theme updated. Your coordinates were not saved.", "success");
  } catch (error) {
    console.error("Could not update the optional local-weather theme.", error);
    notify(error.code === 1
      ? "Location permission was denied. Allow it in your browser settings to use weather themes."
      : "Could not update the weather theme. The time- and season-based theme remains available.", "error");
  } finally {
    if (button) button.disabled = false;
  }
}

export function initializeTheme({ notify = () => {} } = {}) {
  document.querySelector("#theme-toggle")?.addEventListener("click", () => {
    const modes = ["auto", "dark", "light"];
    const currentIndex = modes.indexOf(state.settings.theme);
    const next = modes[(currentIndex + 1) % modes.length];
    if (!saveSettings({ theme: next })) {
      notify("Theme preference could not be saved.", "error");
      return;
    }
    applyTheme();
  });
  document.querySelector("#weather-opt-in")?.addEventListener("click", () => updateLocalWeather(notify));
  applyTheme();
  window.setInterval(applyTheme, 30 * 60 * 1000);
  window.addEventListener("gritcore:datachange", applyTheme);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) applyTheme();
  });
}
