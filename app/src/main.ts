import "./style.css";
import { aboutScreen } from "./ui/about";
import { cameraSetupScreen } from "./ui/cameraSetup";
import { completeScreen } from "./ui/complete";
import { historyScreen } from "./ui/history";
import { homeScreen } from "./ui/home";
import { startRouter } from "./ui/router";
import { settingsScreen } from "./ui/settingsScreen";
import { startSplash } from "./ui/splash";
import { workoutScreen } from "./ui/workout";

startRouter(
  document.querySelector<HTMLElement>("#app")!,
  { home: homeScreen, setup: cameraSetupScreen, workout: workoutScreen, complete: completeScreen, history: historyScreen, settings: settingsScreen, about: aboutScreen },
  "home",
);

startSplash();

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
  });
}
