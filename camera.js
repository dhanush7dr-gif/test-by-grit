import { addWorkout } from "./storage.js";

export function initializeCamera({ notify = () => {} } = {}) {
  const cameraVideo = document.querySelector("#camera-video");
  const poseCanvas = document.querySelector("#pose-canvas");
  const poseContext = poseCanvas?.getContext("2d");
  const cameraFrame = document.querySelector(".camera-frame");
  const cameraMessage = document.querySelector("#camera-message");
  const cameraStartButton = document.querySelector("#camera-start");
  const cameraStopButton = document.querySelector("#camera-stop");
  const cameraSaveButton = document.querySelector("#camera-save");
  const cameraFullscreenButton = document.querySelector("#camera-fullscreen");
  const repCountOutput = document.querySelector("#rep-count");
  const cameraExerciseSelect = document.querySelector("#camera-exercise");

  if (!cameraVideo || !poseCanvas || !poseContext || !cameraFrame || !cameraMessage ||
    !cameraStartButton || !cameraStopButton || !cameraSaveButton || !cameraFullscreenButton ||
    !repCountOutput || !cameraExerciseSelect) {
    const message = "Camera controls are unavailable on this page.";
    console.error(message);
    notify(message, "error");
    return;
  }

  let activeStream = null;
  let cameraFullscreenFallback = false;
  let poseLandmarker = null;
  let poseLandmarkerPromise = null;
  let animationFrame = 0;
  let cameraStartedAt = 0;
  let cameraRepCount = 0;
  let cameraPhase = "unarmed";
  let lastRepAt = 0;
  let angleSamples = [];

  function setCameraMessage(message, kind = "") {
    cameraMessage.textContent = message;
    cameraMessage.classList.toggle("error", kind === "error");
    cameraMessage.classList.toggle("success", kind === "success");
  }

  function syncCameraFullscreen() {
    const isFullscreen = document.fullscreenElement === cameraFrame || cameraFullscreenFallback;
    cameraFrame.classList.toggle("is-fullscreen", isFullscreen);
    cameraFullscreenButton.textContent = isFullscreen ? "Exit full screen" : "Full screen";
    cameraFullscreenButton.setAttribute("aria-label", isFullscreen ? "Exit camera full screen" : "View camera full screen");
  }

  async function toggleCameraFullscreen() {
    if (document.fullscreenElement === cameraFrame) {
      try {
        await document.exitFullscreen();
      } catch (error) {
        console.error("Could not exit the camera full-screen view.", error);
        notify("Could not exit the camera full-screen view. Press Escape to leave it.", "error");
        setCameraMessage("Press Escape to leave the full-screen camera view.", "error");
      }
      return;
    }
    if (cameraFullscreenFallback) {
      cameraFullscreenFallback = false;
      syncCameraFullscreen();
      return;
    }
    if (!cameraFrame.requestFullscreen) {
      cameraFullscreenFallback = true;
      syncCameraFullscreen();
      return;
    }
    try {
      await cameraFrame.requestFullscreen();
    } catch (error) {
      console.error("Could not open the camera full-screen view.", error);
      notify("Full-screen view could not be opened. Check your browser settings and try again.", "error");
      setCameraMessage("Full-screen view could not be opened. Check your browser settings and try again.", "error");
    }
  }

  function cameraExerciseKind() {
    return document.querySelector("#camera-exercise").value.toLowerCase().includes("push-up")
      ? "push-up"
      : "sit-up";
  }

  function angleAtJoint(first, joint, last) {
    const aspectRatio = cameraVideo.videoWidth && cameraVideo.videoHeight
      ? cameraVideo.videoWidth / cameraVideo.videoHeight
      : 1;
    const a = Math.atan2(first.y - joint.y, (first.x - joint.x) * aspectRatio);
    const b = Math.atan2(last.y - joint.y, (last.x - joint.x) * aspectRatio);
    let degrees = Math.abs((a - b) * 180 / Math.PI);
    if (degrees > 180) degrees = 360 - degrees;
    return degrees;
  }

  function visible(point) {
    return point && Number(point.visibility ?? 1) >= 0.6;
  }

  function chooseSide(landmarks, leftIds, rightIds) {
    const visibilityScore = (ids) => ids.reduce((sum, id) => sum + Number(landmarks[id]?.visibility || 0), 0);
    const leftScore = visibilityScore(leftIds);
    const rightScore = visibilityScore(rightIds);
    const leftVisible = leftIds.every((id) => visible(landmarks[id]));
    const rightVisible = rightIds.every((id) => visible(landmarks[id]));
    if (leftVisible && !rightVisible) return leftIds;
    if (rightVisible && !leftVisible) return rightIds;
    return leftScore >= rightScore ? leftIds : rightIds;
  }

  function getExerciseMetrics(landmarks, type, exercise) {
    const ids = type === "push-up"
      ? chooseSide(landmarks, [11, 13, 15, 23, 25, 27], [12, 14, 16, 24, 26, 28])
      : chooseSide(landmarks, [11, 23, 25, 27], [12, 24, 26, 28]);
    const [shoulder, joint, last] = ids.slice(0, 3).map((id) => landmarks[id]);
    if (!ids.every((id) => visible(landmarks[id]))) return null;

    const angle = angleAtJoint(shoulder, joint, last);
    const hipAngle = type === "push-up"
      ? angleAtJoint(landmarks[ids[0]], landmarks[ids[3]], landmarks[exercise.toLowerCase().includes("knee") ? ids[4] : ids[5]])
      : null;
    const aligned = type !== "push-up" || (exercise.toLowerCase().includes("pike")
      ? hipAngle >= 60 && hipAngle <= 145
      : hipAngle >= 145);
    return { angle, aligned };
  }

  function evaluatePosture(landmarks) {
    const headVisible = [0, 1, 2, 7, 8].some((id) => visible(landmarks[id]));
    if (!headVisible) {
      return { ok: false, reason: "Keep your head visible while showing one side of your body to the camera." };
    }
    return { ok: true, reason: "" };
  }

  function drawPoseWarning(message) {
    if (!poseCanvas.width || !poseCanvas.height) return;
    poseContext.fillStyle = "rgba(120, 32, 26, 0.78)";
    poseContext.fillRect(16, 16, Math.min(280, poseCanvas.width - 32), 46);
    poseContext.strokeStyle = "rgba(255, 205, 175, 0.9)";
    poseContext.lineWidth = 2;
    poseContext.strokeRect(16, 16, Math.min(280, poseCanvas.width - 32), 46);
    poseContext.fillStyle = "#fff7f1";
    poseContext.font = '700 16px "Segoe UI", sans-serif';
    poseContext.fillText("Wrong move", 28, 44);
    poseContext.font = '600 11px "Segoe UI", sans-serif';
    poseContext.fillStyle = "#ffd7c8";
    const wrapped = message.length > 34 ? `${message.slice(0, 34)}…` : message;
    poseContext.fillText(wrapped, 28, 58);
  }

  const POSE_CONNECTIONS = [
    [11, 13], [13, 15], [12, 14], [14, 16], [11, 12], [11, 23],
    [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28],
    [0, 1], [0, 2], [1, 2], [1, 3], [2, 3], [3, 4], [1, 5], [2, 5]
  ];

  function drawPose(landmarks) {
    if (!cameraVideo.videoWidth) return;
    if (poseCanvas.width !== cameraVideo.videoWidth || poseCanvas.height !== cameraVideo.videoHeight) {
      poseCanvas.width = cameraVideo.videoWidth;
      poseCanvas.height = cameraVideo.videoHeight;
    }
    poseContext.clearRect(0, 0, poseCanvas.width, poseCanvas.height);
    poseContext.lineWidth = Math.max(3, poseCanvas.width / 180);
    poseContext.strokeStyle = "#87d4af";
    poseContext.fillStyle = "#fef6ef";
    for (const [first, second] of POSE_CONNECTIONS) {
      if (!visible(landmarks[first]) || !visible(landmarks[second])) continue;
      poseContext.beginPath();
      poseContext.moveTo(landmarks[first].x * poseCanvas.width, landmarks[first].y * poseCanvas.height);
      poseContext.lineTo(landmarks[second].x * poseCanvas.width, landmarks[second].y * poseCanvas.height);
      poseContext.stroke();
    }

    const faceAndHands = [0, 1, 2, 3, 4, 7, 8, 9, 10, 13, 14, 15, 16];
    for (const id of faceAndHands) {
      const point = landmarks[id];
      if (!visible(point)) continue;
      const x = point.x * poseCanvas.width;
      const y = point.y * poseCanvas.height;
      const radius = [0, 1, 2, 3, 4].includes(id) ? Math.max(4, poseCanvas.width / 110) : Math.max(5, poseCanvas.width / 90);
      poseContext.beginPath();
      poseContext.arc(x, y, radius, 0, Math.PI * 2);
      poseContext.fillStyle = [0, 1, 2, 3, 4].includes(id) ? "#ffd9a8" : "#f6f1ff";
      poseContext.fill();
    }
  }

  function updateRepCounter(angle, timestamp) {
    if (angle === null) {
      angleSamples = [];
      cameraPhase = "unarmed";
      setCameraMessage("Show one side of your body, from head to feet. For push-ups, keep your shoulder, hip, knee, ankle, and wrist visible.");
      return;
    }

    angleSamples.push(angle);
    if (angleSamples.length > 5) angleSamples.shift();
    if (angleSamples.length < 5) {
      setCameraMessage("Hold your starting position while the tracker checks your form.");
      return;
    }

    const sortedAngles = [...angleSamples].sort((a, b) => a - b);
    const smoothedAngle = sortedAngles[Math.floor(sortedAngles.length / 2)];
    const kind = cameraExerciseKind();
    const startingAngle = kind === "push-up" ? 150 : 130;

    if (cameraPhase === "unarmed") {
      const ready = smoothedAngle >= startingAngle;
      if (ready) {
        cameraPhase = kind === "push-up" ? "top" : "bottom";
        setCameraMessage(kind === "push-up"
          ? "Starting position detected. Lower with control."
          : "Starting position detected. Sit up with control.");
      } else {
        setCameraMessage(kind === "push-up"
          ? "Start with your arms extended and body in a straight line."
          : "Start lying back with your head, hips, and knees visible.");
      }
      return;
    }

    if (kind === "push-up") {
      if (cameraPhase === "top" && smoothedAngle < 95) {
        cameraPhase = "bottom";
        setCameraMessage("Good depth. Push back up to complete the rep.");
      } else if (cameraPhase === "bottom" && smoothedAngle > 155) {
        cameraPhase = "top";
        const counted = timestamp - lastRepAt > 900;
        if (counted) {
          cameraRepCount += 1;
          lastRepAt = timestamp;
          repCountOutput.textContent = String(cameraRepCount);
        }
        setCameraMessage(counted
          ? "Rep counted. Lower with control for your next rep."
          : "Move more slowly between reps; this repetition was not counted.", counted ? "success" : "");
      } else if (cameraPhase === "top") {
        setCameraMessage("Start from a straight-arm position, then lower with control.");
      }
    } else if (cameraPhase === "bottom" && smoothedAngle < 100) {
      cameraPhase = "up";
      setCameraMessage("Nice. Return to the lying position to complete the rep.");
    } else if (cameraPhase === "up" && smoothedAngle > 140) {
      cameraPhase = "bottom";
      const counted = timestamp - lastRepAt > 900;
      if (counted) {
        cameraRepCount += 1;
        lastRepAt = timestamp;
        repCountOutput.textContent = String(cameraRepCount);
      }
      setCameraMessage(counted
        ? "Rep counted. Sit up again when you're ready."
        : "Move more slowly between reps; this repetition was not counted.", counted ? "success" : "");
    } else if (cameraPhase === "bottom") {
      setCameraMessage("Start lying back with your head, hips, and knees visible.");
    }
  }

  function detectFrame(timestamp) {
    if (!poseLandmarker || cameraVideo.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      animationFrame = requestAnimationFrame(detectFrame);
      return;
    }
    try {
      const result = poseLandmarker.detectForVideo(cameraVideo, timestamp);
      const landmarks = result.landmarks?.[0];
      if (landmarks) {
        drawPose(landmarks);
        const selectedExercise = document.querySelector("#camera-exercise").value;
        const posture = evaluatePosture(landmarks, selectedExercise);
        if (!posture.ok) {
          drawPoseWarning(posture.reason);
          angleSamples = [];
          cameraPhase = "unarmed";
          setCameraMessage(posture.reason, "error");
          return;
        }

        const metrics = getExerciseMetrics(landmarks, cameraExerciseKind(), selectedExercise);
        if (metrics && !metrics.aligned) {
          angleSamples = [];
          cameraPhase = "unarmed";
          setCameraMessage("Hold a steady starting pose and keep your full body visible.");
        } else {
          updateRepCounter(metrics?.angle ?? null, timestamp);
        }
      } else {
        angleSamples = [];
        cameraPhase = "unarmed";
        poseContext.clearRect(0, 0, poseCanvas.width, poseCanvas.height);
        setCameraMessage("Step back until your head, hands, and feet are all in frame.");
      }
    } catch (error) {
      console.error("Camera pose detection stopped unexpectedly.", error);
      notify("Pose tracking stopped because of an error. Stop the camera and try again.", "error");
      setCameraMessage("Pose tracking stopped because of an error. Stop the camera and try again.", "error");
      stopCamera();
      return;
    }
    animationFrame = requestAnimationFrame(detectFrame);
  }

  async function loadPoseLandmarker() {
    if (poseLandmarker) return poseLandmarker;
    if (poseLandmarkerPromise) return poseLandmarkerPromise;
    poseLandmarkerPromise = (async () => {
      const visionVersion = "0.10.21";
      const visionModuleUrl = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${visionVersion}`;
      const vision = await import(visionModuleUrl);
      const fileset = await vision.FilesetResolver.forVisionTasks(
        `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${visionVersion}/wasm`
      );
      const options = {
        baseOptions: {
          modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
          delegate: "GPU"
        },
        runningMode: "VIDEO",
        numPoses: 1,
        minPoseDetectionConfidence: 0.55,
        minPosePresenceConfidence: 0.55,
        minTrackingConfidence: 0.5
      };
      try {
        poseLandmarker = await vision.PoseLandmarker.createFromOptions(fileset, options);
      } catch (gpuError) {
        console.warn("GPU pose tracking was unavailable; retrying on CPU.", gpuError);
        options.baseOptions.delegate = "CPU";
        poseLandmarker = await vision.PoseLandmarker.createFromOptions(fileset, options);
      }
      return poseLandmarker;
    })();
    try {
      return await poseLandmarkerPromise;
    } catch (error) {
      poseLandmarkerPromise = null;
      throw error;
    }
  }

  async function startCamera() {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      const message = "Camera access requires HTTPS or localhost. Open the app from a secure website or this computer's localhost.";
      console.error(message);
      notify(message, "error");
      setCameraMessage(message, "error");
      return;
    }
    cameraStartButton.disabled = true;
    setCameraMessage("Requesting camera access…");
    try {
      activeStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      cameraVideo.srcObject = activeStream;
      await cameraVideo.play();
      cameraFrame.classList.add("is-live");
      setCameraMessage("Loading on-device pose tracker. The first load needs an internet connection…");
      await loadPoseLandmarker();
      cameraStartedAt = Date.now();
      cameraRepCount = 0;
      lastRepAt = 0;
      cameraPhase = "unarmed";
      angleSamples = [];
      repCountOutput.textContent = "0";
      cameraStopButton.disabled = false;
      cameraSaveButton.disabled = false;
      cameraFullscreenButton.disabled = false;
      setCameraMessage("Tracker ready. Keep your full body in view and begin in the starting position.");
      animationFrame = requestAnimationFrame(detectFrame);
    } catch (error) {
      console.error("Could not start the workout camera or pose tracker.", error);
      if (activeStream) {
        for (const track of activeStream.getTracks()) track.stop();
        activeStream = null;
      }
      cameraVideo.srcObject = null;
      cameraFrame.classList.remove("is-live");
      const message = error.name === "NotAllowedError"
        ? "Camera permission was denied. Allow camera access in your browser settings, then try again."
        : error.name === "NotFoundError"
          ? "No camera was found on this device."
          : "Could not start camera tracking. Check your connection and camera permission, then try again.";
      notify(message, "error");
      setCameraMessage(message, "error");
    } finally {
      cameraStartButton.disabled = false;
    }
  }

  function stopCamera() {
    cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    if (activeStream) {
      for (const track of activeStream.getTracks()) track.stop();
      activeStream = null;
    }
    cameraVideo.srcObject = null;
    cameraFrame.classList.remove("is-live");
    cameraFullscreenFallback = false;
    if (document.fullscreenElement === cameraFrame) {
      document.exitFullscreen().catch((error) => {
        console.error("Could not exit the camera full-screen view.", error);
        notify("Could not exit the camera full-screen view. Press Escape to leave it.", "error");
        setCameraMessage("Press Escape to leave the full-screen camera view.", "error");
      });
    }
    syncCameraFullscreen();
    angleSamples = [];
    cameraStopButton.disabled = true;
    cameraSaveButton.disabled = true;
    cameraFullscreenButton.disabled = true;
    cameraStartButton.disabled = false;
    poseContext.clearRect(0, 0, poseCanvas.width, poseCanvas.height);
  }

  function saveCameraSet() {
    if (cameraRepCount < 1) {
      notify("Complete at least one rep before saving this set.", "error");
      return;
    }
    const duration = Math.max(0, Math.round((Date.now() - cameraStartedAt) / 60000));
    const exercise = document.querySelector("#camera-exercise").value;
    try {
      if (addWorkout({ exercise, sets: 1, reps: cameraRepCount, duration, mode: "camera" })) {
        stopCamera();
        setCameraMessage(`${cameraRepCount} reps saved. Great work!`, "success");
      } else {
        notify("Could not save this set. Please try again.", "error");
      }
    } catch (error) {
      console.error("Could not save the camera workout.", error);
      notify("Could not save this set. Please try again.", "error");
    }
  }

  cameraStartButton.addEventListener("click", startCamera);
  cameraStopButton.addEventListener("click", stopCamera);
  cameraSaveButton.addEventListener("click", saveCameraSet);
  cameraFullscreenButton.addEventListener("click", toggleCameraFullscreen);
  document.addEventListener("fullscreenchange", syncCameraFullscreen);
  cameraExerciseSelect.addEventListener("change", () => {
    cameraPhase = "unarmed";
    angleSamples = [];
    cameraRepCount = 0;
    lastRepAt = 0;
    cameraStartedAt = activeStream ? Date.now() : 0;
    repCountOutput.textContent = "0";
    setCameraMessage("Exercise changed. Begin from the starting position for a fresh count.");
  });
}
