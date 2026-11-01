# Spur.fit: Feature and Screen PRD (competitive teardown)

**Status:** Draft v0.1, 2026-10-31. For founder review.
**Purpose:** Document what Spur.fit (also written Spurfit) offers coaches and their clients, and the screens it uses, so we can decide what Kinetic should build next. The Kinetic build spec for these features is in [`combined-features-prd.md`](combined-features-prd.md).

## 0. How this was researched, and how far to trust it

- **No trial account was created.** This cloud session cannot reach `spur.fit`, `help.spur.fit`, `capterra.com` or `g2.com` directly: the environment's network policy blocks those hosts. Signing up also needs an inbox for email verification and may hit a CAPTCHA, and creating an account in your name on a third-party service is something a person on the team should do. Section 7 is a checklist for that person.
- The content below is from web search over Spur.fit's own marketing and blog pages, its App Store listing, a 2024 press release, and third-party directories and reviews (G2, Capterra, GetApp, Software Advice, FitGap, TechShark).
- Each feature carries a confidence tag:
  - **[V]** Vendor-stated (spur.fit pages, App Store listing, press release).
  - **[R]** Third-party review or directory only.
  - **[I]** Our inference about how it most likely works or looks. Verify it in a trial.
- **The screens in section 4 are reconstructed** from those descriptions. They are not taken from screenshots. Treat them as a working hypothesis until someone has a trial account.

## 1. Product summary

|                                     |                                                                                                                                                                                                                                                                                                                |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Positioning                         | "AI Co-pilot for fitness and wellness coaches." Personal trainers, gyms, nutritionists and endurance coaches. [V]                                                                                                                                                                                              |
| Core pitch                          | AI drafts workout programs and meal plans in the coach's style. The coach edits and publishes them. Check-ins, reminders and nudges are automated. [V][R]                                                                                                                                                      |
| Platforms                           | Coach: web dashboard (with a mobile view [I]). Client: iOS and Android app, white-label branding available. [V]                                                                                                                                                                                                |
| Traction claim                      | "500+ coaches use the Co-Pilot" (2024 press release); "2x monthly growth." [V]                                                                                                                                                                                                                                 |
| Pricing (official site, per search) | **Starter:** free forever, up to 2 clients, no card. **Pro:** 5 clients $19/mo, 10 for $29, 20 for $49, 50 for $100, 100 for $190. The trial allows up to 100 clients. [V] Third-party listings disagree (3-client free tier; $59 for 100 clients; a $20 tier in 2024), probably because they are out of date. |

## 2. Personas and jobs

| Persona                     | Jobs Spur.fit targets                                                                                                   |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Solo online coach           | Build programs fast, look professional (branded app), collect payment, keep clients accountable without manual chasing. |
| Nutritionist / hybrid coach | Meal plans and recipes, macro or habit goals, food logging by the client.                                               |
| Gym / studio owner          | Several coaches, client CRM and leads, payments.                                                                        |
| Endurance coach             | Garmin and Coros sync, cardio sessions.                                                                                 |
| Client                      | See today's workout and meals, log them, upload progress, chat with the coach.                                          |

## 3. Feature inventory

### 3.1 AI Co-Pilot (headline differentiator)

| Feature                    | Description                                                                                                                                                 | Conf.    |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| AI workout/program builder | Generates a structured multi-week program from client inputs (goal, equipment, experience level). The coach fine-tunes it and publishes.                    | [V][R]   |
| Learns coach style         | The copilot "adapts to each coach's style" so drafts look like the coach's own programming. Likely conditioned on the coach's existing templates and edits. | [R][I]   |
| AI meal plan builder       | Generates personalized meal plans "in seconds" from client data.                                                                                            | [V]      |
| AI recipe builder          | Generates recipes that feed meal plans.                                                                                                                     | [R]      |
| AI habit micro-plans       | One click produces a habit-focused micro-plan from the client's recent rhythm (for example, missed protein on weekends).                                    | [V blog] |
| AI-generated nudges        | Scheduled check-ins, motivational nudges and payment reminders "generated by AI based on client behavior."                                                  | [V blog] |

### 3.2 Workout and program building

