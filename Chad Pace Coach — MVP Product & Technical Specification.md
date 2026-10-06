# Chad Pace Coach — MVP Product & Technical Specification

## 1. Product concept

Build a mobile app specifically for the CrossFit Hero WOD **Chad 1000X**.

The core idea is:

> **The athlete sets a target finish time, places their phone where it can see them perform step-ups, and the app automatically counts reps while providing live pacing feedback.**

The athlete should **not need to touch the phone during the workout**.

The app combines:

1. Camera-based computer vision to count step-up reps.
2. A workout timer.
3. Target-time pacing calculations.
4. User-defined set/rotation structure.
5. Audio coaching.
6. Post-workout performance/history data.

This is intentionally an MVP, not a general CrossFit workout tracker.

---

# 2. Primary user experience

The ideal experience is:

1. Open app.
2. Select Chad.
3. Enter target finish time.
4. Select how they intend to break up the reps.
5. Position phone.
6. App verifies the athlete and box are visible.
7. Press Start.
8. Put phone down.
9. Complete Chad.
10. App automatically counts reps and provides pacing feedback.
11. Finish at 1,000 reps.
12. See final time and pacing breakdown.

The athlete should ideally never have to touch the phone after pressing **Start**.

---

# 3. Workout definition

MVP should support:

- Total reps: **1,000**
- Movement: weighted step-up
- Default box height: **20 inches**
- User-selected target finish time
- User-selected rep/set structure

The workout should not initially attempt to support arbitrary WODs.

Chad is the only workout.

---

# 4. Set structure

A key feature is allowing athletes to define how they intend to break up the 1,000 reps.

Example:

### 25-rep sets

The athlete performs:

- 25 reps
- rotate around box
- 25 reps
- rotate
- 25 reps
- rotate
- 25 reps
- rotate

= **100 reps per revolution**

Then repeat for 10 revolutions.

The app should therefore understand:

```text
Revolution 1
25 → 50 → 75 → 100

Revolution 2
125 → 150 → 175 → 200

...

Revolution 10
925 → 950 → 975 → 1000
```

The user should be able to select:

- 10 reps
- 25 reps
- 50 reps
- Custom

And define the number of sets per revolution.

Example:

```text
Set size: 25
Sets per revolution: 4
Reps per revolution: 100
```

This is primarily useful for pacing and audio feedback, but it should also help the computer-vision system identify movement/set transitions.

---

# 5. Setup screen

Example:

```text
CHAD

1,000 STEP-UPS

Target finish
[ 65:00 ]

Set size
[ 25 ]

Sets per revolution
[ 4 ]

100 reps / revolution

          START
```

Optional preset target times:

- 60:00
- 65:00
- 70:00
- 75:00

Allow arbitrary times as well.

---

# 6. Camera setup

Before starting, the app enters a camera preview.

The athlete should be instructed to position the phone so that:

- entire body is visible
- both feet can be seen
- box is visible
- enough space exists around the box for rotation
- lighting is adequate

The app should attempt to verify:

- person detected
- full body detected
- box detected
- feet visible
- sufficient image quality

Example:

```text
✓ Person detected
✓ Box detected
✓ Feet visible
✓ Good camera angle

Ready to start.

        START
```

If possible, provide simple corrective guidance:

```text
Move the camera back.
Your feet are outside the frame.
```

or:

```text
More light is needed.
```

The workout should not start until minimum detection requirements are met.

---

# 7. Computer vision / rep counting

This is the most important technical component.

The system needs to determine when the athlete completes a valid step-up and automatically increment the rep count.

Do NOT initially attempt to build a generalized "CrossFit movement recognition" system.

Chad is deliberately constrained.

The computer vision system should identify:

- athlete
- body pose/keypoints
- feet
- box
- approximate box position/height
- athlete's vertical movement
- transition from floor → box → floor

A conceptual rep state machine:

```text
FLOOR
  ↓
STEP-UP INITIATED
  ↓
FOOT/BODY REACHES BOX HEIGHT
  ↓
ATHLETE ON BOX
  ↓
RETURN TO FLOOR
  ↓
VALID REP
```

The system should use temporal information rather than making an independent decision from a single frame.

