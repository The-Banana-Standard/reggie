// Reggie Guidebook — idea.js
// The idea action on every page (decision of 2026-09-15): one header button that captures a line
// into the repo the page belongs to, then opens a shaping session with the page's entity as the
// context pack's path. The popover owns the whole sequence; app.js mounts the trigger and the
// workspace tiles ask for a button of their own.
//
//   mountIdeaTrigger()            wires #idea-trigger and follows the route
//   originFor(route)              the origin fields a page posts to /api/capture, null off-repo
//   ideaButtonFor(repo)           the .ws-tile__idea button for a workspace tile
//
// It composes what the board already has (makeLauncher, commandField, the tool constants) rather
// than copying it. Shapes follow docs/ui-api-contract.md; DOM names follow ui/DOM-CONTRACT.md.

import { $, api, currentRoute, entityLink, formatRoute, h, icon, invalidate, isPhone, mount, on, post, render, serveKey, state, toast, withRepo } from "./app.js";
import { commandField, friendlyError, LAUNCH_TOOLS, makeLauncher, rememberedTool, rememberTool, TOOL_LABEL } from "./board.js";

/** How long a launch may run before the command is handed over to run by hand, as the board does. */
const SLOW_MS = 6000;

/** A symbol name the capture resolver accepts; the same rule the server applies (`CAPTURE_SYMBOL_RE`). */
const SYMBOL_NAME = /^[A-Za-z_$][A-Za-z0-9_$]{0,199}$/;

/**
 * The origin a page posts: the folder for an area, the file for a file, the file and the name for a
 * symbol, the task for a task page, nothing for the repo-level pages (the overview, the board, the
 * services and flow pages, people and time), and null where there is no single repo to capture into.
 * Only these three keys ever reach the capture body. A symbol page is the file level by the brief,
 * so a name the resolver would refuse (the code map names a star re-export `*`) posts the file alone
 * rather than a symbol the server answers 400 to.
 */
export function originFor(route) {
  switch (route?.level) {
    case "area":
    case "file":
      return { path: String(route.id ?? "") };
    case "symbol": {
      const [file, ...rest] = String(route.id ?? "").replace(/^sym:/, "").split("::");
      const name = rest.join("::");
      return rest.length > 0 && SYMBOL_NAME.test(name) ? { path: file, symbol: name } : { path: file };
    }
    case "task":
      return { task: String(route.id ?? "") };
    case "repo":
    case "tasks":
    case "services":
    case "flows":
    case "flow":
    case "route":
    case "concept":
    case "people":
    case "person":
    case "time":
      return {};
    default:
      return null;
  }
}

/** The paths the pack is built around: the origin's path, when it has one. */
function packPathsOf(origin) {
  return origin?.path ? [origin.path] : [];
}

/** "Into `reggie`, from the file `src/serve.ts`." — where the idea will land, as one line. */
function whereSentence(repo, origin, level) {
  const parts = ["Into ", h("code", {}, repo)];
  if (origin?.task) parts.push(", from the task ", h("code", {}, origin.task));
  else if (origin?.symbol) parts.push(", from ", h("code", {}, origin.symbol), " in the file ", h("code", {}, origin.path));
  else if (origin?.path) parts.push(`, from the ${level === "area" ? "folder" : "file"} `, h("code", {}, origin.path));
  else parts.push(", as a repo-wide idea");
  parts.push(".");
  return h("p", { class: "idea__where" }, ...parts);
}

/** One popover for the page, created on first use and moved under whichever control opened it. */
let popover = null;

/**
 * The control focus returns to and the popover sits under. A workspace tile is re-mounted when the
 * level redraws after a capture, so a tile button is found again by the repo it names rather than
 * kept by reference; the header trigger is the fallback for everything.
 */
function currentOpener() {
  const opener = popover?.opener ?? null;
  if (opener?.isConnected) return opener;
  const repo = opener?.dataset?.ideaRepo;
  const again = repo ? document.querySelector(`.ws-tile__idea[data-idea-repo="${CSS.escape(repo)}"]`) : null;
  if (again && popover) popover.opener = again;
  return again ?? $("idea-trigger");
}