| Feature                       | Description                                                                                                      | Conf.  |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------ |
| Drag-and-drop workout builder | Drag exercises from the library; set sets, reps, tempo and rest per exercise.                                    | [R]    |
| Video exercise library        | Built-in library with demo videos. Coaches can **import videos from YouTube and Instagram** as custom exercises. | [V]    |
| Program templates             | Save programs and reuse or assign them to many clients.                                                          | [R][I] |
| Client workout schedule       | The assigned program appears as a calendar or schedule in the client app.                                        | [V]    |
| Cardio / endurance sessions   | Supports endurance coaches. Detail unknown (zones, pace, distance).                                              | [V][I] |

### 3.3 Nutrition

| Feature             | Description                                                                              | Conf. |
| ------------------- | ---------------------------------------------------------------------------------------- | ----- |
| Meal plans          | Coach-built or AI-built plans assigned to the client.                                    | [V]   |
| Recipes             | Recipe library, AI-assisted.                                                             | [R]   |
| Client meal logging | The client logs meals in the app.                                                        | [V]   |
| Nutrition goals     | Coach sets nutrition goals (likely macros or calories) and tracks them next to training. | [R]   |

### 3.4 Habits

| Feature                       | Description                                                                                                              | Conf.    |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------- |
| Habit assignment and tracking | Daily or weekly habits assigned to clients, checked off in the app.                                                      | [R]      |
| Habit heat map                | Coach view of daily activity as a heat map, showing "habit gaps" and trends (such as sleep quality against performance). | [V blog] |

### 3.5 Check-ins and progress

| Feature                     | Description                                                                         | Conf.         |
| --------------------------- | ----------------------------------------------------------------------------------- | ------------- |
| Automated check-ins         | Scheduled check-in forms sent automatically.                                        | [R][V blog]   |
| Check-in surveys            | Custom question forms.                                                              | [R]           |
| Progress photos             | The client uploads photos. A reviewer mentions weekly progress uploads with photos. | [V][R]        |
| Body metrics                | Weight, body-fat %, measurements.                                                   | [V blog][R]   |
| Lift tracking               | The client logs lifts. Progress is visible over time.                               | [V blog]      |
| Form-check media            | The client can "leave custom photos and videos for analysis."                       | [V App Store] |
| Workout completion tracking | Shown on the client record.                                                         | [R]           |

### 3.6 Communication

| Feature                 | Description                                            | Conf. |
| ----------------------- | ------------------------------------------------------ | ----- |
| In-app chat             | 1:1 coach-client messaging, "real-time communication." | [V]   |
| Photo and video in chat | Implied by "photos and videos for analysis."           | [I]   |

### 3.7 Business: CRM, leads, payments

| Feature               | Description                                              | Conf.        |
| --------------------- | -------------------------------------------------------- | ------------ |
| Intake forms          | Built-in forms for prospects and new clients.            | [R]          |
| Lead statuses         | Leads are tracked through statuses (a simple pipeline).  | [R]          |
| Payments              | Stripe and Razorpay. Collect payments and track revenue. | [R][V press] |
| Payment reminders     | Automated reminders, possibly AI-worded.                 | [V blog]     |
| Storefront / packages | Not confirmed by any source.                             | unverified   |

### 3.8 Branding and integrations

| Feature            | Description                                             | Conf.         |
| ------------------ | ------------------------------------------------------- | ------------- |
| Custom branded app | The coach's brand on the client app. Tier unknown.      | [V]           |
| Apple HealthKit    | Client workout sessions sync with Apple Health.         | [V App Store] |
| Garmin, Coros      | Activity and performance data synced to the coach side. | [R]           |

### 3.9 Support and onboarding

| Feature          | Description                                                                  | Conf. |
| ---------------- | ---------------------------------------------------------------------------- | ----- |
| Learning hub     | Onboarding tutorials for gyms, coaches, nutritionists and endurance coaches. | [V]   |
| Support channels | Email/help desk, FAQ/forum, chat.                                            | [R]   |
| Free resources   | Downloadable check-in form templates and similar.                            | [V]   |

## 4. Screen inventory (reconstructed; verify in a trial)

### 4.1 Coach (web)

