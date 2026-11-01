# Data exports

An owner exports the whole workspace from **Settings > Your data**; a client exports their own data from **Profile**.
The worker builds the files in private storage, and each download link works for 15 minutes, for the person who
asked only. CSV files use RFC 4180 with a header row; text a spreadsheet would run as a formula starts with `'`.
Weights are kilograms, lengths centimetres, distances metres, dates `YYYY-MM-DD` in the client's time zone and
instants ISO 8601 UTC.

## Workspace export (owner)

| File | One row per | Notes |
| --- | --- | --- |
| `clients.csv` | client | name, email, status, time zone, units, start date |
| `sessions.csv` | planned workout | state, dates, logged by coach |
| `set_logs.csv` | logged set | reps, weight, RPE, duration, distance |
| `checkins.csv` | answered question | one row per question of each sent check-in |
| `metrics.csv` | measurement | canonical units |
| `habits.csv` | habit tick | |
| `nutrition.csv` | logged day | calories and macros |
| `exercise_swaps.csv` | swap (PRD D8) | planned exercise, the one done instead, reason |
| `goals.csv` | goal (PRD B18) | start and target in canonical units |
| `workout_notes.csv` | note on a workout (PRD D9) | author role and text |
| `programs.json` | — | every program, see below |
| `exercises.json` | — | the workspace's own exercises, see below |

## Client export (the client themselves)

The same CSV files limited to the client, plus `profile.csv` and `messages.csv` (their conversation). Never coach
notes.

## `programs.json` (PRD M3)

```json
{
  "format": "kinetic-programs",
  "version": 1,
  "programs": [
    {
      "id": "…", "title": "Strength block", "kind": "template", "clientId": null, "status": "active",
      "versionNo": 3, "createdAt": "2026-10-01T09:00:00.000Z",
      "weeks": [
        { "days": [
          { "title": "Day 1: Upper", "notes": "…",
            "exercises": [
              { "exerciseId": "…", "exerciseName": "Barbell Bench Press", "trackingType": "reps_load",
                "note": "…", "sets": [{ "reps": 8, "loadKg": 60, "rpe": 8, "restSec": 90, "tempo": "3010" }] }
            ] }
        ] }
      ]
    }
  ]
}
```

- `kind` is `template` or `client` (a client's own copy; `clientId` says whose).
- The current version only; older versions stay in the app's version history.
- **Re-import:** `weeks` (keeping `title`, `notes`, and per exercise `exerciseId`, `note` and `sets`) is exactly the
  body `POST /api/v1/programs/import` takes with a `title`, so a program can be recreated in any Kinetic workspace
  that has the same exercises. `exerciseName` and `trackingType` let another tool map exercises by name.
- Set fields by tracking type: `reps_load` uses `reps` (and optional `loadKg`, `rpe`); `duration` uses
  `durationSec`; `distance` uses `distanceM`. `restSec` and `tempo` are optional on any set.

## `exercises.json` (PRD M3)

```json
{
  "format": "kinetic-exercises",
  "version": 1,
  "exercises": [
    { "id": "…", "name": "Sled push", "equipment": "Sled", "muscleGroup": "Legs", "movementType": "Push",
      "trackingType": "distance", "instructions": "…", "mediaUrl": null,
      "secondaryMuscles": ["Glutes"], "unilateral": false, "difficulty": "intermediate",
      "cues": ["Drive through the balls of your feet", "Keep your hips low"] }
  ]
}
```

Catalog exercises are the same in every workspace and are not included.

A breaking change to either JSON format raises `version`.