function closeIdea() {
  if (!popover || popover.el.hidden) return false;
  popover.el.hidden = true;
  const opener = currentOpener();
  opener?.setAttribute?.("aria-expanded", "false");
  popover.opener = null;
  opener?.focus?.();
  return true;
}

/**
 * Under the control on a desktop, right-aligned so it never leaves the viewport, and above it when
 * there is no room below (a workspace tile sits at the foot of the map column); full width under
 * the header on a phone, where styles.css takes over and these inline values are cleared.
 */
function placeIdea(el, anchor) {
  if (isPhone() || !anchor) {
    el.style.left = "";
    el.style.top = "";
    return;
  }
  const r = anchor.getBoundingClientRect();
  el.style.left = "0px";
  el.style.top = "0px";
  const m = el.getBoundingClientRect();
  const left = Math.max(8, Math.min(r.right - m.width, window.innerWidth - m.width - 8));
  const below = r.bottom + 6;
  const top = below + m.height > window.innerHeight - 8 ? Math.max(8, r.top - m.height - 6) : below;
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;
}

/**
 * Open the popover for a target: `{ repo, origin, level, opener }`. `origin` is what `originFor`
 * gave (`{}` for a repo-wide idea, never null here) and `opener` is the control focus returns to.
 * While a submit is in flight the target is not replaced: the popover is shown again as it is, with
 * its sentence and its coming result, because the launch that follows the capture reads the target
 * and must read the page the line was captured from.
 */
function openIdea(target) {
  if (!popover) popover = buildPopover();
  if (!popover.isBusy()) {
    popover.setTarget(target);
    popover.routeKey = routeKey(currentRoute());
  }
  popover.opener = target.opener ?? null;
  popover.opener?.setAttribute?.("aria-expanded", "true");
  popover.el.hidden = false;
  placeIdea(popover.el, currentOpener());
  popover.input.focus();
}

