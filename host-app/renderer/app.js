/* global craftparty */
const $ = (id) => document.getElementById(id);

const setup = $("setup");
const progress = $("progress");
const running = $("running");
const netStatus = $("net-status");
const worldName = $("world-name");
const remote = $("remote");
const remoteHint = $("remote-hint");
const eula = $("eula");
const startBtn = $("start");
const setupError = $("setup-error");

let netVerdict = null;

function show(section) {
  for (const s of [setup, progress, running]) s.hidden = s !== section;
}

function refreshStartEnabled() {
  startBtn.disabled = !(worldName.value.trim() && eula.checked);
}

worldName.addEventListener("input", refreshStartEnabled);
eula.addEventListener("change", refreshStartEnabled);

craftparty.onPhase((phase) => {
  $("phase").textContent = friendlyPhase(phase);
});

function friendlyPhase(phase) {
  const map = {
    "fetching runtimes": "Downloading what your world needs…",
    "starting control plane": "Building your private network…",
    "opening a door in the router": "Asking your router to let friends in…",
    "getting a certificate (first time can take a minute)":
      "Securing your connection (can take a minute)…",
    "joining private network": "Joining your private network…",
    "starting Minecraft": "Starting Minecraft…",
    ready: "Almost there…",
  };
  return map[phase] ?? phase;
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

// ---- start ----
startBtn.addEventListener("click", async () => {
  setupError.hidden = true;
  show(progress);
  const result = await craftparty.startParty({
    worldName: worldName.value.trim(),
    acceptEula: eula.checked,
    remote: remote.checked,
  });
  if (result.error) {
    show(setup);
    setupError.textContent = result.error;
    setupError.hidden = false;
    return;
  }
  $("invite").value = result.inviteCode;
  $("running-detail").textContent = result.remote
    ? "Friends anywhere on the internet can join with your invite."
    : "Friends on your home network can join with your invite.";
  show(running);
});

// ---- copy ----
$("copy").addEventListener("click", async () => {
  await craftparty.copy($("invite").value);
  $("copy").textContent = "Copied!";
  setTimeout(() => ($("copy").textContent = "Copy"), 1500);
});

// ---- stop ----
$("stop").addEventListener("click", async () => {
  $("stop").disabled = true;
  await craftparty.stopParty();
  $("stop").disabled = false;
  show(setup);
});
