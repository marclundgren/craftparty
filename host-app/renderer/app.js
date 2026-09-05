/* global craftparty */
const $ = (id) => document.getElementById(id);

const setup = $("setup");
const progress = $("progress");
const running = $("running");
const joinSetup = $("join-setup");
const joinProgress = $("join-progress");
const joinRunning = $("join-running");
const HOST_SECTIONS = [setup, progress, running];
const JOIN_SECTIONS = [joinSetup, joinProgress, joinRunning];
const netStatus = $("net-status");
const worldsBox = $("worlds-box");
const worldsList = $("worlds-list");
const newWorldBox = $("new-world-box");
const worldName = $("world-name");
const worldNameHint = $("world-name-hint");
const difficultySelect = $("difficulty");
const hardcoreBox = $("hardcore");
const seedInput = $("seed");
const remote = $("remote");
const remoteHint = $("remote-hint");
const eula = $("eula");
const startBtn = $("start");
const setupError = $("setup-error");

let netVerdict = null;

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

// ---- worlds ----
// Worlds outlive parties: stopping a party (or quitting) leaves the world
// on disk. The host picks a saved world to continue, starts a new one, or
// deletes one for good — nothing here happens implicitly.
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
  worldsList.replaceChildren();
  for (const world of worlds) {
    worldsList.append(worldRow(world));
  }
  if (worlds.length > 0) worldsList.append(newWorldRow());
  refreshChoice();
}

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
  const name = document.createElement("span");
  name.className = "world-name";
  name.textContent = world.name;
  const meta = document.createElement("span");
  meta.className = "world-meta";
  meta.textContent = `${lastPlayed(world)} · ${formatSize(world.sizeBytes)}`;
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
    worldNameHint.textContent = `You already have a world called "${collision.name}" — starting will continue that world.`;
  }

  // Highlight whatever the start button is actually about to do, so a
  // typed-in collision points at the world it will continue.
  const target = chosen ?? collision;
  for (const row of worldsList.children) {
    const selected = row.dataset.worldId === (target?.id ?? "");
    row.classList.toggle("selected", selected);
    row.querySelector("input[type=radio]").checked = selected;
  }

  startBtn.textContent = target ? `Continue "${target.name}"` : "Start my world";
  startBtn.disabled = !(eula.checked && (target || worldName.value.trim()));
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
  // The note explains the unusual cases — a platform that can't
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
    : "The details couldn't be sent automatically — please copy and share them.";
  const btn = $(`${prefix}-copy-report`);
  btn.onclick = async () => {
    await craftparty.copy(result.report);
    btn.textContent = "Copied!";
    setTimeout(() => (btn.textContent = "Copy error details"), 1500);
  };
  row.hidden = false;
}

// ---- preflight on load ----
(async () => {
  const report = await craftparty.preflight();
  if (report.error) {
    netStatus.textContent = "network check failed";
    remoteHint.textContent =
      "We couldn't check your network. Internet hosting may not work — you can still try.";
    return;
  }
  netVerdict = report.verdict;
  if (report.verdict === "assisted") {
    netStatus.textContent = "internet hosting: blocked by your provider";
    remote.checked = false;
    remote.disabled = true;
    remoteHint.textContent =
      "Your internet provider doesn't allow direct hosting. Assisted mode (via the Craftparty relay) is coming soon — for now, parties are limited to your home network.";
  } else if (report.verdict === "independent") {
    netStatus.textContent = "internet hosting: ready ✓";
    remoteHint.textContent = "Your network supports hosting — friends anywhere can join.";
  } else {
    netStatus.textContent = "internet hosting: probably works";
    remoteHint.textContent =
      "Your network looks compatible, but we couldn't fully verify it. If friends can't join, uncheck this and party on your home network.";
  }
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
    tag.textContent = `— ${addon.tagline}`;
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

// ---- start ----
startBtn.addEventListener("click", async () => {
  setupError.hidden = true;
  $("setup-report").hidden = true;
  // Continue a saved world (picked from the list, or matched by name), or
  // create a fresh one. Never both — the main process resumes only when
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
    // host-engine/src/world-config.ts lists — it rejects anything else
    // rather than quietly starting a world nobody asked for.
    worldConfig: {
      difficulty: difficultySelect.value,
      hardcore: hardcoreBox.checked,
      seed: seedInput.value.trim(),
    },
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
  $("running-detail").textContent = result.remote
    ? "Friends anywhere on the internet can join with your invite."
    : "Friends on your home network can join with your invite.";
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
// Stopping keeps the world — come back to the picker with it selected,
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
const inviteInput = $("invite-input");
const joinBtn = $("join");
const joinError = $("join-error");

inviteInput.addEventListener("input", () => {
  joinBtn.disabled = !inviteInput.value.trim();
});

joinBtn.addEventListener("click", async () => {
  joinError.hidden = true;
  $("join-report").hidden = true;
  rememberSection(joinProgress);
  const result = await craftparty.joinParty(inviteInput.value.trim());
  if (result.error) {
    rememberSection(joinSetup);
    joinError.textContent = result.error;
    joinError.hidden = false;
    showReport("join", result);
    return;
  }
  $("join-address").value = `localhost:${result.localPort}`;
  $("join-detail").textContent = `You're connected to "${result.partyName}".`;
  rememberSection(joinRunning);
});

$("copy-address").addEventListener("click", async () => {
  await craftparty.copy($("join-address").value);
  $("copy-address").textContent = "Copied!";
  setTimeout(() => ($("copy-address").textContent = "Copy"), 1500);
});

$("leave").addEventListener("click", async () => {
  $("leave").disabled = true;
  await craftparty.leaveParty();
  $("leave").disabled = false;
  rememberSection(joinSetup);
});
