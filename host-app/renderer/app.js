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
const worldName = $("world-name");
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

function refreshStartEnabled() {
  startBtn.disabled = !(worldName.value.trim() && eula.checked);
}

worldName.addEventListener("input", refreshStartEnabled);
eula.addEventListener("change", refreshStartEnabled);

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

// ---- start ----
startBtn.addEventListener("click", async () => {
  setupError.hidden = true;
  $("setup-report").hidden = true;
  rememberSection(progress);
  const result = await craftparty.startParty({
    worldName: worldName.value.trim(),
    acceptEula: eula.checked,
    remote: remote.checked,
  });
  if (result.error) {
    rememberSection(setup);
    setupError.textContent = result.error;
    setupError.hidden = false;
    showReport("setup", result);
    return;
  }
  $("invite").value = result.inviteCode;
  $("host-address").value = `localhost:${result.port}`;
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
$("stop").addEventListener("click", async () => {
  $("stop").disabled = true;
  await craftparty.stopParty();
  $("stop").disabled = false;
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