A rep should only be counted after a complete movement cycle.

---

# 8. Rep confidence

The system should maintain a confidence score for each potential rep.

Conceptually:

```text
Rep candidate: 347
Confidence: 0.97
```

High-confidence reps are counted immediately.

Low-confidence movement should not automatically increment the counter.

The system should use multiple frames and movement history to resolve ambiguous cases.

Avoid false positives at all costs.

A missed rep is annoying.

A counter that says the athlete completed 1,000 when they actually completed 950 destroys trust in the product.

---

# 9. Rotation awareness

The athlete may move around the box between sets.

The computer vision system should therefore distinguish:

**rep movement**

from:

**athlete repositioning/rotation.**

A rotation should not produce one or more phantom reps.

The selected set structure can help here.

For example, if the athlete has selected:

```text
25 reps × 4 = 100/revolution
```

then after approximately 25 detected reps, the app expects a short transition before the next set.

This should be treated as contextual information rather than a hard rule. The athlete may do 24/26 or change strategy.

The app should never prevent counting simply because the athlete deviated from the planned structure.

---

# 10. Main workout screen

The athlete should be able to glance at the phone, but should not need to.

Primary display:

```text
CHAD

347
/ 1000

23:04

+0:22 AHEAD

REVOLUTION 4

75 / 100
```

Important information:

- elapsed time
- detected reps
- reps remaining
- ahead/behind target
- current revolution
- current set progress

The rep count should be the largest element.

---

# 11. Pacing algorithm

The app needs three different pace calculations.

## A. Target pace

Target reps per second:

```text
target_reps_per_second =
    1000 / target_time_seconds
```

For a 65:00 target:

```text
1000 / 3900
= 0.2564 reps/sec
```

or:

```text
15.38 reps/minute
```

---

## B. Expected reps at current time

```text
expected_reps =
    elapsed_seconds × target_reps_per_second
```

Example:

At 30:00 with a 65:00 goal:

```text
1800 × 0.2564
≈ 462 reps
```

If athlete has completed 470:

```text
+8 reps ahead
```

---

## C. Required finishing pace

This is the most actionable pace metric.

```text
remaining_reps =
    1000 - completed_reps

remaining_time =
    target_time - elapsed_time

required_pace =
    remaining_reps / remaining_time
```

Example:

```text
Goal: 65:00
Elapsed: 40:00
Reps: 590

Remaining:
410 reps
25 minutes

Required pace:
16.4 reps/minute
```

The UI should communicate this when the athlete is behind.

---

# 12. Projected finish time

Also calculate:

```text
projected_finish =
    elapsed_time +
    (remaining_reps / current_pace)
```

However, current pace should not simply mean total-average pace.

Maintain at least:

- overall average pace
- recent/rolling pace

A rolling window of approximately 2–5 minutes would be useful.

Example:

```text
Overall pace: 15.1/min
Last 5 min:   14.2/min
Required:     16.4/min

Projected finish: 67:18
```

This gives the athlete a realistic picture of their current trajectory.

---

# 13. Revolution pacing

For athletes using the 25 × 4 strategy:

A 65-minute goal means:

```text
65 minutes / 10 revolutions
= 6:30 per revolution
```

The app should therefore also calculate revolution pacing.

Example:

```text
REVOLUTION 4

Target: 6:30
Actual: 6:24

+0:06
```

This is arguably more intuitive for the athlete than reps/minute.

The app should support both views.

---

# 14. Audio coaching

Audio should be a major component because the athlete should not have to look at the phone.

For a 25-rep set:

```text
25.
```

Then:

```text
50.
```

Then:

```text
75.
```

Then:

```text
100. One revolution.
```

The app should allow audio feedback to be enabled/disabled.

### Audio modes

#### Rep Coach

Announce meaningful rep milestones:

- 25
- 50
- 75
- 100
- etc.

#### Pace Coach

Periodically announce pacing status:

> "You're 22 seconds ahead."

> "You're 35 seconds behind."

> "Required pace is 15.8 per minute."

#### Full Coach

Combination of rep/set announcements and pacing feedback.

The app should avoid talking constantly.

Audio should be useful, not annoying.

---

# 15. Pacing feedback rules

