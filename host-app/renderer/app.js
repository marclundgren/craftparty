/* global craftparty */
const $ = (id) => document.getElementById(id);

const setup = $("setup");
const progress = $("progress");
const running = $("running");
const joinSetup = $("join-setup");
const joinProgress = $("join-progress");
const HOST_SECTIONS = [setup, progress, running];
const JOIN_SECTIONS = [joinSetup, joinProgress];
const netStatus = $("net-status");
const worldsBox = $("worlds-box");
const worldsList = $("worlds-list");
const newWorldBox = $("new-world-box");
const worldName = $("world-name");
const worldNameHint = $("world-name-hint");
const difficultySelect = $("difficulty");
const seedInput = $("seed");
const remote = $("remote");
const remoteHint = $("remote-hint");
const eula = $("eula");
const startBtn = $("start");
const setupError = $("setup-error");
const worldSearch = $("world-search");
const worldsCount = $("worlds-count");
const worldsEmpty = $("worlds-empty");
const newWorldVersion = $("new-world-version");

/**
 * Rows per page. A card has exactly one scrolling region, its body, so
 * the lists inside it must stay short enough not to bury what follows
 * them; paging is how that happens without nesting a second scrollbar.
 * Party rows carry a status line and an address, so fewer of them fit.
 *
 * Search and paging arrive together, at the first list that needs a
 * second page: below that everything is already on screen, and both
 * controls would be clutter asking to be understood.
 */
const PAGE_SIZE = { worlds: 5, parties: 4 };

/** Which page each list is showing, zero-based. */
const page = { worlds: 0, parties: 0 };

/** Case-insensitive name match; blank query means everything. */
function matching(items, query) {
  const q = query.trim().toLowerCase();
  return q ? items.filter((i) => i.name.toLowerCase().includes(q)) : items;
}

function show(section) {
  for (const s of [...HOST_SECTIONS, ...JOIN_SECTIONS]) {
    s.hidden = s !== section;
  }
  const joining = JOIN_SECTIONS.includes(section);
  $("tab-join").classList.toggle("active", joining);
  $("tab-host").classList.toggle("active", !joining);
}

// ---- tabs (disabled while something is running) ----
let hostSection = setup;
let joinSection = joinSetup;
$("tab-host").addEventListener("click", () => show(hostSection));
$("tab-join").addEventListener("click", () => show(joinSection));
const rememberSection = (section) => {
  if (HOST_SECTIONS.includes(section)) hostSection = section;
  else joinSection = section;
  show(section);
};

// ---- Minecraft version ----
/*
 * Which Minecraft a world speaks, said everywhere someone is about to
 * launch a client: making a world, running one, looking at a friend's.
 *
 * A new world is made on the newest version Craftparty can actually host
 * (the newest Fabric has published a server for, which trails a
 * Minecraft release by a few days) and keeps it for good. So a saved
 * world shows its own version, never today's.
 */

/** The newest hostable version, once the main process has looked it up. */
let latestVersion = null;

/** What to say when there is no number to show: before, and if the check fails. */
let versionUnknownNote = "Checking which version your world can run…";

/**
 * How a version reads inside a list row. The space is non-breaking on
 * purpose: those lines wrap, and "Minecraft" left on one line with its
 * number orphaned onto the next is unreadable at a glance.
 */
function versionLabel(version) {
  return `Minecraft\u00A0${version}`;
}

/** Fill one .version-line: the tag holds the number, the note its meaning. */
function paintVersion(line, version, note) {
  const tag = line.querySelector(".version-tag");
  tag.hidden = !version;
  tag.textContent = version ?? "";
  line.querySelector(".version-note").textContent = note;
}

/**
 * The version the start button would really run. Typing the name of a
 * world that already exists continues that world, on the version it was
 * made with rather than the newest one, and the line has to say so rather
 * than promising a number the start won't use.
 */
function renderNewWorldVersion(existing) {
  if (existing) {
    paintVersion(
      newWorldVersion,
      existing.minecraftVersion,
      existing.minecraftVersion
        ? `“${existing.name}” runs this version, and continuing it keeps it there.`
        : `“${existing.name}” hasn't run yet; its version is settled the first time it does.`,
    );
  } else if (latestVersion) {
    paintVersion(
      newWorldVersion,
      latestVersion,
      "The newest Minecraft Craftparty can host. Your world stays on it for good, and everyone needs this version to join.",
    );
  } else {
    paintVersion(newWorldVersion, null, versionUnknownNote);
  }
}

(async () => {
  const result = await craftparty.minecraftVersion();
  if (result.version) {
    latestVersion = result.version;
  } else {
    // Not fatal: starting resolves the version for real. Say what's
    // true instead of showing a number nobody checked.
    versionUnknownNote =
      "Couldn't check the latest Minecraft version. Starting a world uses the newest one available.";
  }
  renderNewWorldVersion(worldWithName(worldName.value));
})();

// ---- worlds ----
// Worlds outlive parties: stopping a party (or quitting) leaves the world
// on disk. The host picks a saved world to continue, starts a new one, or
// deletes one for good. Nothing here happens implicitly.
let worlds = [];
/** Selected saved world, or null for "start a new world". */
let chosenWorldId = null;

