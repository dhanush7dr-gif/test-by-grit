import { addWorkout } from "./storage.js";

export function initializeActivity({ notify = () => {} } = {}) {
  const activityTracker = {
    mode: "walk",
    state: "idle",
    steps: 0,
    distanceMeters: 0,
    elapsedMs: 0,
    startedAt: 0,
    baseline: null,
    stepArmed: true,
    lastStepAt: 0,
    lastPosition: null,
    watchId: null,
    timerId: null,
    motionAvailable: false,
    starting: false
  };
  const requiredIds = ["#activity-time", "#activity-steps", "#activity-distance", "#activity-speed", "#activity-pace", "#activity-cadence", "#activity-start", "#activity-pause", "#activity-finish", "#activity-status"];
  if (requiredIds.some((selector) => !document.querySelector(selector))) {
    const message = "Walking and running controls are unavailable on this page.";
    console.error(message);
    notify(message, "error");
    return;
  }

  function formatActivityTime(milliseconds) {
    const totalSeconds = Math.floor(milliseconds / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return hours > 0
      ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
      : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function updateActivityDisplay() {
    const elapsed = activityTracker.elapsedMs +
      (activityTracker.state === "running" ? Date.now() - activityTracker.startedAt : 0);
    const elapsedMinutes = elapsed / 60000;
    const distanceKm = activityTracker.distanceMeters / 1000;
    document.querySelector("#activity-time").textContent = formatActivityTime(elapsed);
    document.querySelector("#activity-steps").textContent = activityTracker.steps.toLocaleString();
    document.querySelector("#activity-distance").innerHTML =
      `${(activityTracker.distanceMeters / 1000).toFixed(2)} <small>km</small>`;
    document.querySelector("#activity-speed").textContent = distanceKm > 0 && elapsedMinutes > 0
      ? `${(distanceKm / (elapsedMinutes / 60)).toFixed(1)} km/h`
      : "—";
    if (distanceKm > 0.02 && elapsedMinutes > 0) {
      const pace = elapsed / 1000 / distanceKm;
      const minutes = Math.floor(pace / 60);
      const seconds = Math.round(pace % 60);
      document.querySelector("#activity-pace").textContent = `${minutes}:${String(seconds).padStart(2, "0")} /km`;
    } else {
      document.querySelector("#activity-pace").textContent = "—";
    }
    document.querySelector("#activity-cadence").textContent = elapsedMinutes > 0 && activityTracker.steps > 0
      ? `${Math.round(activityTracker.steps / elapsedMinutes)} steps/min`
      : "—";

    const running = activityTracker.state === "running";
    const canFinish = running || activityTracker.state === "paused";
    document.querySelector("#activity-start").disabled = running || activityTracker.starting;
    document.querySelector("#activity-pause").disabled = !canFinish;
    document.querySelector("#activity-finish").disabled = !canFinish;
    document.querySelector("#activity-pause").textContent = activityTracker.state === "paused" ? "Resume" : "Pause";
    document.querySelector("#activity-start").textContent = `Start ${activityTracker.mode === "walk" ? "walking" : "running"}`;
    document.querySelectorAll("[data-activity-mode]").forEach((button) => {
      button.disabled = activityTracker.starting || running || activityTracker.state === "paused";
      button.classList.toggle("active", button.dataset.activityMode === activityTracker.mode);
    });
  }

  function setActivityStatus(message, kind = "") {
    const status = document.querySelector("#activity-status");
    status.textContent = message;
    status.classList.toggle("error", kind === "error");
    status.classList.toggle("success", kind === "success");
  }

  function handleDeviceMotion(event) {
    const acceleration = event.acceleration || event.accelerationIncludingGravity;
    if (!acceleration || !Number.isFinite(acceleration.x) ||
      !Number.isFinite(acceleration.y) || !Number.isFinite(acceleration.z)) {
      return;
    }

    const magnitude = Math.hypot(acceleration.x, acceleration.y, acceleration.z);
    if (activityTracker.baseline === null) {
      activityTracker.baseline = magnitude;
      return;
    }

    const deviation = Math.abs(magnitude - activityTracker.baseline);
    activityTracker.baseline = activityTracker.baseline * 0.9 + magnitude * 0.1;
    const now = event.timeStamp || performance.now();
    if (deviation > 1.25 && activityTracker.stepArmed && now - activityTracker.lastStepAt > 300) {
      activityTracker.steps += 1;
      activityTracker.lastStepAt = now;
      activityTracker.stepArmed = false;
      updateActivityDisplay();
    } else if (deviation < 0.35) {
      activityTracker.stepArmed = true;
    }
  }

  function distanceBetween(first, second) {
    const radians = (degrees) => degrees * Math.PI / 180;
    const latitudeDelta = radians(second.latitude - first.latitude);
    const longitudeDelta = radians(second.longitude - first.longitude);
    const a = Math.sin(latitudeDelta / 2) ** 2 +
      Math.cos(radians(first.latitude)) * Math.cos(radians(second.latitude)) *
      Math.sin(longitudeDelta / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function handleActivityPosition(position) {
    if (activityTracker.state !== "running" || position.coords.accuracy > 50) return;
    const current = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy
    };
    if (activityTracker.lastPosition) {
      const distance = distanceBetween(activityTracker.lastPosition, current);
      if (distance <= Math.max(100, activityTracker.lastPosition.accuracy + current.accuracy)) {
        activityTracker.distanceMeters += distance;
        updateActivityDisplay();
      }
    }
    activityTracker.lastPosition = current;
  }

  function stopActivitySensors() {
    window.removeEventListener("devicemotion", handleDeviceMotion);
    if (activityTracker.watchId !== null) {
      navigator.geolocation.clearWatch(activityTracker.watchId);
      activityTracker.watchId = null;
    }
    if (activityTracker.timerId !== null) {
      clearInterval(activityTracker.timerId);
      activityTracker.timerId = null;
    }
  }

  async function requestMotionPermission() {
    const MotionEvent = window.DeviceMotionEvent;
    if (!MotionEvent) {
      activityTracker.motionAvailable = false;
      return false;
    }
    if (typeof MotionEvent.requestPermission === "function") {
      const permission = await MotionEvent.requestPermission();
      activityTracker.motionAvailable = permission === "granted";
      return activityTracker.motionAvailable;
    }
    activityTracker.motionAvailable = true;
    return true;
  }

  async function startActivity() {
    if (activityTracker.state === "running" || activityTracker.starting) return;
    activityTracker.starting = true;
    updateActivityDisplay();
    if (activityTracker.state === "idle" || activityTracker.state === "finished") {
      activityTracker.steps = 0;
      activityTracker.distanceMeters = 0;
      activityTracker.elapsedMs = 0;
      activityTracker.lastPosition = null;
      activityTracker.baseline = null;
      activityTracker.lastStepAt = 0;
      activityTracker.stepArmed = true;
    }

    let motionAllowed = false;
    try {
      motionAllowed = await requestMotionPermission();
    } catch (error) {
      console.error("Could not request motion sensor permission.", error);
      notify("Motion sensor permission could not be requested; steps may be unavailable.", "error");
      activityTracker.motionAvailable = false;
    }

    activityTracker.starting = false;
    activityTracker.state = "running";
    activityTracker.startedAt = Date.now();
    activityTracker.baseline = null;
    activityTracker.lastPosition = null;
    if (motionAllowed) {
      window.addEventListener("devicemotion", handleDeviceMotion);
    }
    if (navigator.geolocation) {
      try {
        activityTracker.watchId = navigator.geolocation.watchPosition(
          handleActivityPosition,
          (error) => {
            console.warn("Outdoor activity location tracking is unavailable.", error);
            notify("Location tracking is unavailable. Allow location access for GPS distance.", "error");
            setActivityStatus("Activity timer is running. Allow location access for GPS distance; steps require phone motion sensors.", "error");
          },
          { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
        );
      } catch (error) {
        console.error("Could not start outdoor activity location tracking.", error);
        notify("Location tracking could not start. The activity timer will continue without GPS distance.", "error");
        setActivityStatus("Activity timer is running without GPS distance.", "error");
      }
    }
    activityTracker.timerId = setInterval(updateActivityDisplay, 1000);
    const gpsAvailable = Boolean(navigator.geolocation);
    setActivityStatus(motionAllowed
      ? `Tracking started. Keep your phone with you; ${gpsAvailable ? "GPS distance may take a moment to appear." : "GPS is not available on this device."}`
      : `Timer started, but this device did not grant motion access. ${gpsAvailable ? "GPS distance may still be recorded." : "GPS is not available either."}`,
      motionAllowed ? "" : "error");
    updateActivityDisplay();
  }

  function pauseActivity() {
    if (activityTracker.state === "running") {
      activityTracker.elapsedMs += Date.now() - activityTracker.startedAt;
      activityTracker.state = "paused";
      stopActivitySensors();
      setActivityStatus("Activity paused. Resume when you’re ready.");
    } else if (activityTracker.state === "paused") {
      startActivity();
      return;
    } else {
      return;
    }
    updateActivityDisplay();
  }

  function finishActivity() {
    if (activityTracker.state === "running") {
      activityTracker.elapsedMs += Date.now() - activityTracker.startedAt;
    }
    stopActivitySensors();
    activityTracker.state = "paused";
    const exercise = activityTracker.mode === "walk" ? "Walking" : "Running";
    const elapsedSeconds = activityTracker.elapsedMs / 1000;
    const distanceMeters = activityTracker.distanceMeters;
    const steps = activityTracker.steps;
    const validTime = Number.isFinite(elapsedSeconds) && elapsedSeconds > 0;
    const validDistance = Number.isFinite(distanceMeters) && distanceMeters > 0;
    const validSteps = Number.isFinite(steps) && steps >= 0;
    let saved = false;
    try {
      saved = addWorkout({
        exercise,
        sets: 1,
        reps: 0,
        duration: Math.round(activityTracker.elapsedMs / 60000),
        mode: "activity",
        steps,
        distanceMeters,
        averagePaceSecondsPerKm: validTime && validDistance
          ? elapsedSeconds / (distanceMeters / 1000)
          : null,
        averageSpeedKmh: validTime && validDistance
          ? (distanceMeters / 1000) / (elapsedSeconds / 3600)
          : null,
        cadenceStepsPerMinute: validTime && validSteps
          ? steps / (elapsedSeconds / 60)
          : null
      });
    } catch (error) {
      console.error("Could not save the activity workout.", error);
      notify("Could not save this activity. Please try again.", "error");
    }
    if (saved) {
      activityTracker.state = "finished";
      setActivityStatus(`${exercise} saved: ${activityTracker.steps.toLocaleString()} estimated steps, ${(activityTracker.distanceMeters / 1000).toFixed(2)} km.`, "success");
    } else {
      notify("Could not save this activity. Please try again.", "error");
    }
    updateActivityDisplay();
  }

  function selectActivityMode(mode) {
    if (activityTracker.state === "running" || activityTracker.state === "paused") return;
    activityTracker.mode = mode === "run" ? "run" : "walk";
    updateActivityDisplay();
  }

  document.querySelector("#activity-start").addEventListener("click", startActivity);
  document.querySelector("#activity-pause").addEventListener("click", pauseActivity);
  document.querySelector("#activity-finish").addEventListener("click", finishActivity);
  for (const button of document.querySelectorAll("[data-activity-mode]")) {
    button.addEventListener("click", () => selectActivityMode(button.dataset.activityMode));
  }
  updateActivityDisplay();
}