| #   | Screen                      | Key elements (expected)                                                                                            | Conf.                                              |
| --- | --------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| C1  | Sign up / onboarding wizard | Coach type (gym, coach, nutritionist, endurance), business name, branding upload, sample client.                   | [I] from "onboarding tutorials for gyms, coaches…" |
| C2  | Dashboard                   | Active clients, check-ins due, recent activity, revenue tile, copilot entry point.                                 | [I]                                                |
| C3  | Clients list                | Search, status (lead / active / paused [I]), last activity, compliance.                                            | [R][I]                                             |
| C4  | Client profile              | Tabs: Overview, Program/Calendar, Nutrition, Habits, Check-ins, Progress (photos, metrics, lifts), Chat, Payments. | [R] FitGap lists the profile contents              |
| C5  | Leads / CRM board           | Leads by status. Intake form responses. Convert to client.                                                         | [R]                                                |
| C6  | AI Co-Pilot panel           | Inputs (goal, equipment, experience, days per week, duration). "Generate." The draft opens in the builder.         | [R][I]                                             |
| C7  | Workout / program builder   | Exercise library sidebar with drag and drop. Week/day grid. Per exercise: sets, reps, tempo, rest, notes, video.   | [R]                                                |
| C8  | Exercise library            | Search and filter. Add a custom exercise with a YouTube or Instagram video URL.                                    | [V]                                                |
| C9  | Meal plan builder           | Days × meals. Recipes, macros per meal and per day. AI generate.                                                   | [V][I]                                             |
| C10 | Recipe library              | Recipe cards with ingredients and macros. AI-generate.                                                             | [R][I]                                             |
| C11 | Habits                      | Habit templates. Assign to a client. Heat-map view per client.                                                     | [V blog]                                           |
| C12 | Check-in forms              | Form builder (question types), schedule, auto-send.                                                                | [R][I]                                             |
| C13 | Check-in review             | Answers, photos, metrics compared with the previous one. Reply.                                                    | [I]                                                |
| C14 | Inbox / chat                | Conversation list. Thread with media.                                                                              | [V][I]                                             |
| C15 | Payments                    | Plans or prices, Stripe/Razorpay connection, transactions, reminders.                                              | [R]                                                |
| C16 | Branding / app settings     | Logo, colors, app name.                                                                                            | [V]                                                |
| C17 | Integrations                | Garmin, Coros, Apple Health status.                                                                                | [R]                                                |
| C18 | Team (gym tier)             | Coaches, client allocation.                                                                                        | [I]                                                |

### 4.2 Client (iOS/Android)

| #   | Screen                      | Key elements (expected)                                              | Conf.  |
| --- | --------------------------- | -------------------------------------------------------------------- | ------ |
| A1  | Login / invite accept       | Branded splash, invite code or email link.                           | [I]    |
| A2  | Today / home                | Today's workout, meals, habits to tick, check-in due banner.         | [I]    |
| A3  | Workout schedule (calendar) | Upcoming and past workouts.                                          | [V]    |
| A4  | Workout player / logger     | Exercise video, sets × reps/weight inputs, rest timer [I], complete. | [V][I] |
| A5  | Nutrition                   | Meal plan for the day, log a meal, progress against goals.           | [V]    |
| A6  | Habits                      | Daily checklist, streak.                                             | [R][I] |
| A7  | Check-in                    | Questions, photo upload, weight/measurements.                        | [R]    |
| A8  | Progress                    | Body-metric charts, photo gallery, lift progress.                    | [V]    |
| A9  | Chat                        | Thread with the coach. Attach photo or video for form check.         | [V]    |
| A10 | Payments / subscription     | Pay, view plan.                                                      | [I]    |
| A11 | Settings                    | Units, Apple Health connection, notifications.                       | [V][I] |

## 5. Reviews: themes

| Praise (G2, Capterra)                                                                   | Complaints / gaps                                                        |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| AI program and meal-plan builders save hours.                                           | Feature lists vary between directories, so documentation looks thin. [I] |
| Forms and lead statuses keep things organized ("instead of scattered across my phone"). | Mostly marketing-sourced claims. Depth of automation unverified.         |
| Free tier and a cheap start.                                                            | No confirmed storefront or packages.                                     |

## 6. What this means for Kinetic

