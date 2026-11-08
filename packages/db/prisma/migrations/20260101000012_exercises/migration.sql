-- CreateEnum
CREATE TYPE "tracking_type" AS ENUM ('reps_load', 'duration', 'distance');

-- CreateTable
CREATE TABLE "exercises" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "name" TEXT NOT NULL,
    "equipment" TEXT NOT NULL,
    "muscle_group" TEXT NOT NULL,
    "movement_type" TEXT NOT NULL,
    "tracking_type" "tracking_type" NOT NULL,
    "instructions" TEXT NOT NULL DEFAULT '',
    "media_url" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exercises_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "exercises_organization_id_name_id_idx" ON "exercises"("organization_id", "name", "id");

-- CreateIndex
CREATE INDEX "exercises_organization_id_created_at_idx" ON "exercises"("organization_id", "created_at");

-- Case-insensitive name uniqueness per organization. Expression index: Prisma cannot model it, so it
-- is not in schema.prisma (db:diff ignores it). Global rows (organization_id NULL) are not constrained.
CREATE UNIQUE INDEX "exercises_org_lower_name_key" ON "exercises" ("organization_id", lower("name")) WHERE "organization_id" IS NOT NULL;

-- AddForeignKey
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMENT ON TABLE "exercises" IS 'Exercise library. organization_id NULL = global catalog row: readable by every organization, writable by none (only the system/bypass role changes them). Non-null = an organization''s custom exercise.';