function buildPopover() {
  const where = h("div", { class: "idea__head" });
  const input = h("input", {
    class: "form__input idea__input",
    type: "text",
    placeholder: "One line: what should change, and why",
    "aria-label": "The idea, in one line",
    autocomplete: "off",
    spellcheck: "false",
  });
  const err = h("div", { class: "form__error idea__error", role: "alert" });
  const result = h("div", { class: "idea__result" });
  const main = h("button", { class: "btn btn--primary idea__go", type: "button" });
  const caret = h(
    "button",
    {
      class: "btn btn--ghost launch__caret idea__caret",
      type: "button",
      "aria-haspopup": "true",
      "aria-expanded": "false",
      "aria-label": "Choose which tool shapes it",
      title: "Choose Claude Code or Codex",
    },
    "▾",
  );
  const menu = h("div", { class: "idea__menu", role: "menu", hidden: true });
  const close = h("button", { class: "btn btn--ghost btn--icon idea__close", type: "button", "aria-label": "Close" }, icon("close"));

  const target = { repo: null, origin: {}, ctx: null, launcher: null };
  let busy = false;

  const label = (tool) => `Capture and shape in ${TOOL_LABEL[tool]}`;
  const setBusy = (on) => {
    busy = on;
    input.disabled = on;
    main.disabled = on;
    caret.disabled = on;
    mount(main, on ? "Capturing…" : label(rememberedTool()));
  };
  const closeMenu = () => {
    menu.hidden = true;
    caret.setAttribute("aria-expanded", "false");
  };
  const clearResult = () => mount(result, []);
  const showCommand = (command, reason) => {
    result.querySelector(".launch-cmd")?.remove();
    result.appendChild(commandField(command, reason));
  };

  function setTarget(t) {
    target.repo = t.repo;
    target.origin = t.origin ?? {};
    // ?repo= is the tile's repo in workspace mode, not the route's, so it is named here explicitly.
    target.ctx = {
      post: (url, body) => post(withRepo(url, t.repo), body),
      fetchJson: (url) => api(withRepo(url, t.repo), { fresh: true }),
    };
    target.launcher = makeLauncher(target.ctx);
    mount(where, whereSentence(t.repo, t.origin, t.level), close);
    err.textContent = "";
    // The last submit's result (the link, the reason, the command) stays until the next submit
    // clears it: a reader who closed the popover or moved on must still be able to find the
    // command the toast said is here.
    mount(main, label(rememberedTool()));
    closeMenu();
  }

  /** The link to the new task, first in the result so the reader always has somewhere to go. */
  function taskLink(repo, slug) {
    return h("p", { class: "idea__task" }, "Captured as ", entityLink("task", formatRoute({ level: "task", repo, id: slug, query: {} }), slug), ".");
  }

  /**
   * The sequence: capture, then launch with the new slug and the page's path. The captured text
   * goes to the capture route and nowhere else; the launch body holds the slug, the tool, the mode
   * and the path. Three outcomes, all inside the popover: a session that opened on this machine
   * closes it behind the launcher's toast; a session that opened on the machine running `reggie
   * serve` (the page holds a serve key) keeps it open with the link, a sentence saying so and the
   * command; anything else keeps it open with the link, the reason and the command to run by hand.
   */
  async function submit(tool) {
    if (busy) return;
    err.textContent = "";
    const text = input.value.trim();
    if (!text) {
      err.textContent = "Write one line first.";
      input.focus();
      return;
    }
    // The page this submit belongs to, taken once: everything after an await reads these and never
    // the shared target, so the launch cannot be built for a page the reader moved to meanwhile.
    const { repo, origin, ctx, launcher } = target;
    closeMenu();
    if (tool !== rememberedTool()) rememberTool(tool);
    setBusy(true);
    clearResult();
    let captured;
    try {
      captured = await ctx.post("/api/capture", { text, ...origin });
    } catch (e) {
      err.textContent = friendlyError(e);
      setBusy(false);
      input.focus();
      return;
    }
    const slug = captured?.slug ?? "";
    toast(`Captured as \`${slug}\``, { tone: "ok" });
    input.value = "";
    invalidate("/api/");
    // The level redraws so the new item shows where it belongs (the board, the task counts) while
    // the launch runs; the popover lives outside the columns, so the redraw does not touch it.
    render(currentRoute());
    mount(result, taskLink(repo, slug));
    mount(main, "Starting…");

    const paths = packPathsOf(origin);
    let commandShown = false;
    let settled = false;
    const onCommand = (command, why) => {
      commandShown = true;
      showCommand(command, why);
    };
    // The description is asked for before the launch is, because the launch holds the server (one
    // request at a time, and an unanswered Terminal prompt holds it for the whole eight seconds):
    // asked at six seconds it would queue behind the very request it is meant to explain. The
    // board gets the same answer from its tooltip prefetch; here nothing has been hovered. And
    // when it still arrives after the launch has answered, it is dropped: the server's reason is
    // the answer, and a "still waiting" sentence over it would be a lie on a re-enabled form.
    const described = launcher.describe([slug], tool, "discuss", paths).catch(() => null);
    const slow = setTimeout(() => {
      described.then((plan) => {
        if (settled || !plan?.command) return;
        onCommand(plan.command, `Still waiting for ${TOOL_LABEL[tool]} to open. If no window appeared, macOS may be holding it behind a permission prompt — run it yourself instead:`);
      });
    }, SLOW_MS);
    let res = null;
    try {
      res = await launcher.run([slug], tool, "discuss", { paths, onCommand, where: "below" });
    } finally {
      settled = true;
      clearTimeout(slow);
      setBusy(false);
    }
    if (res?.launched && !serveKey()) {
      closeIdea();
      return;
    }
    if (res?.launched) {
      // The window opened where `reggie serve` runs, which is not where this page is.
      result.appendChild(h("p", { class: "hint idea__remote" }, `The ${TOOL_LABEL[tool]} session opened on the machine running `, h("code", {}, "reggie serve"), ", not here."));
      showCommand(res.command, "To open it where you are instead, run this in the repo:");
      return;
    }
    if (!commandShown) {
      // Even the description could not be read: the verb is still knowable from the slug and the path.
      const extra = paths.map((p) => ` --path ${p}`).join("");
      showCommand(`reggie launch ${slug} --run${extra}`, paths.length > 0 ? "The server could not describe the session. Run this in the repo; --path adds the page's entity to the pack:" : "The server could not describe the session. Run this in the repo:");
    }
    input.focus();
  }

  for (const tool of LAUNCH_TOOLS) {
    const row = h("button", { class: "btn btn--small btn--ghost idea__tool", type: "button", role: "menuitem" }, label(tool));
    row.addEventListener("click", () => submit(tool));
    menu.appendChild(row);
  }
  main.addEventListener("click", () => submit(rememberedTool()));
  caret.addEventListener("click", () => {
    if (!menu.hidden) {
      closeMenu();
      return;
    }
    menu.hidden = false;
    caret.setAttribute("aria-expanded", "true");
    menu.querySelector("button")?.focus();
  });
  close.addEventListener("click", () => closeIdea());
  const form = h(
    "form",
    {
      class: "form form--idea",
      on: {
        submit: (ev) => {
          ev.preventDefault();
          submit(rememberedTool());
        },
      },
    },
    input,
    err,
    h("div", { class: "form__actions idea__actions" }, h("span", { class: "launch idea__launch" }, main, caret, menu), h("span", { class: "hint idea__hint" }, "⌘↵ sends")),
  );
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) {
      ev.preventDefault();
      submit(rememberedTool());
    }
  });
  const el = h("div", { class: "idea", role: "dialog", "aria-label": "Capture an idea from this page", hidden: true }, where, form, result);
  // Escape inside the popover closes the tool menu first, then the popover, before app.js's own
  // document listener can unwind anything behind it; from outside, the unwind chain reaches it.
  el.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape") return;
    ev.stopPropagation();
    ev.preventDefault();
    if (!menu.hidden) {
      closeMenu();
      caret.focus();
      return;
    }
    closeIdea();
  });
  el.addEventListener("focusout", (ev) => {
    if (!menu.hidden && !menu.contains(ev.relatedTarget) && ev.relatedTarget !== caret) closeMenu();
  });
  document.body.appendChild(el);
  on("escape", () => closeIdea());
  window.addEventListener("resize", () => {
    if (!el.hidden) placeIdea(el, currentOpener());
  });
  return { el, input, setTarget, isBusy: () => busy, opener: null, routeKey: "" };
}