| Spur.fit strength                                                                                                                                                                                                                                                  | Kinetic today                                                   | Note                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| AI program and meal drafts                                                                                                                                                                                                                                         | None. **D-007 / Global Constraints: "No AI features."**         | The biggest gap against Spur.fit. Needs a founder decision. See combined PRD §5, F-23. |
| Nutrition (plans, logging, goals)                                                                                                                                                                                                                                  | None                                                            | Combined PRD F-11.                                                                     |
| Habits with a heat map                                                                                                                                                                                                                                             | None                                                            | Combined PRD F-05.                                                                     |
| Progress photos and body metrics                                                                                                                                                                                                                                   | None (check-in questions are 1–5 / text / yes-no only)          | Combined PRD F-01, F-02.                                                               |
| Video exercise library with YouTube/Instagram import                                                                                                                                                                                                               | `Exercise.mediaUrl` (https, one URL) exists. No player or embed | Combined PRD F-03.                                                                     |
| Leads / CRM, payments                                                                                                                                                                                                                                              | None (D-008 #12: billing outside the app)                       | Combined PRD F-13, F-14.                                                               |
| Branded native app, wearables                                                                                                                                                                                                                                      | Web portal (PWA-capable, offline logging)                       | Combined PRD F-19, F-20.                                                               |
| **Kinetic is stronger at:** immutable program versioning and history, offline logging with an honest sync state, a rules-based review queue with snooze and resolve, pause/resume that protects adherence, audited coach corrections, privacy export and deletion. |                                                                 | Keep these as our positioning: a dependable loop rather than AI volume.                |

## 7. Hands-on verification checklist (for a team member with a trial)

Sign up on the free Starter plan (2 clients) with a team test inbox. Use a second test inbox as the client. Capture a screenshot of each screen in section 4 into `docs/competitive/screens/spurfit/` (strip any personal data), then update the tags here from [I]/[R] to [V-trial].

1. Coach onboarding: record each step and the fields it asks for.
2. Run the AI Co-Pilot for the test client. Note the inputs, the generation time, the output structure (weeks, days, supersets?) and how edits work. Generate a second program to see whether the "coach style" effect shows.
3. Workout builder: does it support supersets, circuits, intervals and tempo? Try a YouTube URL import.
4. Meal plan: AI-generate one. Note the macro display, the food database source, substitutions, and whether a PDF export exists.
5. Habits: create one. Check the client checklist and the coach heat map.
6. Check-in: build a form. Note the question types, the photo/metric questions, the schedule options and the coach review screen (is there a side-by-side comparison?).
7. Client app (install on a phone): home, workout logger (rest timer? previous performance shown?), nutrition logging (barcode? search?), chat media, Apple Health prompt.
8. Payments: what does Stripe/Razorpay connection require? Packages? Recurring billing? Who pays the fees?
9. Leads: the intake form link, the lead statuses and the conversion flow.
10. Pricing gates: note which of the above are locked on Starter.

## Sources

- [Spur.fit homepage](https://www.spur.fit/) and [Start free](https://www.spur.fit/get-started-spur-fit)
- [Spur.fit blog: AI-powered habit tracking](https://www.spur.fit/blogs/ai-powered-habit-tracking-the-key-to-unlocking-long-term-health-transformation)
- [Spur.fit blog: Saving 10 hours a week with AI](https://www.spur.fit/blogs/how-fitness-coaches-are-saving-10-hours-a-week-with-ai)
- [Spur.fit free coach resources](https://www.spur.fit/free-fitness-coach-resources)
- [App Store: Fitness App (Spur.fit)](https://apps.apple.com/us/app/fitness-app-spur-fit/id1516471995)
- [Fitt Insider press release](https://insider.fitt.co/press-release/spur-fit-powers-fitness-coaches-with-ai-copilot-drives-hyper-growth-with-2x-monthly-increase/)
- [Product Hunt: Spur.fit 2.0](https://www.producthunt.com/products/spur-fit?launch=spurfit-2-0)
- [G2 reviews](https://www.g2.com/products/spur-fit/reviews), [G2 pricing](https://g2.com/products/spur-fit/pricing)
- [Capterra](https://www.capterra.com/p/10013040/Spur-Fit/), [GetApp](https://www.getapp.com/personal-trainer-software/a/spur-fit), [Software Advice](https://www.softwareadvice.com/product/515061-Spur-Fit)
- [FitGap](https://us.fitgap.com/products/055569/spur-fit), [TechShark review](https://techshark.io/tools/spur-fit/), [Krowdbase](https://www.krowdbase.com/software/spur-fit)