async function refreshWorlds(preferId) {
  const result = await craftparty.listWorlds();
  worlds = result.worlds ?? [];
  if (preferId && worlds.some((w) => w.id === preferId)) chosenWorldId = preferId;
  if (chosenWorldId && !worlds.some((w) => w.id === chosenWorldId)) {
    chosenWorldId = null; // the one we had selected is gone
  }
  renderWorlds();
}

function renderWorlds() {
  worldsBox.hidden = worlds.length === 0;
  worldSearch.hidden = worlds.length <= PAGE_SIZE.worlds;
  // A box nobody can see must not go on filtering the list.
  if (worldSearch.hidden) worldSearch.value = "";

  const query = worldSearch.value;
  const shown = matching(worlds, query);
  worldsList.replaceChildren(...pageOf("worlds", shown).map(worldRow));
  // Always there, never paged away: starting fresh is an action, not one
  // of the saved worlds.
  $("new-world-row").replaceChildren(newWorldRow());

  worldsCount.textContent = countLabel(shown.length, worlds.length, query, "worlds");
  showEmpty(worldsEmpty, shown.length, query, "worlds");
  refreshChoice();
}

/**
 * The slice of `items` to draw, and the pager to go with it. Clamps the
 * page first: a search that narrows the list can leave us past the end.
 */
function pageOf(list, items) {
  const size = PAGE_SIZE[list];
  const pages = Math.max(1, Math.ceil(items.length / size));
  page[list] = Math.min(Math.max(page[list], 0), pages - 1);

  const pager = $(`${list}-pager`);
  pager.hidden = pages <= 1;
  if (!pager.hidden) {
    $(`${list}-page`).textContent = `Page ${page[list] + 1} of ${pages}`;
    $(`${list}-prev`).disabled = page[list] === 0;
    $(`${list}-next`).disabled = page[list] >= pages - 1;
  }
  return items.slice(page[list] * size, page[list] * size + size);
}

/** Wire a list's search box and pager to its renderer. */
function wireList(list, render) {
  $(`${list === "worlds" ? "world" : "party"}-search`).addEventListener(
    "input",
    () => {
      page[list] = 0; // a new query always starts at the first result
      render();
    },
  );
  $(`${list}-prev`).addEventListener("click", () => {
    page[list]--;
    render();
  });
  $(`${list}-next`).addEventListener("click", () => {
    page[list]++;
    render();
  });
}

/** "3 of 12" while searching, a plain total once the list needs paging. */
function countLabel(shown, total, query, noun) {
  if (query.trim()) return `${shown} of ${total}`;
  return total > PAGE_SIZE[noun] ? `${total} ${noun}` : "";
}

function showEmpty(el, shown, query, noun) {
  const empty = shown === 0 && query.trim();
  el.hidden = !empty;
  if (empty) el.textContent = `No ${noun} match “${query.trim()}”.`;
}

wireList("worlds", renderWorlds);

function worldRow(world) {
  const row = document.createElement("div");
  row.className = "world-row";
  row.dataset.worldId = world.id;

  const pick = document.createElement("label");
  pick.className = "world-pick";
  const radio = document.createElement("input");
  radio.type = "radio";
  radio.name = "world-choice";
  radio.value = world.id;
  radio.addEventListener("change", () => chooseWorld(world.id));
  const text = document.createElement("span");
  text.className = "world-text";
  const name = document.createElement("span");
  name.className = "world-name";
  name.textContent = world.name;
  // Truncated names are still readable on hover.
  name.title = world.name;
  const meta = document.createElement("span");
  meta.className = "world-meta";
  meta.textContent = [
    lastPlayed(world),
    formatSize(world.sizeBytes),
    // Missing only until this world has run once; see worlds.ts.
    world.minecraftVersion && versionLabel(world.minecraftVersion),
  ]
    .filter(Boolean)
    .join(" · ");
  text.append(name, meta);
  pick.append(radio, text);

  const actions = document.createElement("span");
  actions.className = "world-actions";
  const folder = document.createElement("button");
  folder.className = "world-btn";
  folder.type = "button";
  folder.title = "Open this world's folder";
  folder.textContent = "Folder";
  folder.addEventListener("click", () => craftparty.revealWorld(world.id));
  const del = document.createElement("button");
  del.className = "world-btn world-btn-danger";
  del.type = "button";
  del.textContent = "Delete";
  del.addEventListener("click", async () => {
    del.disabled = true;
    // The confirmation is a native dialog raised by the main process.
    const result = await craftparty.deleteWorld(world.id);
    del.disabled = false;
    if (result.error) {
      setupError.textContent = result.error;
      setupError.hidden = false;
      return;
    }
    if (result.deleted) await refreshWorlds();
  });
  actions.append(folder, del);

  row.append(pick, actions);
  return row;
}

function newWorldRow() {
  const row = document.createElement("div");
  row.className = "world-row";
  row.dataset.worldId = "";
  const pick = document.createElement("label");
  pick.className = "world-pick";
  const radio = document.createElement("input");
  radio.type = "radio";
  radio.name = "world-choice";
  radio.value = "";
  radio.addEventListener("change", () => chooseWorld(null));
  const name = document.createElement("span");
  name.className = "world-name";
  name.textContent = "Start a new world";
  pick.append(radio, name);
  row.append(pick);
  return row;
}

