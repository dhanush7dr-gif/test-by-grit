import { initializeDashboard, renderDashboard, renderHistory, renderProgress } from "./dashboard.js";
import { initializeProfile, renderProfile } from "./profile.js";
import { initializeCamera } from "./camera.js";
import { initializeActivity } from "./activity.js";
import { initializeQuotes } from "./quotes.js";
import { initializeTheme } from "./theme.js";

const toast = document.querySelector("#toast");
let toastTimer;
let rendering = false;
let pendingInstallPrompt = null;

function showToast(message, kind = "") {
  if (!toast) return;
  toast.textContent = message;
  toast.classList.toggle("error", kind === "error");
  toast.classList.toggle("success", kind === "success");
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 3600);
}

function showView(name) {
  const allowedViews = ["dashboard", "workout", "progress", "history", "profile"];
  const viewName = allowedViews.includes(name) ? name : "dashboard";
  for (const view of document.querySelectorAll(".view")) {
    const active = view.id === `view-${viewName}`;
    view.classList.toggle("active", active);
    view.hidden = !active;
  }
  for (const button of document.querySelectorAll("[data-view]")) {
    button.classList.toggle("active", button.dataset.view === viewName);
  }
  if (window.location.hash !== `#${viewName}`) {
    window.history.replaceState(null, "", `#${viewName}`);
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (viewName === "progress") renderProgress(showToast);
}

function renderAll(announce = false) {
  if (rendering) return;
  rendering = true;
  try {
    renderDashboard();
    renderHistory(showToast);
    renderProfile();
    renderProgress(showToast, announce);
  } finally {
    rendering = false;
  }
}

function configureInstallPrompt() {
  const installButton = document.querySelector("#install-button");
  if (!installButton) return;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    pendingInstallPrompt = event;
    installButton.hidden = false;
  });
  window.addEventListener("appinstalled", () => {
    pendingInstallPrompt = null;
    installButton.hidden = true;
    showToast("GRITCORE is installed and ready.", "success");
  });
  installButton.addEventListener("click", async () => {
    if (!pendingInstallPrompt) {
      showToast("Use your browser menu and choose Add to Home Screen or Install app.");
      return;
    }
    try {
      pendingInstallPrompt.prompt();
      await pendingInstallPrompt.userChoice;
      pendingInstallPrompt = null;
      installButton.hidden = true;
    } catch (error) {
      console.error("Could not complete the app installation prompt.", error);
      showToast("The app could not be installed from this prompt. Try your browser menu.", "error");
    }
  });
}

function initialize() {
  initializeDashboard({ showView, notify: showToast });
  initializeProfile({ notify: showToast });
  initializeActivity({ notify: showToast });
  initializeCamera({ notify: showToast });
  initializeTheme({ notify: showToast });
  initializeQuotes().catch((error) => {
    console.error("Could not initialize daily motivation.", error);
    showToast("Daily motivation could not be loaded. Your workout data is unaffected.", "error");
  });

  for (const button of document.querySelectorAll("[data-view]")) {
    button.addEventListener("click", () => showView(button.dataset.view));
  }
  window.addEventListener("hashchange", () => showView(window.location.hash.slice(1)));
  window.addEventListener("gritcore:datachange", () => renderAll(true));
  window.addEventListener("resize", () => {
    if (document.querySelector("#view-progress")?.classList.contains("active")) {
      renderProgress(showToast);
    }
  });
  document.querySelector("#today-label").textContent = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric"
  }).format(new Date()).toUpperCase();
  renderAll();
  showView(window.location.hash.slice(1));
  configureInstallPrompt();

  if (navigator.storage?.persist) {
    navigator.storage.persist().then((persisted) => {
      if (!persisted) console.info("The browser did not grant persistent storage; local data may be removed if site data is cleared.");
    }).catch((error) => {
      console.error("Could not request persistent storage for workout data.", error);
    });
  }
  if ("serviceWorker" in navigator && window.isSecureContext) {
    navigator.serviceWorker.register("./service-worker.js").catch((error) => {
      console.error("Could not register the offline app shell.", error);
      showToast("Offline installation is unavailable in this browser session.", "error");
    });
  }
}

initialize();