Avoid constantly announcing tiny fluctuations.

For example, don't say:

> "You're 3 seconds behind."

Instead use meaningful thresholds.

Potential initial rules:

```text
< 15 sec difference
No announcement

15–30 sec ahead/behind
Occasional status

> 30 sec
More prominent feedback

> 60 sec
Explicit pacing correction
```

These thresholds should be configurable/tunable after testing.

---

# 16. Revolution progress UI

For a 25 × 4 strategy:

```text
REVOLUTION 4 / 10

✓ 25
✓ 50
● 75
○ 100
```

When the athlete reaches 100:

```text
ONE REVOLUTION

6:24

+0:06 AHEAD
```

Then automatically advance:

```text
REVOLUTION 5 / 10
```

Again, this is informational. The vision system should continue counting reps regardless of whether the athlete follows the expected set pattern.

---

# 17. Workout completion

At 1,000 valid reps:

Stop the timer automatically.

Display:

```text
CHAD COMPLETE

63:42

GOAL
65:00

+1:18

Average pace
15.69/min

Revolutions
10

Fastest revolution
6:11

Slowest revolution
6:48
```

Optional:

```text
SAVE RESULT
```

The user should not have to manually stop the timer.

---

# 18. Workout history

Save each workout.

Example:

```text
CHAD HISTORY

Oct 5
63:42   PR

Sep 14
65:08

Aug 20
71:31
```

Opening a result should show:

- target time
- actual time
- average pace
- revolution times
- set times
- pace graph
- projected finish over time

---

# 19. Pace graph

The app should record the rep timestamp data so the workout can later be visualized.

Graph:

```text
REPS
1000 |                         /
     |                      __/
 800 |                  ___/
     |              ___/
 600 |          ___/
     |       __/
 400 |    __/
     |___/
   0 +---------------------------
       0   15   30   45   60  65
                 TIME
```

One line = target trajectory.

One line = actual performance.

This makes it obvious where the athlete gained or lost time.

---

# 20. Future feature: Ghost Mode

Do not necessarily implement this in the first development sprint, but design the data model so it is possible.

Once an athlete has completed Chad:

> **Race Previous Chad**

The app compares current reps against the previous workout.

Example audio:

> "Rep 400. You're 34 seconds ahead of your previous Chad."

Later:

> "Rep 700. You're 12 seconds behind."

This could become one of the strongest retention features.

---

# 21. Data model

A minimal workout record should contain something similar to:

```text
Workout
--------
id
date
target_time
actual_time
total_reps
set_size
sets_per_revolution
reps_per_revolution
box_height

RepEvent
--------
workout_id
timestamp
cumulative_rep
confidence

SetEvent
--------
workout_id
timestamp
set_number
cumulative_rep

RevolutionEvent
--------
workout_id
timestamp
revolution_number
cumulative_rep
```

The important part is storing **rep timestamps**, not merely the final rep count.

Those timestamps enable:

- pace calculations
- rolling pace
- projected finish
- revolution times
- pace graphs
- Ghost Mode
- future analytics

---

# 22. MVP priorities

### Must have

1. Chad 1000X workout
2. Target finish time
3. Camera setup/validation
4. Automatic rep detection
5. Reliable rep counter
6. Automatic timer
7. Ahead/behind pacing
8. Required finishing pace
9. Audio rep announcements
10. Workout completion at 1,000
11. Save workout history

### Should have

1. 25-rep set structure
2. Revolution tracking
3. Revolution pacing
4. Rolling pace
5. Projected finish
6. Pace graph

### Later

1. Apple Watch
2. Ghost Mode
3. Additional WODs
4. More sophisticated coaching
5. Cloud sync
6. Social/leaderboards
7. Custom workouts

---

# 23. Product philosophy

The app should **not** become another generic WOD tracker.

The core product is:

> **Put your phone down and let it coach you through Chad.**

The athlete should be able to start the workout, walk away from the phone, and simply perform.

The computer vision handles the bookkeeping.

The pacing engine handles the math.

The audio coach handles the feedback.

The athlete handles the step-ups.

The first version should prioritize **trustworthy rep counting and excellent pacing feedback** over adding lots of features.