// Listen: the story column, spoken. Two ways to hear it. The browser's own voice reads the
// narration script at once, with nothing made on disk; an episode is the same script rendered
// to an audio file by the server, playable here and listed in the private feed a podcast app
// can subscribe to. Both come from GET /api/narration, so what you hear is what the page says.
import { h, mount, toast, api, post, withRepo, withKey, icon } from "./app.js";

/** The one utterance in flight, so a second Listen stops the first instead of talking over it. */
let speaking = null;

function stopSpeaking() {
  if (typeof speechSynthesis === "undefined") return;
  speechSynthesis.cancel();
  speaking?.onDone?.();
  speaking = null;
}

/** Split the script into utterances at paragraph breaks: long single utterances stall in some browsers. */
function utterances(script) {
  return String(script ?? "")
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function speak(script, onDone) {
  stopSpeaking();
  if (typeof speechSynthesis === "undefined" || typeof SpeechSynthesisUtterance === "undefined") {
    toast("This browser has no voice to read with. Make an episode instead.", { tone: "warn" });
    onDone?.();
    return;
  }
  const parts = utterances(script);
  const state = { onDone, index: 0 };
  speaking = state;
  const next = () => {
    if (speaking !== state) return;
    if (state.index >= parts.length) {
      speaking = null;
      onDone?.();
      return;
    }
    const u = new SpeechSynthesisUtterance(parts[state.index]);
    state.index += 1;
    u.rate = 1;
    u.onend = next;
    u.onerror = () => {
      if (speaking === state) {
        speaking = null;
        onDone?.();
      }
    };
    speechSynthesis.speak(u);
  };
  next();
}

function minutes(seconds) {
  const m = Math.floor((seconds ?? 0) / 60);
  const s = String((seconds ?? 0) % 60).padStart(2, "0");
  return `${m}:${s}`;
}

/**
 * listenControls({ repo, scope, id }) → a block with Read aloud, Make an episode, and the script.
 * `scope`/`id` name a story the way `/api/story` does. Everything is fetched on first use.
 */
export function listenControls(opts) {
  const { scope, id, repo } = opts;
  const url = (path) => withRepo(path, repo);
  let narration = null;
  const load = async () => {
    if (narration) return narration;
    narration = await api(url(`/api/narration?scope=${encodeURIComponent(scope)}&id=${encodeURIComponent(id)}`), { fresh: true });
    return narration;
  };

  const readBtn = h("button", { class: "btn btn--small", type: "button", title: "Read this page aloud with the browser's own voice; nothing is written to disk" }, icon("play"), "Read it to me");
  const makeBtn = h("button", { class: "btn btn--small btn--ghost", type: "button", title: "Render this story to an audio file on the server (macOS voice) and add it to the private feed" }, icon("mic"), "Make an episode");
  const scriptBtn = h("button", { class: "btn btn--small btn--ghost", type: "button", title: "Show the exact words a voice would read" }, "Show the script");
  const status = h("span", { class: "hint listen__status", "aria-live": "polite" });
  const player = h("div", { class: "listen__player", hidden: true });
  const scriptEl = h("pre", { class: "listen__script", hidden: true });
  const wrap = h("div", { class: "listen", role: "group", "aria-label": "Listen to this page" }, h("div", { class: "listen__row" }, readBtn, makeBtn, scriptBtn, status), player, scriptEl);

  let reading = false;
  const setReading = (on) => {
    reading = on;
    mount(readBtn, icon(on ? "stop" : "play"), on ? "Stop reading" : "Read it to me");
  };
  readBtn.addEventListener("click", async () => {
    if (reading) {
      stopSpeaking();
      setReading(false);
      return;
    }
    readBtn.disabled = true;
    try {
      const n = await load();
      status.textContent = `${n.words} words, about ${minutes(n.seconds)}.`;
      setReading(true);
      speak(n.script, () => setReading(false));
    } catch (e) {
      toast(`Could not load the narration: ${e.message}`, { tone: "bad" });
    } finally {
      readBtn.disabled = false;
    }
  });

  const showEpisode = (ep) => {
    if (!ep?.route) return;
    // The audio element and a podcast app cannot send the key as a header, so it rides in the URL.
    const src = withKey(url(ep.route) + (url(ep.route).includes("?") ? "&" : "?") + `t=${encodeURIComponent(ep.madeAt ?? "")}`);
    const audio = h("audio", { controls: true, preload: "none", src });
    const feed = withKey(url("/api/feed.xml"));
    mount(
      player,
      audio,
      h("p", { class: "hint" }, `Made ${ep.madeAt ? new Date(ep.madeAt).toLocaleString() : "just now"} with the ${ep.voice ?? "default"} voice, ${minutes(ep.seconds)}. Subscribe a podcast app to `, h("a", { class: "link", href: feed, target: "_blank", rel: "noopener" }, "the private feed"), " to hear every episode Reggie has made for this repo."),
    );
    player.hidden = false;
  };

  makeBtn.addEventListener("click", async () => {
    makeBtn.disabled = true;
    mount(makeBtn, icon("mic"), "Making the episode…");
    status.textContent = "Rendering the voice; a two-minute story takes a few seconds.";
    try {
      const ep = await post(url("/api/episode"), { scope, id });
      narration = null;
      status.textContent = `Episode made: ${ep.words} words, ${minutes(ep.seconds)}.`;
      showEpisode(ep);
      toast(`Episode made for ${ep.title ?? id}.`, { tone: "ok" });
    } catch (e) {
      status.textContent = "";
      toast(`Could not make the episode: ${e.message}`, { tone: "bad", ms: 9000 });
    } finally {
      makeBtn.disabled = false;
      mount(makeBtn, icon("mic"), "Make an episode again");
    }
  });

  scriptBtn.addEventListener("click", async () => {
    if (!scriptEl.hidden) {
      scriptEl.hidden = true;
      scriptBtn.textContent = "Show the script";
      return;
    }
    scriptBtn.disabled = true;
    try {
      const n = await load();
      scriptEl.textContent = n.script;
      scriptEl.hidden = false;
      scriptBtn.textContent = "Hide the script";
    } catch (e) {
      toast(`Could not load the narration: ${e.message}`, { tone: "bad" });
    } finally {
      scriptBtn.disabled = false;
    }
  });

  // An episode already on disk is shown without being asked for.
  load()
    .then((n) => {
      if (n?.episode) {
        showEpisode(n.episode);
        mount(makeBtn, icon("mic"), "Make an episode again");
      }
      status.textContent = `${n.words} words, about ${minutes(n.seconds)} spoken.`;
    })
    .catch(() => {});

  return wrap;
}

/** Stop any reading when the page moves on; called by whoever tears the page down. */
export function stopListening() {
  stopSpeaking();
}
