import { h } from "./dom";
import { go } from "./router";
import type { Screen } from "./router";

const strong = (text: string) => h("strong", {}, text);

const externalLink = (label: string, href: string) =>
  h("a", { class: "link-btn", href, target: "_blank", rel: "noopener noreferrer" }, h("span", {}, label), h("span", { class: "arrow", "aria-hidden": "true" }, "↗"));

const action = (label: string, href: string) => h("a", { class: "btn crisis-btn", href }, label);

export const aboutScreen: Screen = (root) => {
  root.append(
    h(
      "main",
      { class: "screen about" },
      h("header", { class: "topbar" }, h("button", { type: "button", class: "btn round", "aria-label": "Back", onClick: () => (history.length > 1 ? history.back() : go("home")) }, "‹"), h("h2", {}, "About Chad")),
      h(
        "article",
        { class: "prose" },
        h("p", {}, strong("Chad"), " is a CrossFit Hero workout honoring ", strong("Navy SEAL Chad Wilkinson"), ", who served 22 years on active duty. On October 29, 2018, Chad took his own life after the effects of numerous deployments, traumatic brain injuries, blast exposure and PTSD."),
        h("p", {}, "His wife, Sara, shared that Chad trained for a climb of Aconcagua by doing 1,000 step-ups in their garage with a pack on his back. His friend Dave Castro made that a Hero workout: 1,000 step-ups on a 20\" box with a 45 lb ruck (35 lb for women)."),
        h("p", {}, "Today, ", strong("CHAD1000X"), ", presented by Sara Wilkinson with GORUCK and CrossFit, raises awareness and funds for veteran suicide prevention and mental health, including Sara's nonprofit, ", strong("The Step Up Foundation"), "."),
      ),
      h(
        "aside",
        { class: "crisis", "aria-label": "Support resources" },
        h("p", {}, strong("If you or someone you know is struggling:"), " call or text ", strong("988"), " (Suicide & Crisis Lifeline, US). Veterans: dial 988 and press 1, or text 838255."),
        h("div", { class: "crisis-actions" }, action("Call 988", "tel:988"), action("Text 988", "sms:988"), action("Text 838255", "sms:838255")),
      ),
      h(
        "section",
        { class: "block" },
        h("h3", { class: "label" }, "Learn more and give:"),
        externalLink("CHAD1000X", "https://www.goruck.com/pages/chad-1000x"),
        externalLink("CrossFit's story", "https://crossfit.com/essentials/chad1000x-honoring-navy-seal-chad-wilkinson"),
        externalLink("The Step Up Foundation", "https://www.stepupfoundation.org/"),
      ),
      h("p", { class: "footnote" }, "This app is an independent tribute and isn't affiliated with CrossFit, GORUCK or The Step Up Foundation."),
    ),
  );
};
