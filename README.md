# GRITCORE — Offline-first fitness tracker

GRITCORE is a responsive, installable fitness tracker focused on bodyweight workouts, walking, running, and long-term consistency. Workout, profile, goal, quote, and achievement data are stored locally in the current browser.

## Features

- Workout logging, local history, and profile-based fitness goals.
- On-device MediaPipe rep counting for supported push-up variations and sit-ups, with a full-screen camera view.
- Motion-based step estimates and GPS-based walking/running distance, pace, speed, and cadence when supported and permitted.
- Daily, weekly, monthly, yearly, and lifetime summaries; visual trends, a recent activity heatmap, goal progress, consistency, and streaks.
- Derived personal records and a permanent achievement catalogue with progress and unlock dates.
- Optional JSON backup/restore, workout CSV export, and achievement history export.
- Daily original motivational lines, cached locally and rotated without repeating until the collection has been shown.
- Seasonal/time-of-day themes; optional weather themes require a user-initiated location request.
- Responsive layouts, install prompt, offline shell, and service-worker runtime caching.

> Calories are rough MET-based estimates when a valid body weight is available. Step counts, pace, distance, rep counts, pose feedback, and BMI are estimates, not medical measurements or coaching. Camera pose feedback supports a limited set of exercises.

## Project structure

```text
fitness-app/
├── index.html
├── app.js                 # App entry point and navigation
├── storage.js             # Local data, migration, backup, restore
├── dashboard.js           # Dashboard, history, charts, records, goals
├── profile.js             # Profile, body metrics, data export/import
├── camera.js              # MediaPipe pose tracking and rep counting
├── activity.js            # Motion/GPS walking and running
├── analytics.js           # Aggregations, estimates, consistency
├── achievements.js        # Achievement catalogue and progress
├── records.js             # Personal-best calculations
├── quotes.js              # Daily quote rotation and local history
├── quotes.json            # Same-origin, offline-cached quote collection
├── theme.js               # Seasonal, time, and opt-in weather themes
├── base.css
├── dashboard.css
├── camera.css
├── mobile.css
├── analytics.css
├── achievements.css
├── theme.css
├── service-worker.js
├── manifest.webmanifest
└── icons
```

## Run locally

Serve the folder over localhost; camera, motion, and location permissions require HTTPS or localhost.

```bash
python -m http.server 8000
```

Then open <http://localhost:8000>. The app shell and local quote catalogue are precached. The camera's MediaPipe code/model are cached after a successful online load, so its first use requires an internet connection. Weather themes are optional; enabling them sends approximate device coordinates to Open-Meteo and does not store the coordinates.

## Privacy and data

Workout, profile, goal, quote history, and achievement data remain in this browser unless the user exports a backup. Camera frames are processed in the browser and are not saved by the app. GPS is used only while an activity is running. Clearing browser storage removes local data, so export a backup before changing devices or clearing site data.

## Deploy

Deploy all files to an HTTPS static host. Keep the module paths and filenames intact so service-worker precaching continues to work. Camera, motion sensors, and geolocation require a secure context. The app can be wrapped for Android as a Trusted Web Activity after the website is hosted and verified with Digital Asset Links.
