# Chad Pace Coach

Put your phone down and let it coach you through Chad (1,000 weighted step-ups).

The camera counts reps, a pacing engine tracks you against a target finish time, and a voice coach calls out
set milestones, revolution splits and ahead/behind status. Pose estimation runs on-device in the browser;
video never leaves the phone (note: the MediaPipe library itself sends usage logs to Google (odml.pa.googleapis.com)). It is
an installable PWA, so it works on iPhone (Safari → Share → Add to Home Screen), Android and desktop.

## Run it

```sh
npm install
npm run dev          # http://localhost:5173 (camera works on localhost)
npm test             # unit tests (pacing, session, coach, stats, vision state machine)
npm run build        # production build in dist/ (static files; host anywhere)
```

Camera access requires HTTPS on a phone. Choose one:

- `npm run dev:https` and open `https://<your-computer-ip>:5173` on the phone (accept the self-signed cert warning).
  Under WSL2 the phone can't reach WSL's internal IP: enable mirrored networking (`networkingMode=mirrored` in
  `%UserProfile%\.wslconfig`) or forward the port from Windows
  (`netsh interface portproxy add v4tov4 listenport=5173 connectport=5173 connectaddress=<wsl-ip>`), and allow it through the firewall; or
- deploy `dist/` to any static HTTPS host (GitHub Pages, Netlify, Cloudflare Pages). The build uses relative paths, so a subpath works.

After the first load, the app works offline. The pose model and wasm come from a CDN and are cached the first time
you open camera setup while online, so do that once before relying on it at a gym without signal.

## Using it

1. Pick a target time, set size and sets per revolution. Choose **Camera** or **Manual tap** counting.
2. Camera setup: prop the phone 2–4 m away with your whole body and the box in frame. Then:
   - Stand still next to the box until it says so.
   - Step up and stand still on the box. This calibrates the box height.
   - START unlocks once every check passes.
3. Tap START and walk away. The app counts, paces and talks. It finishes on its own at 1,000.
   - If a rep is miscounted, use the **−1 / +1** buttons.
   - After rep 1,000 there is a 5-second **Undo** window before the result is saved.
4. History shows every workout, including revolution splits, set times and a pace graph of target vs. actual.
   You can export it as JSON.

## Layout

| Path | What it does |
|---|---|
| `src/core/` | Pure logic: pacing math (§11–13), the workout session and its set/revolution events, the coach script (what to say and when, §14–15), summary stats |
| `src/vision/` | `poseEngine` (the only MediaPipe/camera code), `calibrator` (box height), `setup` (framing checks), `repDetector` (the rep state machine) |
| `src/ui/` | The screens: home, cameraSetup, workout, complete, history, settings |
| `src/platform/` | IndexedDB storage, speech queue, wake lock, settings |
| `CONTRACTS.md` | Module interfaces |

Each workout stores rep timestamps with a confidence value, plus set and revolution events (§21). That is
enough data for pace graphs, rolling pace and a future Ghost Mode (`ghostDeltaSec` already exists in `core/stats.ts`).

## Deliberate deviations from the spec

- **A PWA instead of a native iOS app.** One codebase covers iOS, Android and desktop, and it can be built and
  tested without a Mac. On-device pose estimation (MediaPipe) runs in Safari. If App Store distribution or
  Apple Watch support is needed later, wrap it with Capacitor, or port `src/core` (dependency-free) to Swift.
- **Box detection is a calibration step, not object recognition.** Generic box detection is unreliable, and
  it would not tell us the thing we need: how high the athlete's feet rise. The athlete instead stands next
  to the box, then on it. That confirms the box exists and measures its height relative to the athlete's
  torso, which makes the measurement independent of camera distance.
- **A manual tap mode and ±1 corrections.** The spec says the athlete never needs to touch the phone, and in
  camera mode they don't. But a counter you cannot correct is worse than one you can. Manual mode also
  covers gyms where the camera can't be placed well.
- **An undo window at 1,000.** One false positive on the last rep would otherwise end the workout early.
- **Revolution splits use that revolution's own delta.** "6 seconds under target" is compared against
  6:30, not against the cumulative gap, matching the example in §13.
- **The coach rate-limits itself.** Pace status is silent inside the quiet threshold, comes at most every
  3 min when the gap is small and every 90 s when it is large, and never within 8 s of a milestone. Set
  calls are skipped for tiny set sizes, so the coach doesn't talk on every rep.

## Known limitations of camera counting

The detector errs toward missing a rep rather than inventing one (§8). It has been tested against synthetic
pose sequences, including rotations, camera bumps, squats, lunges, jumps, bystanders and occlusion, but not
yet against a real Chad on real hardware. Expect to tune `Settings → rep confidence` after the first real
sessions. It counts best when:

- the camera sees you front-on or at an angle (side-on works, but is less reliable),
- both feet are visible when you are on the box, and nobody else stands between you and the phone,
- you pause briefly on the floor between reps (the normal Chad rhythm is fine).

## Splash video

The launch splash plays a pre-rendered video (`public/splash/`) with HTML overlays for the text and the wordmark match cut onto the home header. Files:

- `splash.mp4` (H.264/HEVC, tried first by Safari), `splash.webm`, `poster.jpg`, `markers.json` (seconds: `revealStart`, `slowmoStart`, `echoesStart`, `thousandAt`, `freezeAt`, `outlineAt`, `end`, plus `thousandOut` and `wordmarkAt`; the last two fall back to `freezeAt`+0.7 and `outlineAt`+0.8 if absent).
- The video is rendered in Blender by a separate pipeline that isn't part of this repo (it holds private reference material). To update the splash, replace these four files with a new render's output.
- Opening the app (a new tab, or relaunching the home-screen app) plays the full sequence; refreshing within the same session holds the final outline frame (`outline.jpg`) with the CHAD wordmark for 1.5 s. Settings > Replay intro plays the full sequence on demand. Tap or any key skips. No splash on `#/workout` links.
- If the video fails to start within 1.2 s, or with reduced motion, the poster and static wordmark show for 0.8 s.
- `public/` is copied into `dist/` and the service worker precaches everything in `dist/`, so the splash works offline.