function chooseWorld(id) {
  chosenWorldId = id;
  refreshChoice();
  if (id === null) worldName.focus();
  else applyAddonSelection(worlds.find((w) => w.id === id)?.addonIds ?? []);
}

/**
 * Keep the form in sync with the choice: which controls show, what the
 * start button promises, and whether it's allowed to fire.
 */
function refreshChoice() {
  const chosen = worlds.find((w) => w.id === chosenWorldId) ?? null;
  newWorldBox.hidden = chosen !== null;

  // Names collapse to the same world directory ("Dragon Cave!" and
  // "dragon cave" are one world), so say plainly when a new name would
  // land on a world that already exists rather than silently reusing it.
  const collision = chosen ? null : worldWithName(worldName.value);
  worldNameHint.hidden = !collision;
  if (collision) {
    worldNameHint.textContent = `You already have a world called "${collision.name}". Starting will continue that world.`;
  }

  // Highlight whatever the start button is actually about to do, so a
  // typed-in collision points at the world it will continue.
  const target = chosen ?? collision;
  // Both the paged rows and the "Start a new world" row that sits outside
  // the pager.
  for (const row of worldsBox.querySelectorAll(".world-row")) {
    const selected = row.dataset.worldId === (target?.id ?? "");
    row.classList.toggle("selected", selected);
    row.querySelector("input[type=radio]").checked = selected;
  }

  startBtn.textContent = target ? `Continue "${target.name}"` : "Start my world";
  startBtn.title = target ? `Continue "${target.name}"` : "";
  startBtn.disabled = !(eula.checked && (target || worldName.value.trim()));
  renderNewWorldVersion(target);
}

function worldWithName(name) {
  const id = worldIdFor(name);
  return id ? (worlds.find((w) => w.id === id) ?? null) : null;
}

/** Mirrors worldId() in host-engine/src/worlds.ts. */
function worldIdFor(name) {
  return name
    .trim()
    .replace(/[^a-zA-Z0-9 _-]/g, "")
    .replace(/\s+/g, "-")
    .toLowerCase();
}

function lastPlayed(world) {
  if (!world.lastPlayedAt) return "Never played";
  const days = Math.floor((Date.now() - Date.parse(world.lastPlayedAt)) / 86_400_000);
  if (days <= 0) return "Played today";
  if (days === 1) return "Played yesterday";
  if (days < 30) return `Played ${days} days ago`;
  return `Played ${new Date(world.lastPlayedAt).toLocaleDateString()}`;
}