-- Global catalog (fixed UUIDs). Source list: prisma/exercise-catalog.ts; this block is generated from it
-- (pnpm --filter @repsy/db exercises:sql). Runs before RLS is enabled below, so no bypass is needed.
-- ON CONFLICT keeps the migration safe to re-run against a database that already has the rows.
INSERT INTO "exercises" ("id", "name", "equipment", "muscle_group", "movement_type", "tracking_type", "instructions") VALUES
  ('e0000000-0000-4000-8000-000000000001', 'Barbell Bench Press', 'Barbell', 'Chest', 'Push', 'reps_load'::"tracking_type", 'Lie on a flat bench with your feet planted. Lower the bar to your mid chest under control, then press it back up until your arms are straight.'),
  ('e0000000-0000-4000-8000-000000000002', 'Incline Dumbbell Press', 'Dumbbell', 'Chest', 'Push', 'reps_load'::"tracking_type", 'Set a bench to a slight incline. Press the dumbbells up from shoulder level until your arms are straight, then lower them slowly.'),
  ('e0000000-0000-4000-8000-000000000003', 'Dumbbell Bench Press', 'Dumbbell', 'Chest', 'Push', 'reps_load'::"tracking_type", 'Lie on a flat bench holding a dumbbell in each hand at chest level. Press both up together, then lower with control.'),
  ('e0000000-0000-4000-8000-000000000004', 'Push-Up', 'Bodyweight', 'Chest', 'Push', 'reps_load'::"tracking_type", 'Start in a straight plank with hands under your shoulders. Lower your chest to just above the floor, then push back up without sagging your hips.'),
  ('e0000000-0000-4000-8000-000000000005', 'Cable Chest Fly', 'Cable', 'Chest', 'Isolation', 'reps_load'::"tracking_type", 'Stand between two high pulleys with a slight bend in your elbows. Bring your hands together in front of your chest in a wide arc, then return slowly.'),
  ('e0000000-0000-4000-8000-000000000006', 'Machine Chest Press', 'Machine', 'Chest', 'Push', 'reps_load'::"tracking_type", 'Adjust the seat so the handles line up with your mid chest. Press forward until your arms are straight, then return without letting the weights rest.'),
  ('e0000000-0000-4000-8000-000000000007', 'Dip', 'Bodyweight', 'Chest', 'Push', 'reps_load'::"tracking_type", 'Hold yourself above parallel bars with straight arms. Lower until your upper arms are about level with the floor, then press back up.'),
  ('e0000000-0000-4000-8000-000000000008', 'Pull-Up', 'Bodyweight', 'Back', 'Pull', 'reps_load'::"tracking_type", 'Hang from a bar with an overhand grip a little wider than your shoulders. Pull until your chin clears the bar, then lower fully.'),
  ('e0000000-0000-4000-8000-000000000009', 'Chin-Up', 'Bodyweight', 'Back', 'Pull', 'reps_load'::"tracking_type", 'Hang from a bar with an underhand grip at shoulder width. Pull your chest toward the bar, then lower until your arms are straight.'),
  ('e0000000-0000-4000-8000-000000000010', 'Lat Pulldown', 'Cable', 'Back', 'Pull', 'reps_load'::"tracking_type", 'Sit with your thighs under the pads and grip the bar wide. Pull it down to your upper chest, keeping your torso upright, then let it rise slowly.'),
  ('e0000000-0000-4000-8000-000000000011', 'Barbell Row', 'Barbell', 'Back', 'Pull', 'reps_load'::"tracking_type", 'Hinge forward with a flat back and the bar hanging below your knees. Pull the bar to your lower ribs, then lower it under control.'),
  ('e0000000-0000-4000-8000-000000000012', 'One-Arm Dumbbell Row', 'Dumbbell', 'Back', 'Pull', 'reps_load'::"tracking_type", 'Rest one hand and knee on a bench. Pull the dumbbell toward your hip, keeping your back flat, then lower it fully.'),
  ('e0000000-0000-4000-8000-000000000013', 'Seated Cable Row', 'Cable', 'Back', 'Pull', 'reps_load'::"tracking_type", 'Sit tall with your feet braced and knees soft. Pull the handle to your belly, squeeze your shoulder blades together, then extend your arms slowly.'),
  ('e0000000-0000-4000-8000-000000000014', 'Face Pull', 'Cable', 'Shoulders', 'Pull', 'reps_load'::"tracking_type", 'Set a rope at upper chest height. Pull it toward your face with your elbows high, separating the ends, then return slowly.'),
  ('e0000000-0000-4000-8000-000000000015', 'Inverted Row', 'Bodyweight', 'Back', 'Pull', 'reps_load'::"tracking_type", 'Lie under a low bar and grip it with straight arms and a straight body. Pull your chest to the bar, then lower.'),
  ('e0000000-0000-4000-8000-000000000016', 'Straight-Arm Pulldown', 'Cable', 'Back', 'Isolation', 'reps_load'::"tracking_type", 'Stand facing a high cable with straight arms. Sweep the bar down to your thighs without bending your elbows, then raise it slowly.'),
  ('e0000000-0000-4000-8000-000000000017', 'Overhead Press', 'Barbell', 'Shoulders', 'Push', 'reps_load'::"tracking_type", 'Stand with the bar at shoulder height. Brace your core and press the bar overhead until your arms lock out, then lower it back.'),
  ('e0000000-0000-4000-8000-000000000018', 'Seated Dumbbell Shoulder Press', 'Dumbbell', 'Shoulders', 'Push', 'reps_load'::"tracking_type", 'Sit with your back supported and the dumbbells at shoulder height. Press them overhead together, then lower with control.'),
  ('e0000000-0000-4000-8000-000000000019', 'Lateral Raise', 'Dumbbell', 'Shoulders', 'Isolation', 'reps_load'::"tracking_type", 'Stand holding light dumbbells at your sides. Raise your arms out to shoulder height with a slight elbow bend, then lower slowly.'),
  ('e0000000-0000-4000-8000-000000000020', 'Rear Delt Fly', 'Dumbbell', 'Shoulders', 'Isolation', 'reps_load'::"tracking_type", 'Hinge forward with a flat back and dumbbells hanging down. Open your arms out to the sides until level with your back, then lower.'),
  ('e0000000-0000-4000-8000-000000000021', 'Front Raise', 'Dumbbell', 'Shoulders', 'Isolation', 'reps_load'::"tracking_type", 'Stand holding dumbbells in front of your thighs. Lift one or both to shoulder height with straight arms, then lower slowly.'),
  ('e0000000-0000-4000-8000-000000000022', 'Upright Row', 'Barbell', 'Shoulders', 'Pull', 'reps_load'::"tracking_type", 'Hold the bar with a shoulder-width grip. Pull it up along your body to chest height, leading with your elbows, then lower.'),
  ('e0000000-0000-4000-8000-000000000023', 'Dumbbell Shrug', 'Dumbbell', 'Shoulders', 'Isolation', 'reps_load'::"tracking_type", 'Stand holding dumbbells at your sides. Lift your shoulders straight up toward your ears, pause, then lower.'),
  ('e0000000-0000-4000-8000-000000000024', 'Barbell Curl', 'Barbell', 'Biceps', 'Isolation', 'reps_load'::"tracking_type", 'Stand holding the bar with an underhand grip. Curl it to shoulder height without swinging, then lower fully.'),
  ('e0000000-0000-4000-8000-000000000025', 'Dumbbell Curl', 'Dumbbell', 'Biceps', 'Isolation', 'reps_load'::"tracking_type", 'Stand with a dumbbell in each hand, palms forward. Curl them up while keeping your elbows by your sides, then lower slowly.'),
  ('e0000000-0000-4000-8000-000000000026', 'Hammer Curl', 'Dumbbell', 'Biceps', 'Isolation', 'reps_load'::"tracking_type", 'Hold dumbbells with palms facing each other. Curl them up without turning your wrists, then lower with control.'),
  ('e0000000-0000-4000-8000-000000000027', 'Cable Curl', 'Cable', 'Biceps', 'Isolation', 'reps_load'::"tracking_type", 'Face a low pulley holding a straight bar. Curl the bar up while your elbows stay still, then lower slowly.'),
  ('e0000000-0000-4000-8000-000000000028', 'Triceps Pushdown', 'Cable', 'Triceps', 'Isolation', 'reps_load'::"tracking_type", 'Stand at a high pulley with your elbows tucked in. Press the bar down until your arms are straight, then let it rise slowly.'),
  ('e0000000-0000-4000-8000-000000000029', 'Overhead Triceps Extension', 'Dumbbell', 'Triceps', 'Isolation', 'reps_load'::"tracking_type", 'Hold one dumbbell overhead with both hands. Bend your elbows to lower it behind your head, then straighten your arms.'),
  ('e0000000-0000-4000-8000-000000000030', 'Skull Crusher', 'Barbell', 'Triceps', 'Isolation', 'reps_load'::"tracking_type", 'Lie on a bench with the bar over your chest. Bend only your elbows to lower the bar toward your forehead, then press it back up.'),
  ('e0000000-0000-4000-8000-000000000031', 'Close-Grip Bench Press', 'Barbell', 'Triceps', 'Push', 'reps_load'::"tracking_type", 'Lie on a bench and grip the bar about shoulder width. Lower it to your lower chest with elbows close, then press up.'),
  ('e0000000-0000-4000-8000-000000000032', 'Bench Dip', 'Bodyweight', 'Triceps', 'Push', 'reps_load'::"tracking_type", 'Sit on the edge of a bench with hands beside your hips. Slide forward, lower your body by bending your elbows, then press back up.'),
  ('e0000000-0000-4000-8000-000000000033', 'Back Squat', 'Barbell', 'Quads', 'Squat', 'reps_load'::"tracking_type", 'Rest the bar across your upper back. Sit down and back until your thighs are about parallel, keeping your chest up, then stand.'),
  ('e0000000-0000-4000-8000-000000000034', 'Front Squat', 'Barbell', 'Quads', 'Squat', 'reps_load'::"tracking_type", 'Hold the bar on the front of your shoulders with elbows high. Squat down keeping your torso upright, then drive back up.'),
  ('e0000000-0000-4000-8000-000000000035', 'Goblet Squat', 'Dumbbell', 'Quads', 'Squat', 'reps_load'::"tracking_type", 'Hold one dumbbell at your chest. Squat down between your knees with your chest up, then stand.'),
  ('e0000000-0000-4000-8000-000000000036', 'Bodyweight Squat', 'Bodyweight', 'Quads', 'Squat', 'reps_load'::"tracking_type", 'Stand with feet shoulder width apart. Sit your hips back and down, keep your heels flat, then stand tall.'),
  ('e0000000-0000-4000-8000-000000000037', 'Leg Press', 'Machine', 'Quads', 'Squat', 'reps_load'::"tracking_type", 'Sit with your feet shoulder width on the platform. Lower the sled until your knees are bent deeply, then press it away without locking out hard.'),
  ('e0000000-0000-4000-8000-000000000038', 'Leg Extension', 'Machine', 'Quads', 'Isolation', 'reps_load'::"tracking_type", 'Sit with the pad on your lower shins. Straighten your knees to lift the weight, pause, then lower slowly.'),
  ('e0000000-0000-4000-8000-000000000039', 'Walking Lunge', 'Dumbbell', 'Quads', 'Lunge', 'reps_load'::"tracking_type", 'Hold dumbbells at your sides. Step forward and lower until both knees are bent, then push through your front foot into the next step.'),
  ('e0000000-0000-4000-8000-000000000040', 'Reverse Lunge', 'Bodyweight', 'Quads', 'Lunge', 'reps_load'::"tracking_type", 'Step one foot back and lower your back knee toward the floor. Push through your front foot to return, then switch sides.'),
  ('e0000000-0000-4000-8000-000000000041', 'Bulgarian Split Squat', 'Dumbbell', 'Quads', 'Lunge', 'reps_load'::"tracking_type", 'Rest your rear foot on a bench behind you. Lower straight down on your front leg, then drive back up.'),
  ('e0000000-0000-4000-8000-000000000042', 'Step-Up', 'Dumbbell', 'Quads', 'Lunge', 'reps_load'::"tracking_type", 'Place one foot on a sturdy box. Press through that foot to stand on the box, then lower yourself back down slowly.'),
  ('e0000000-0000-4000-8000-000000000043', 'Romanian Deadlift', 'Barbell', 'Hamstrings', 'Hinge', 'reps_load'::"tracking_type", 'Hold the bar at your thighs with soft knees. Push your hips back and slide the bar down your legs until you feel a hamstring stretch, then stand.'),
  ('e0000000-0000-4000-8000-000000000044', 'Conventional Deadlift', 'Barbell', 'Hamstrings', 'Hinge', 'reps_load'::"tracking_type", 'Stand with the bar over your mid foot. Grip it, brace, and push the floor away until you are standing tall, then lower it under control.'),
  ('e0000000-0000-4000-8000-000000000045', 'Seated Leg Curl', 'Machine', 'Hamstrings', 'Isolation', 'reps_load'::"tracking_type", 'Sit with the pad above your heels. Curl your heels back and under the seat, pause, then return slowly.'),
  ('e0000000-0000-4000-8000-000000000046', 'Lying Leg Curl', 'Machine', 'Hamstrings', 'Isolation', 'reps_load'::"tracking_type", 'Lie face down with the pad just above your heels. Bend your knees to bring the pad toward your glutes, then lower slowly.'),
  ('e0000000-0000-4000-8000-000000000047', 'Good Morning', 'Barbell', 'Hamstrings', 'Hinge', 'reps_load'::"tracking_type", 'Hold the bar across your upper back. Push your hips back with a flat back until your torso is near level, then stand.'),
  ('e0000000-0000-4000-8000-000000000048', 'Hip Thrust', 'Barbell', 'Glutes', 'Hinge', 'reps_load'::"tracking_type", 'Rest your upper back on a bench with the bar across your hips. Drive your hips up until your body forms a straight line, then lower.'),
  ('e0000000-0000-4000-8000-000000000049', 'Glute Bridge', 'Bodyweight', 'Glutes', 'Hinge', 'reps_load'::"tracking_type", 'Lie on your back with knees bent. Lift your hips by squeezing your glutes until your body is straight from shoulders to knees, then lower.'),
  ('e0000000-0000-4000-8000-000000000050', 'Cable Pull-Through', 'Cable', 'Glutes', 'Hinge', 'reps_load'::"tracking_type", 'Face away from a low pulley holding the rope between your legs. Hinge back, then drive your hips forward to stand tall.'),
  ('e0000000-0000-4000-8000-000000000051', 'Standing Calf Raise', 'Machine', 'Calves', 'Isolation', 'reps_load'::"tracking_type", 'Stand with the balls of your feet on the platform. Rise onto your toes, pause at the top, then lower your heels below the platform.'),
  ('e0000000-0000-4000-8000-000000000052', 'Seated Calf Raise', 'Machine', 'Calves', 'Isolation', 'reps_load'::"tracking_type", 'Sit with the pad on your thighs. Lift your heels as high as you can, pause, then lower slowly.'),
  ('e0000000-0000-4000-8000-000000000053', 'Kettlebell Swing', 'Kettlebell', 'Glutes', 'Hinge', 'reps_load'::"tracking_type", 'Hinge back and swing the kettlebell between your legs. Snap your hips forward to float it to chest height, then let it fall back.'),
  ('e0000000-0000-4000-8000-000000000054', 'Kettlebell Goblet Squat', 'Kettlebell', 'Quads', 'Squat', 'reps_load'::"tracking_type", 'Hold a kettlebell by the horns at your chest. Squat deep with your elbows inside your knees, then stand.'),
  ('e0000000-0000-4000-8000-000000000055', 'Banded Pull-Apart', 'Band', 'Shoulders', 'Pull', 'reps_load'::"tracking_type", 'Hold a band at chest height with straight arms. Pull your hands apart until the band touches your chest, then return slowly.'),
  ('e0000000-0000-4000-8000-000000000056', 'Banded Good Morning', 'Band', 'Hamstrings', 'Hinge', 'reps_load'::"tracking_type", 'Stand on a band and loop it over your shoulders. Push your hips back with a flat spine, then stand tall.'),
  ('e0000000-0000-4000-8000-000000000057', 'Hanging Knee Raise', 'Bodyweight', 'Core', 'Core', 'reps_load'::"tracking_type", 'Hang from a bar. Lift your knees toward your chest without swinging, then lower under control.'),
  ('e0000000-0000-4000-8000-000000000058', 'Cable Crunch', 'Cable', 'Core', 'Core', 'reps_load'::"tracking_type", 'Kneel below a high pulley holding the rope at your head. Curl your ribs toward your hips, then return slowly.'),
  ('e0000000-0000-4000-8000-000000000059', 'Crunch', 'Bodyweight', 'Core', 'Core', 'reps_load'::"tracking_type", 'Lie on your back with knees bent. Curl your shoulders off the floor by tightening your abs, then lower.'),
  ('e0000000-0000-4000-8000-000000000060', 'Russian Twist', 'Bodyweight', 'Core', 'Core', 'reps_load'::"tracking_type", 'Sit leaning back slightly with feet raised or down. Rotate your torso side to side, touching the floor beside each hip.'),
  ('e0000000-0000-4000-8000-000000000061', 'Ab Wheel Rollout', 'Other', 'Core', 'Core', 'reps_load'::"tracking_type", 'Kneel holding the wheel under your shoulders. Roll forward as far as you can keep your back flat, then pull back in.'),
  ('e0000000-0000-4000-8000-000000000062', 'Dead Bug', 'Bodyweight', 'Core', 'Core', 'reps_load'::"tracking_type", 'Lie on your back with arms up and knees over hips. Lower the opposite arm and leg while keeping your back flat, then switch.'),
  ('e0000000-0000-4000-8000-000000000063', 'Back Extension', 'Bodyweight', 'Back', 'Hinge', 'reps_load'::"tracking_type", 'Set the pad at your hips on a back extension bench. Hinge down, then lift your torso until your body is in a straight line.'),
  ('e0000000-0000-4000-8000-000000000064', 'Farmer Carry', 'Dumbbell', 'Full body', 'Carry', 'reps_load'::"tracking_type", 'Hold a heavy dumbbell in each hand at your sides. Stand tall and take steady steps, then set them down. Track the weight and steps.'),
  ('e0000000-0000-4000-8000-000000000065', 'Plank', 'Bodyweight', 'Core', 'Core', 'duration'::"tracking_type", 'Rest on your forearms and toes with your body in a straight line. Keep your abs tight and breathe steadily for the full time.'),
  ('e0000000-0000-4000-8000-000000000066', 'Side Plank', 'Bodyweight', 'Core', 'Core', 'duration'::"tracking_type", 'Lie on your side and prop up on one forearm. Lift your hips so your body is straight, and hold. Repeat on the other side.'),
  ('e0000000-0000-4000-8000-000000000067', 'Hollow Hold', 'Bodyweight', 'Core', 'Core', 'duration'::"tracking_type", 'Lie on your back, press your low back into the floor, and lift your shoulders and legs slightly. Hold the shape.'),
  ('e0000000-0000-4000-8000-000000000068', 'Dead Hang', 'Bodyweight', 'Back', 'Pull', 'duration'::"tracking_type", 'Hang from a bar with straight arms and relaxed shoulders. Hold for time, keeping a firm grip.'),
  ('e0000000-0000-4000-8000-000000000069', 'Wall Sit', 'Bodyweight', 'Quads', 'Squat', 'duration'::"tracking_type", 'Lean against a wall and slide down until your thighs are level with the floor. Hold for time.'),
  ('e0000000-0000-4000-8000-000000000070', 'Glute Bridge Hold', 'Bodyweight', 'Glutes', 'Hinge', 'duration'::"tracking_type", 'Lie on your back and lift your hips into a bridge. Hold the top position and squeeze your glutes.'),
  ('e0000000-0000-4000-8000-000000000071', 'Jump Rope', 'Other', 'Cardio', 'Cardio', 'duration'::"tracking_type", 'Turn the rope with your wrists and hop lightly on the balls of your feet. Keep a steady rhythm for the set time.'),
  ('e0000000-0000-4000-8000-000000000072', 'Stationary Bike', 'Cardio machine', 'Cardio', 'Cardio', 'duration'::"tracking_type", 'Adjust the seat so your knee is slightly bent at the bottom of each pedal turn. Ride at the effort the plan asks for.'),
  ('e0000000-0000-4000-8000-000000000073', 'Battle Rope Waves', 'Other', 'Full body', 'Cardio', 'duration'::"tracking_type", 'Hold a rope end in each hand and stand in an athletic stance. Make alternating waves with fast, steady arm movements.'),
  ('e0000000-0000-4000-8000-000000000074', 'Bear Crawl Hold', 'Bodyweight', 'Full body', 'Core', 'duration'::"tracking_type", 'Get on hands and toes with knees hovering just above the floor. Keep your back flat and hold the position.'),
  ('e0000000-0000-4000-8000-000000000075', 'Banded Squat Hold', 'Band', 'Quads', 'Squat', 'duration'::"tracking_type", 'Place a band above your knees. Sit into a half squat, push your knees out against the band, and hold.'),
  ('e0000000-0000-4000-8000-000000000076', 'Elliptical Trainer', 'Cardio machine', 'Cardio', 'Cardio', 'duration'::"tracking_type", 'Step on the pedals and hold the handles lightly. Keep a smooth stride for the time asked.'),
  ('e0000000-0000-4000-8000-000000000077', 'Outdoor Run', 'Other', 'Cardio', 'Cardio', 'distance'::"tracking_type", 'Run at the pace the plan describes on a safe route. Log the distance you cover.'),
  ('e0000000-0000-4000-8000-000000000078', 'Treadmill Run', 'Cardio machine', 'Cardio', 'Cardio', 'distance'::"tracking_type", 'Run on a treadmill at the planned speed and incline. Log the distance shown when you finish.'),
  ('e0000000-0000-4000-8000-000000000079', 'Rowing Machine', 'Cardio machine', 'Cardio', 'Cardio', 'distance'::"tracking_type", 'Drive with your legs first, then lean back and pull the handle to your lower ribs. Return in the reverse order and log the distance.'),
  ('e0000000-0000-4000-8000-000000000080', 'Brisk Walk', 'Other', 'Cardio', 'Cardio', 'distance'::"tracking_type", 'Walk at a pace that raises your breathing but still lets you talk. Log the distance covered.'),
  ('e0000000-0000-4000-8000-000000000081', 'Cycling', 'Other', 'Cardio', 'Cardio', 'distance'::"tracking_type", 'Ride at the planned effort on a bike. Log the distance you cover.'),
  ('e0000000-0000-4000-8000-000000000082', 'Swimming', 'Other', 'Full body', 'Cardio', 'distance'::"tracking_type", 'Swim at an easy, steady pace using the stroke the plan calls for. Log the total distance.'),
  ('e0000000-0000-4000-8000-000000000083', 'Sled Push', 'Other', 'Quads', 'Push', 'distance'::"tracking_type", 'Lean into the sled with straight arms and drive with short, powerful steps along the lane. Log the distance.'),
  ('e0000000-0000-4000-8000-000000000084', 'Sled Drag', 'Other', 'Hamstrings', 'Pull', 'distance'::"tracking_type", 'Walk backward or forward while dragging the sled with a harness or straps. Keep your chest up and log the distance.'),
  ('e0000000-0000-4000-8000-000000000085', 'Suitcase Carry', 'Kettlebell', 'Core', 'Carry', 'distance'::"tracking_type", 'Hold one heavy kettlebell at your side. Walk without leaning, keeping your shoulders level, then switch hands. Log the distance.'),
  ('e0000000-0000-4000-8000-000000000086', 'Hill Walk', 'Other', 'Glutes', 'Cardio', 'distance'::"tracking_type", 'Walk up an incline at a steady pace, leaning slightly forward. Log the distance covered.'),
  ('e0000000-0000-4000-8000-000000000087', 'Ski Erg', 'Cardio machine', 'Full body', 'Cardio', 'distance'::"tracking_type", 'Pull both handles down in an arc while hinging at your hips, then let them rise. Keep a steady rhythm and log the distance.'),
  ('e0000000-0000-4000-8000-000000000088', 'Bear Crawl', 'Bodyweight', 'Full body', 'Cardio', 'distance'::"tracking_type", 'Crawl forward on hands and toes with your knees just off the floor, moving opposite hand and foot together. Log the distance.')
ON CONFLICT ("id") DO NOTHING;

-- Row-Level Security. Globals are readable by every tenant; writes (and the rows a tenant may touch)
-- are limited to the tenant's own organization.
ALTER TABLE "exercises" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "exercises" FORCE ROW LEVEL SECURITY;
CREATE POLICY exercise_scope ON "exercises" FOR ALL
  USING (organization_id IS NULL OR organization_id = app_current_org() OR app_rls_bypass())
  WITH CHECK (organization_id = app_current_org() OR app_rls_bypass());
-- Defense in depth: the permissive policy above would still let a tenant DELETE a global row it can
-- see (DELETE has no WITH CHECK). Restrictive policies make globals immutable outside bypass.
CREATE POLICY exercise_globals_immutable_update ON "exercises" AS RESTRICTIVE FOR UPDATE
  USING (organization_id IS NOT NULL OR app_rls_bypass());
CREATE POLICY exercise_globals_immutable_delete ON "exercises" AS RESTRICTIVE FOR DELETE
  USING (organization_id IS NOT NULL OR app_rls_bypass());