/**
 * The header trigger: shown on every level that belongs to one repo, hidden on the workspace, and
 * pointed at the page's entity on every route change. Clicking it opens the popover under itself.
 */
export function mountIdeaTrigger() {
  const btn = $("idea-trigger");
  if (!btn) return;
  const sync = (route) => {
    const origin = originFor(route);
    const repo = route?.repo ?? state.facts?.facts?.name ?? null;
    btn.hidden = origin === null || !repo;
    // Leaving the page the popover was opened on closes it: its sentence names that page. The
    // redraw after a capture emits the same route and leaves it open with its result, and a
    // submit in flight keeps it open wherever the reader goes, so its result has somewhere to land.
    if (popover && !popover.el.hidden && !popover.isBusy() && popover.routeKey !== routeKey(route)) closeIdea();
  };
  btn.addEventListener("click", () => {
    if (popover && !popover.el.hidden && popover.opener === btn) {
      // A second click closes it, except while a submit is in flight: the answer is on its way here.
      if (!popover.isBusy()) closeIdea();
      return;
    }
    const route = currentRoute();
    const origin = originFor(route) ?? {};
    const repo = route.repo ?? state.facts?.facts?.name ?? null;
    if (!repo) return;
    openIdea({ repo, origin, level: route.level, opener: btn });
  });
  on("route", sync);
  if (state.route) sync(state.route);
}

/** What makes one page: the level, the repo and the entity; a query change is the same page. */
function routeKey(route) {
  return `${route?.level ?? ""}|${route?.repo ?? ""}|${route?.id ?? ""}`;
}

/** The workspace tile's own button: the same popover, for that repo alone, with no path. */
export function ideaButtonFor(repo) {
  const btn = h(
    "button",
    {
      class: "btn btn--ghost btn--icon ws-tile__idea",
      type: "button",
      "aria-haspopup": "dialog",
      "aria-expanded": "false",
      "aria-label": `Capture an idea for ${repo}`,
      title: `Capture an idea for ${repo}`,
      dataset: { ideaRepo: repo },
    },
    icon("idea"),
  );
  btn.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (popover && !popover.el.hidden && popover.opener?.dataset?.ideaRepo === repo) {
      if (!popover.isBusy()) closeIdea();
      return;
    }
    openIdea({ repo, origin: {}, level: "repo", opener: btn });
  });
  return btn;
}