function formatSize(bytes) {
  if (!bytes) return "empty";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

// Typing a name means "new world", even if a saved one is selected.
worldName.addEventListener("input", () => {
  chosenWorldId = null;
  refreshChoice();
});
eula.addEventListener("change", refreshChoice);

refreshWorlds();

// ---- updates ----
// Every transition is decided in the main process; this only renders the
// state it is handed and offers the one action that makes sense next.
const updateText = $("update-text");
const updateAction = $("update-action");
const updateNote = $("update-note");
const updateAutoLabel = $("update-auto-label");
const autoUpdateBox = $("auto-update");

function renderUpdate(state) {
  if (!state) return;
  const version = state.currentVersion;
  const next = state.latestVersion;
  autoUpdateBox.checked = state.autoUpdate;
  // Offering a switch the platform can't honour is worse than no switch.
  updateAutoLabel.hidden = state.status === "unsupported" || !state.selfInstall;

  let text = `Craftparty ${version}`;
  let action = null;
  switch (state.status) {
    case "unsupported":
      // A build that can't replace itself can still say where to get the
      // new one; a development run has nothing useful to offer.
      if (!state.selfInstall) action = ["Get updates ↗", openReleases];
      break;
    case "checking":
      text = `Craftparty ${version} · checking for updates…`;
      break;
    case "current":
      text = `Craftparty ${version} · up to date`;
      action = ["Check again", checkForUpdates];
      break;
    case "available":
      text = `Craftparty ${next} is available`;
      // Where Craftparty can't install an update itself, the honest
      // action is handing the host the download page.
      action = state.selfInstall
        ? ["Download it", downloadUpdate]
        : ["Get it ↗", openReleases];
      break;
    case "downloading":
      text = `Downloading Craftparty ${next}… ${state.percent}%`;
      break;
    case "ready":
      text = `Craftparty ${next} installs next time you open the app`;
      action = ["Install now", installUpdate];
      break;
    case "error":
      text = `Craftparty ${version} · couldn't check for updates`;
      action = ["Try again", checkForUpdates];
      break;
  }

  updateText.textContent = text;
  updateAction.hidden = action === null;
  if (action) {
    updateAction.textContent = action[0];
    updateAction.disabled = false;
    updateAction.onclick = action[1];
  }
  // The note explains the unusual cases: a platform that can't
  // self-install, or why a check failed. Nothing to say most of the time.
  const note =
    state.status === "error" ||
    (!state.selfInstall && (state.status === "available" || state.status === "unsupported"))
      ? state.note
      : null;
  // Updater errors can be paragraphs of protocol detail; one line of it
  // is enough to act on without shoving the rest of the app down.
  updateNote.textContent = note ? trim(note, 150) : "";
  updateNote.hidden = !note;
}

function trim(text, max) {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

async function checkForUpdates() {
  updateAction.disabled = true;
  renderUpdate(await craftparty.checkForUpdates());
}

async function downloadUpdate() {
  updateAction.disabled = true;
  renderUpdate(await craftparty.downloadUpdate());
}

async function openReleases() {
  await craftparty.openReleases();
}

// Installing restarts the app; the main process refuses while a world or
// a connection is live, and says so here rather than silently doing it.
async function installUpdate() {
  updateAction.disabled = true;
  const result = await craftparty.installUpdate();
  updateAction.disabled = false;
  if (result?.error) {
    updateNote.textContent = trim(result.error, 150);
    updateNote.hidden = false;
  }
}

autoUpdateBox.addEventListener("change", async () => {
  autoUpdateBox.disabled = true;
  renderUpdate(await craftparty.setAutoUpdate(autoUpdateBox.checked));
  autoUpdateBox.disabled = false;
});

craftparty.onUpdateState(renderUpdate);
craftparty.updateState().then(renderUpdate);

craftparty.onPhase((phase) => {
  const friendly = friendlyPhase(phase);
  $("phase").textContent = friendly;
  $("join-phase").textContent = friendly;
});

function friendlyPhase(phase) {
  const map = {
    "fetching runtimes": "Downloading what's needed…",
    "starting control plane": "Building your private network…",
    "opening a door in the router": "Asking your router to let friends in…",
    "getting a certificate (first time can take a minute)":
      "Securing your connection (can take a minute)…",
    "joining private network": "Joining your private network…",
    "starting Minecraft": "Starting Minecraft…",
    "joining the party network": "Joining your friend's private network…",
    "connecting to the world": "Connecting to the world…",
    ready: "Almost there…",
  };
  return map[phase] ?? phase;
}

// ---- error reports ----
// A failed start returns a diagnostic report; tell the user what happened
// to it and let them copy the details for a bug report.
function showReport(prefix, result) {
  const row = $(`${prefix}-report`);
  if (!result.report) {
    row.hidden = true;
    return;
  }
  $(`${prefix}-report-note`).textContent = result.reportSent
    ? "The error details were sent to the developer automatically."
    : "The details couldn't be sent automatically. Please copy and share them.";
  const btn = $(`${prefix}-copy-report`);
  btn.onclick = async () => {
    await craftparty.copy(result.report);
    btn.textContent = "Copied!";
    setTimeout(() => (btn.textContent = "Copy error details"), 1500);
  };
  row.hidden = false;
}

// ---- network verdict ----
/*
 * The chip in the corner is one line of answer; the dialog behind it is
 * the reasoning, and for the "probably" that most people see, what
 * exactly is still untested.
 *
 * The check itself is preflight/src/probe.ts. It asks the router whether
 * it will open a door for Minecraft, and compares the address the router
 * believes it has with the address the internet really sees. What it
 * never does is have a machine out on the internet knock back on that
 * door, and that missing knock is the whole of the hedge: everything
 * checkable checks out, and the last step can't be checked from in here.
 */
const netDot = $("net-dot");
const netStatusText = $("net-status-text");
const netDialog = $("net-dialog");

/** The preflight report, once it lands. Null while the check is running. */
let netReport = null;

const IP_KIND_NOTE = {
  public: "a real address on the internet",
  cgnat: "shared with other customers of your provider",
  private: "an address inside a network, not on the internet",
  "link-local": "an address a device made up for itself",
  loopback: "this computer talking to itself",
  invalid: "not an address we recognise",
};

/**
 * Everything the chip, the checkbox hint and the dialog say, decided in
 * one place so they can never disagree about what was found.
 */
function netCopy(report) {
  if (!report) {
    return {
      chip: "Checking your network…",
      dot: "checking",
      tone: "maybe",
      hint: "",
      verdict: "Craftparty is still looking.",
      body: [[null, "This takes a few seconds: it asks your router a question and looks up the address the internet sees you at."]],
    };
  }

  if (report.error) {
    return {
      chip: "Network check didn't finish",
      dot: "offline",
      tone: "bad",
      hint: "We couldn't check your network. Internet hosting may not work, but you can still try.",
      verdict: "Craftparty couldn't tell.",
      body: [
        [null, "The check has to reach the internet and talk to your router, and one of the two didn't answer."],
        ["What to do", "Start a party anyway. The check being unavailable doesn't mean hosting is. It only means Craftparty has nothing to promise you in advance."],
      ],
    };
  }

  if (report.verdict === "assisted") {
    return {
      chip: "Internet hosting: not available",
      dot: "offline",
      tone: "bad",
      hint:
        "Your internet provider doesn't allow direct hosting. Assisted mode (via the Craftparty relay) is coming soon. For now, parties are limited to your home network.",
      verdict: "Not from this network, but your world still works.",
      body: [
        [null, assistedCause(report)],
        [
          "You can still play together",
          "Anyone on the same Wi-Fi as you can join a party normally. A Craftparty relay that would carry friends further away is on the way.",
        ],
      ],
    };
  }

  if (report.verdict === "independent") {
    return {
      chip: "Internet hosting: ready",
      dot: "connected",
      tone: "good",
      hint: "Your network supports hosting, so friends anywhere can join.",
      verdict: "Yes, your network is set up for it.",
      body: [
        [
          null,
          "Your router opens a door for Minecraft when Craftparty asks, and it has a real address on the internet." +
            // Only claimed when it actually happened: the probe skips the
            // mapping test unless it is asked for one.
            (report.mappingTest?.loopbackReached === true
              ? " A test connection came back through that door."
              : ""),
        ],
        ["What to do", "Start a party and send the invite. That's the whole of it."],
      ],
    };
  }

  return {
    chip: "Internet hosting: probably works",
    dot: "online",
    tone: "maybe",
    hint:
      "Your network looks compatible, but we couldn't fully verify it. If friends can't join, uncheck this and party on your home network.",
    verdict: "Probably. Everything Craftparty can check looks right.",
    body: [
      [
        "What's confirmed",
        "Your router opens a door for Minecraft when Craftparty asks, and it has a real address on the internet rather than one shared with the whole street. Those are the two things that usually stop a party working.",
      ],
      ["Why only “probably”", maybeDoubt(report)],
      [
        "What to do",
        "Start your party and send the invite. This usually just works. If a friend can't get in, come back here, uncheck “Friends join over the internet”, and play on your home network instead.",
      ],
    ],
  };
}

/** Why a network can't host at all, in the terms the host can act on. */
function assistedCause(report) {
  if (report.publicIpKind === "cgnat") {
    return "Your internet provider gives your home an address it shares with many other customers, so there is no door it could open for you alone. Nothing here can accept a connection from outside.";
  }
  if (!report.upnp?.found) {
    return "No router on this network answered Craftparty's request to open a door for Minecraft. That usually means UPnP is switched off in the router's settings. Turning it on, or forwarding port 25565 to this computer by hand, would give friends a way in.";
  }
  if (report.upnp.externalIpKind && report.upnp.externalIpKind !== "public") {
    return "Your router will open a door, but it opens onto another network rather than the internet: there is a second router, or your provider's own equipment, sitting above it. A port opened on the router you can see doesn't reach anybody.";
  }
  return "Something on the path between this computer and the internet won't let a connection in from outside.";
}

/**
 * The honest content of the hedge. Usually it is the untested last step;
 * where the probe actually saw a second layer of network, say that
 * instead, because it is a specific thing to go and look at.
 */
function maybeDoubt(report) {
  const routerIp = report.upnp?.externalIp;
  if (routerIp && report.publicIp && routerIp !== report.publicIp) {
    return `Your router thinks its address is ${routerIp}, but the internet sees this computer as ${report.publicIp}. A gap like that usually means a second router, or your provider's own equipment, sits above yours, and a door opened here may only open onto that middle network.`;
  }
  return "The only real proof is someone out on the internet knocking on that door. Craftparty has no server out there to knock, and most routers won't let this computer knock on its own address from inside the house, so the last step goes untested.";
}

/** The chip, plus the two controls the verdict actually governs. */
function paintNetwork() {
  const copy = netCopy(netReport);
  netStatusText.textContent = copy.chip;
  netDot.className = `chip-dot ${copy.dot}`;
  remoteHint.textContent = copy.hint;
}

function renderNetDialog() {
  const copy = netCopy(netReport);
  const verdict = $("net-dialog-verdict");
  verdict.className = `modal-verdict tone-${copy.tone}`;
  verdict.textContent = copy.verdict;

  const body = $("net-dialog-body");
  body.replaceChildren(
    ...copy.body.map(([heading, text]) => {
      const p = document.createElement("p");
      if (heading) {
        const strong = document.createElement("strong");
        strong.textContent = `${heading}: `;
        p.append(strong);
      }
      p.append(text);
      return p;
    }),
  );

  // The findings themselves, folded away: of no use to most people and
  // the first thing anyone debugging a router will want.
  const facts = $("net-dialog-facts");
  facts.replaceChildren(...netFacts(netReport).flatMap(([term, code, note]) => {
    const dt = document.createElement("dt");
    dt.textContent = term;
    const dd = document.createElement("dd");
    if (code) {
      const el = document.createElement("code");
      el.textContent = code;
      dd.append(el, " ");
    }
    if (note) dd.append(note);
    return [dt, dd];
  }));
  const notes = [...(netReport?.reasons ?? []), ...(netReport?.warnings ?? [])];
  $("net-dialog-reasons").textContent = notes.join(" ");
  $("net-dialog-reasons").hidden = notes.length === 0;
}

/** What the probe actually found, as [label, address or null, plain note]. */
function netFacts(report) {
  if (!report || report.error) {
    return [["Result", null, report?.error ?? "still checking…"]];
  }
  const address = (label, ip, kind) =>
    ip
      ? [label, ip, kind ? `(${IP_KIND_NOTE[kind] ?? kind})` : ""]
      : [label, null, "couldn't tell"];

  const facts = [
    address("The address the internet sees", report.publicIp, report.publicIpKind),
    [
      "Router",
      null,
      report.upnp?.found ? (report.upnp.friendlyName ?? "found, unnamed") : "none answered",
    ],
  ];
  if (report.upnp?.found) {
    facts.push(
      address(
        "The address your router thinks it has",
        report.upnp.externalIp,
        report.upnp.externalIpKind,
      ),
    );
  }
  if (report.mappingTest?.ran) {
    facts.push([
      "Test door",
      null,
      report.mappingTest.mapped
        ? report.mappingTest.loopbackReached === true
          ? "opened, and a connection came back through it"
          : "opened, but the knock-back test was inconclusive"
        : `couldn't be opened: ${report.mappingTest.error ?? "unknown error"}`,
    ]);
  }
  return facts;
}

netStatus.addEventListener("click", () => {
  renderNetDialog();
  netDialog.showModal();
});
$("net-dialog-done").addEventListener("click", () => netDialog.close());
$("net-dialog-x").addEventListener("click", () => netDialog.close());
// Clicking the dimmed area around the dialog closes it: the click lands on
// the <dialog> itself only when it misses the padded box inside.
netDialog.addEventListener("click", (event) => {
  if (event.target === netDialog) netDialog.close();
});

paintNetwork();

(async () => {
  const report = await craftparty.preflight();
  netReport = report;
  if (!report.error && report.verdict === "assisted") {
    remote.checked = false;
    remote.disabled = true;
  }
  paintNetwork();
  // The dialog can already be open, since someone can ask the question
  // before the answer arrives, so keep whatever is on screen current.
  if (netDialog.open) renderNetDialog();
})();

// ---- addons ----
// Marketplace addons are optional; if the registry is unreachable the
// section simply stays hidden and worlds start vanilla.
(async () => {
  const result = await craftparty.getAddons();
  if (result.error || !result.addons?.length) return;
  const list = $("addons-list");
  for (const addon of result.addons) {
    const label = document.createElement("label");
    label.className = "check";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.dataset.addonId = addon.id;
    box.addEventListener("change", refreshAddonsSummary);
    label.append(
      box,
      ` ${addon.emoji} ${addon.name} `,
    );
    const tag = document.createElement("span");
    tag.className = "addon-tag";
    tag.textContent = `· ${addon.tagline}`;
    label.append(tag);
    list.append(label);
  }
  $("addons-box").hidden = false;
  // A saved world may already be selected; show the addons it last ran with.
  applyAddonSelection(worlds.find((w) => w.id === chosenWorldId)?.addonIds ?? []);
})();

/** Tick exactly the addons a world remembers, leaving the rest clear. */
function applyAddonSelection(ids) {
  for (const box of document.querySelectorAll("#addons-list input")) {
    box.checked = ids.includes(box.dataset.addonId);
  }
  refreshAddonsSummary();
}

function refreshAddonsSummary() {
  const chosen = selectedAddonIds().length;
  $("addons-summary").textContent =
    chosen > 0 ? `(${chosen} selected)` : "(optional)";
}

function selectedAddonIds() {
  return [...document.querySelectorAll("#addons-list input:checked")].map(
    (el) => el.dataset.addonId,
  );
}

$("marketplace-link").addEventListener("click", (e) => {
  e.preventDefault();
  craftparty.openMarketplace();
});

// Opens github.com in the real browser; nothing about paying happens in
// the app itself.
$("sponsor").addEventListener("click", () => craftparty.openSponsors());

// ---- start ----
startBtn.addEventListener("click", async () => {
  setupError.hidden = true;
  $("setup-report").hidden = true;
  // Continue a saved world (picked from the list, or matched by name), or
  // create a fresh one. Never both: the main process resumes only when
  // it is handed an id.
  const resume = chosenWorldId ?? worldWithName(worldName.value)?.id ?? null;
  rememberSection(progress);
  const result = await craftparty.startParty({
    worldId: resume ?? undefined,
    worldName: resume ? undefined : worldName.value.trim(),
    acceptEula: eula.checked,
    remote: remote.checked,
    addonIds: selectedAddonIds(),
    // Only read on a brand-new world. The values must be ones
    // host-engine/src/world-config.ts lists. It rejects anything else
    // rather than quietly starting a world nobody asked for. "hardcore"
    // is a UI-only option, not one of those values, so it's translated
    // here into the difficulty/hardcore pair the engine expects.
    worldConfig: difficultySelect.value === "hardcore"
      ? { difficulty: "hard", hardcore: true, seed: seedInput.value.trim() }
      : { difficulty: difficultySelect.value, hardcore: false, seed: seedInput.value.trim() },
  });
  if (result.error) {
    rememberSection(setup);
    setupError.textContent = result.error;
    setupError.hidden = false;
    showReport("setup", result);
    // A failed start may still have created the world directory; show it
    // so a retry continues that world instead of colliding with it.
    await refreshWorlds(resume ?? worldIdFor(worldName.value));
    return;
  }
  $("invite").value = result.inviteCode;
  $("host-address").value = `localhost:${result.port}`;
  $("running-title").textContent = `"${result.worldName}" is running`;
  $("running-title").title = result.worldName;
  $("running-detail").textContent = result.remote
    ? "Friends anywhere on the internet can join with your invite."
    : "Friends on your home network can join with your invite.";
  // The one thing everyone has to match before any of the rest works.
  $("running-version").hidden = !result.minecraftVersion;
  if (result.minecraftVersion) {
    paintVersion(
      $("running-version"),
      result.minecraftVersion,
      "Launch this Minecraft version to play. Friends too.",
    );
  }
  rememberSection(running);
});

// ---- copy ----
$("copy").addEventListener("click", async () => {
  await craftparty.copy($("invite").value);
  $("copy").textContent = "Copied!";
  setTimeout(() => ($("copy").textContent = "Copy"), 1500);
});

$("copy-host-address").addEventListener("click", async () => {
  await craftparty.copy($("host-address").value);
  $("copy-host-address").textContent = "Copied!";
  setTimeout(() => ($("copy-host-address").textContent = "Copy"), 1500);
});

// ---- stop ----
// Stopping keeps the world. Come back to the picker with it selected,
// so continuing where you left off is the obvious next click.
$("stop").addEventListener("click", async () => {
  $("stop").disabled = true;
  const result = await craftparty.stopParty();
  $("stop").disabled = false;
  worldName.value = "";
  await refreshWorlds(result.worldId);
  rememberSection(setup);
});

// ---- join flow ----
// The join tab is the list of every party this computer has joined,
// connected or not, plus the box for pasting a new invite. Connections
// are held by the main process, so this only ever draws what it is told
// and asks for a fresh status when it wants one.
const partiesBox = $("parties-box");
const partiesList = $("parties-list");
const partySearch = $("party-search");
const partiesCount = $("parties-count");
const partiesEmpty = $("parties-empty");
const inviteInput = $("invite-input");
const joinBtn = $("join");
const joinError = $("join-error");

let parties = [];
/** Latest probe per party id: a PartyStatus, or "checking". */
const statuses = new Map();

async function refreshParties({ probe = true } = {}) {
  const result = await craftparty.listParties();
  if (result.error) {
    joinError.textContent = result.error;
    joinError.hidden = false;
    return;
  }
  parties = result.parties ?? [];
  // Forget status we were holding for parties that are no longer listed.
  for (const id of [...statuses.keys()]) {
    if (!parties.some((p) => p.id === id)) statuses.delete(id);
  }
  renderParties();
  if (probe) await checkAllParties();
}

/**
 * Ask about every party at once: hosts that are off take the full probe
 * timeout to say so, and one of those must not delay the rest.
 */
function checkAllParties() {
  return Promise.all(parties.map((p) => checkParty(p.id)));
}

async function checkParty(id) {
  statuses.set(id, { state: "checking" });
  paintStatus(id);
  const result = await craftparty.checkParty(id);
  // The list can move on (left, forgotten, rejoined) while we ask.
  if (!parties.some((p) => p.id === id)) return;
  statuses.set(
    id,
    result.error ? { state: "offline", detail: result.error } : result,
  );
  paintStatus(id);
}

function renderParties() {
  partiesBox.hidden = parties.length === 0;
  partySearch.hidden = parties.length <= PAGE_SIZE.parties;
  if (partySearch.hidden) partySearch.value = "";

  const query = partySearch.value;
  const shown = matching(parties, query);
  partiesList.replaceChildren(...pageOf("parties", shown).map(partyRow));
  partiesCount.textContent = countLabel(
    shown.length,
    parties.length,
    query,
    "parties",
  );
  showEmpty(partiesEmpty, shown.length, query, "parties");
}

wireList("parties", renderParties);

function partyRow(party) {
  const status = statuses.get(party.id);
  const row = document.createElement("div");
  row.className = `party-row${party.connected ? " connected" : ""}`;
  row.dataset.partyId = party.id;

  const head = document.createElement("div");
  head.className = "party-head";

  const dot = document.createElement("span");
  dot.className = `party-dot ${statusClass(party, status)}`;

  const text = document.createElement("span");
  text.className = "party-text";
  const name = document.createElement("span");
  name.className = "world-name";
  name.textContent = party.name;
  name.title = party.name;
  const meta = document.createElement("span");
  meta.className = "world-meta party-meta";
  meta.textContent = statusLine(party, status);
  const sub = document.createElement("span");
  sub.className = "world-meta party-sub";
  sub.textContent = partySub(party, status);
  text.append(name, meta, sub);

  const actions = document.createElement("span");
  actions.className = "world-actions";
  if (party.connected) {
    actions.append(
      button("Leave", "world-btn world-btn-danger party-leave", (btn) =>
        leaveSaved(party, btn),
      ),
    );
  } else {
    actions.append(
      button("Join", "world-btn party-join", (btn) => joinSaved(party, btn)),
      // Forgetting is offered only when nobody is in the world; the main
      // process refuses it otherwise rather than yanking a player out.
      button("Forget", "world-btn world-btn-danger", (btn) =>
        forgetSaved(party, btn),
      ),
    );
  }

  head.append(dot, text, actions);
  row.append(head);

  // A connected party is one you can paste into Minecraft right now.
  if (party.connected && party.localPort) {
    const address = document.createElement("div");
    address.className = "invite-row party-connect";
    const input = document.createElement("input");
    input.type = "text";
    input.readOnly = true;
    input.className = "party-address";
    input.value = `localhost:${party.localPort}`;
    const copy = document.createElement("button");
    copy.className = "world-btn";
    copy.type = "button";
    copy.textContent = "Copy";
    copy.addEventListener("click", async () => {
      await craftparty.copy(input.value);
      copy.textContent = "Copied!";
      setTimeout(() => (copy.textContent = "Copy"), 1500);
    });
    address.append(input, copy);
    row.append(address);
  }

  return row;
}

/**
 * The line under the name: which Minecraft to launch, where the world
 * lives, when you were last in it.
 *
 * The version comes from the invite, so it is there whether or not the
 * host is up, so a friend can see what client they'll need before anyone
 * starts anything. A live ping overrides it: that is the version the
 * server is really speaking right now.
 */
function partySub(party, status) {
  const version = status?.version ?? party.minecraftVersion;
  return [
    version && versionLabel(version),
    `${party.host}:${party.port}`,
    lastJoined(party),
  ]
    .filter(Boolean)
    .join(" · ");
}

function button(label, className, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = className;
  btn.textContent = label;
  btn.addEventListener("click", () => onClick(btn));
  return btn;
}

/**
 * Repaint just the status of one row. Rebuilding the whole list on every
 * probe would steal focus and reset a "Copied!" button mid-flash.
 */
function paintStatus(id) {
  const party = parties.find((p) => p.id === id);
  const row = partiesList.querySelector(`[data-party-id="${CSS.escape(id)}"]`);
  if (!party || !row) return;
  const status = statuses.get(id);
  row.querySelector(".party-meta").textContent = statusLine(party, status);
  row.querySelector(".party-sub").textContent = partySub(party, status);
  row.querySelector(".party-dot").className = `party-dot ${statusClass(party, status)}`;
  row.title = status?.detail ?? "";
}

function statusClass(party, status) {
  if (!status || status.state === "checking") return "checking";
  if (status.state !== "online") return "offline";
  return party.connected ? "connected" : "online";
}

/**
 * What a friend can actually rely on. Connected, the numbers come from a
 * real ping to the host's Minecraft. Not connected, all Craftparty can
 * reach is the host's control plane, which runs only while the party
 * does, so it promises no more than "the host is up".
 *
 * The Minecraft version is deliberately not here: it is known from the
 * invite either way, and belongs on the line that stays put (partySub)
 * rather than appearing and vanishing with each probe.
 */
function statusLine(party, status) {
  if (!status || status.state === "checking") return "Checking…";
  if (party.connected) {
    if (status.state !== "online") {
      return "Connected, but the world isn't answering";
    }
    const bits = ["In the world"];
    if (status.players) {
      bits.push(`${status.players.online}/${status.players.max} playing`);
    }
    if (status.pingMs !== null) bits.push(`${status.pingMs} ms`);
    return bits.join(" · ");
  }
  if (status.state === "online") {
    const ping = status.pingMs === null ? "" : ` · ${status.pingMs} ms`;
    return `The host is up and ready to join${ping}`;
  }
  return "Offline. The host isn't running this world right now";
}

function lastJoined(party) {
  if (!party.lastJoinedAt) return "Never joined";
  const days = Math.floor(
    (Date.now() - Date.parse(party.lastJoinedAt)) / 86_400_000,
  );
  if (days <= 0) return "Joined today";
  if (days === 1) return "Joined yesterday";
  if (days < 30) return `Joined ${days} days ago`;
  return `Joined ${new Date(party.lastJoinedAt).toLocaleDateString()}`;
}

async function joinSaved(party, btn) {
  btn.disabled = true;
  await connect(() => craftparty.rejoinParty(party.id));
  btn.disabled = false;
}

async function leaveSaved(party, btn) {
  btn.disabled = true;
  btn.textContent = "Leaving…";
  await craftparty.leaveParty(party.id);
  await refreshParties();
}

async function forgetSaved(party, btn) {
  btn.disabled = true;
  const result = await craftparty.forgetParty(party.id);
  if (result.error) {
    btn.disabled = false;
    joinError.textContent = result.error;
    joinError.hidden = false;
    return;
  }
  await refreshParties({ probe: false });
}

/**
 * One connection attempt, from either the paste box or a saved row. Both
 * show the progress screen and end back at the list, which is where the
 * result, connected or saved-but-offline, shows up.
 */
async function connect(attempt) {
  joinError.hidden = true;
  $("join-report").hidden = true;
  rememberSection(joinProgress);
  const result = await attempt();
  rememberSection(joinSetup);
  if (result.error) {
    joinError.textContent = result.error;
    joinError.hidden = false;
    showReport("join", result);
  }
  await refreshParties();
  return result;
}

inviteInput.addEventListener("input", () => {
  joinBtn.disabled = !inviteInput.value.trim();
});

joinBtn.addEventListener("click", async () => {
  const code = inviteInput.value.trim();
  const result = await connect(() => craftparty.joinParty(code));
  // Keep a code that didn't work, so it can be fixed rather than re-found.
  if (!result.error) {
    inviteInput.value = "";
    joinBtn.disabled = true;
  }
});

$("parties-refresh").addEventListener("click", async (event) => {
  event.target.disabled = true;
  await refreshParties();
  event.target.disabled = false;
});

// Opening the tab is a fresh question, and an open tab re-asks on its
// own: a host stopping their world should show up without a click.
$("tab-join").addEventListener("click", () => void checkAllParties());
setInterval(() => {
  if (!joinSetup.hidden) void checkAllParties();
}, 20_000);

refreshParties();
