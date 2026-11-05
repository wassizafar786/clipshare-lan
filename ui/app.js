/* global clipshare */

const $ = (id) => document.getElementById(id);
let pendingPeerId = null;
let updateDismissed = false;
let activeTab = "home";
let lastState = null;

const KIND_LABEL = {
  pc: "PC",
  mac: "Mac",
  linux: "Linux",
  mobile: "Mobile",
  iphone: "iPhone",
  unknown: "Device",
};

const KIND_MARK = {
  pc: "PC",
  mac: "Mac",
  linux: "Lin",
  mobile: "Mob",
  iphone: "iPh",
  unknown: "?",
};

function kindOf(peerOrKind) {
  const k = typeof peerOrKind === "string" ? peerOrKind : peerOrKind?.kind;
  return KIND_LABEL[k] ? k : "unknown";
}

function kindLabel(peerOrKind) {
  return KIND_LABEL[kindOf(peerOrKind)];
}

function peerStatus(peer) {
  if (peer.paired && peer.connected) return "paired";
  if (peer.paired) return "offline";
  return "seen";
}

function errText(e) {
  return String(e?.message || e)
    .replace(/^Error invoking remote method '[^']+':\s*/, "")
    .replace(/^Error:\s*/, "");
}

function setTab(name) {
  activeTab = name;
  document.querySelectorAll(".tab").forEach((btn) => {
    const on = btn.dataset.tab === name;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    const on = panel.id === `panel-${name}`;
    panel.classList.toggle("active", on);
    panel.hidden = !on;
  });
}

document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => setTab(btn.dataset.tab));
});

function placeBlips(peers) {
  const host = $("radarPeers");
  host.innerHTML = "";
  const n = peers.length;
  if (!n) return;

  peers.forEach((peer, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / n;
    const radius = 39;
    const x = 50 + radius * Math.cos(angle);
    const y = 50 + radius * Math.sin(angle);
    const status = peerStatus(peer);
    const kind = kindOf(peer);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `blip ${status}`;
    btn.style.left = `${x}%`;
    btn.style.top = `${y}%`;
    btn.title = `${peer.name} · ${kindLabel(kind)} · ${status}`;
    btn.setAttribute("aria-label", `${peer.name}, ${kindLabel(kind)}, ${status}`);

    const dot = document.createElement("span");
    dot.className = "blip-dot";
    dot.textContent = KIND_MARK[kind];
    dot.setAttribute("aria-hidden", "true");

    const name = document.createElement("span");
    name.className = "blip-name";
    name.textContent = peer.name;

    const type = document.createElement("span");
    type.className = "blip-kind";
    type.textContent = kindLabel(kind);

    btn.appendChild(dot);
    btn.appendChild(name);
    btn.appendChild(type);

    if (!peer.paired) {
      btn.onclick = () => openPairDialog(peer.id, peer.name);
    } else {
      btn.onclick = () => {
        const row = document.querySelector(`[data-peer-id="${CSS.escape(peer.id)}"]`);
        row?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      };
    }
    host.appendChild(btn);
  });
}

function fillManualPeerSelect(peers) {
  const sel = $("manualPeer");
  const prev = sel.value;
  sel.innerHTML = "";
  const unpaired = peers.filter((p) => !p.paired);
  if (!unpaired.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = peers.length
      ? "All nearby devices are already paired"
      : "Waiting for devices on Wi‑Fi…";
    sel.appendChild(opt);
    sel.disabled = true;
    return;
  }
  sel.disabled = false;
  for (const peer of unpaired) {
    const opt = document.createElement("option");
    opt.value = peer.id;
    opt.textContent = `${peer.name} (${kindLabel(peer)}) · ${peer.host}`;
    sel.appendChild(opt);
  }
  if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
}

function fillSharePeerSelect(peers) {
  const sel = $("sharePeer");
  const prev = sel.value;
  sel.innerHTML = "";
  const ready = peers.filter((p) => p.paired && p.connected);
  if (!ready.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = peers.some((p) => p.paired)
      ? "Paired devices are offline"
      : "Pair a device on Home first";
    sel.appendChild(opt);
    sel.disabled = true;
    $("btnPickFiles").disabled = true;
    return;
  }
  sel.disabled = false;
  $("btnPickFiles").disabled = false;
  for (const peer of ready) {
    const opt = document.createElement("option");
    opt.value = peer.id;
    opt.textContent = `${peer.name} (${kindLabel(peer)})`;
    sel.appendChild(opt);
  }
  if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
}

function renderPeerList(peers) {
  const list = $("peers");
  list.innerHTML = "";
  fillManualPeerSelect(peers);
  fillSharePeerSelect(peers);
  if (!peers.length) {
    const empty = document.createElement("li");
    empty.innerHTML =
      "<span class='hint'>No peers yet — open ClipShare on the other PC/Mac on the same Wi‑Fi, and allow local network / private network firewall access.</span>";
    list.appendChild(empty);
    return;
  }

  for (const peer of peers) {
    const li = document.createElement("li");
    li.dataset.peerId = peer.id;
    const left = document.createElement("div");
    left.innerHTML = `<div class="peer-title"><strong>${escapeHtml(peer.name)}</strong><span class="kind-chip">${escapeHtml(kindLabel(peer))}</span></div><div class="meta">${escapeHtml(peer.host)}:${peer.port}</div>`;
    const right = document.createElement("div");
    right.className = "row";
    const status = peerStatus(peer);
    const badge = document.createElement("span");
    badge.className = "badge" + (status === "paired" ? " ok" : status === "offline" ? " warn" : "");
    badge.textContent =
      status === "paired" ? "paired" : status === "offline" ? "paired · offline" : "seen";
    right.appendChild(badge);

    if (!peer.paired) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tiny";
      btn.textContent = "Enter code";
      btn.onclick = () => openPairDialog(peer.id, peer.name);
      right.appendChild(btn);
    } else {
      const forget = document.createElement("button");
      forget.type = "button";
      forget.className = "tiny ghost";
      forget.textContent = "Unpair";
      forget.onclick = async () => {
        await window.clipshare.unpairPeer(peer.id);
        render(await window.clipshare.getState());
      };
      right.appendChild(forget);
    }

    li.appendChild(left);
    li.appendChild(right);
    list.appendChild(li);
  }
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function renderTransfers(transfers) {
  const list = $("transferList");
  list.innerHTML = "";
  const items = (transfers || []).slice().reverse();
  if (!items.length) {
    const empty = document.createElement("li");
    empty.innerHTML = "<span class='hint'>No transfers yet.</span>";
    list.appendChild(empty);
    return;
  }
  for (const t of items) {
    const li = document.createElement("li");
    const pct = t.bytesTotal ? Math.min(100, Math.round((100 * t.bytesDone) / t.bytesTotal)) : 0;
    const dir = t.direction === "in" ? "Receiving" : "Sending";
    li.innerHTML = `<div><strong>${escapeHtml(t.fileName)}</strong></div>
      <div class="transfer-meta">${dir} · ${escapeHtml(t.peerName)} · ${formatBytes(t.bytesDone)} / ${formatBytes(t.bytesTotal)} · ${escapeHtml(t.status)}${t.error ? " · " + escapeHtml(t.error) : ""}</div>
      <div class="progress" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>`;
    list.appendChild(li);
  }
}

function renderHistory(entries) {
  const list = $("historyList");
  list.innerHTML = "";
  const items = entries || [];
  if (!items.length) {
    const empty = document.createElement("li");
    empty.innerHTML = "<span class='hint'>Nothing here yet — share text or files to build history.</span>";
    list.appendChild(empty);
    return;
  }
  for (const e of items) {
    const li = document.createElement("li");
    const when = new Date(e.createdAt).toLocaleString();
    const dir = e.direction === "in" ? "Received" : "Sent";
    const title =
      e.kind === "file"
        ? e.fileName || "File"
        : (e.text || "").slice(0, 80) || "Text";
    const meta =
      e.kind === "file"
        ? `${dir} file · ${escapeHtml(e.peerName)} · ${formatBytes(e.size || 0)} · ${escapeHtml(when)}`
        : `${dir} text · ${escapeHtml(e.peerName)} · ${escapeHtml(when)}`;

    const head = document.createElement("div");
    head.innerHTML = `<strong>${escapeHtml(title)}</strong><div class="history-meta">${meta}</div>`;
    li.appendChild(head);

    const actions = document.createElement("div");
    actions.className = "history-actions";

    if (e.kind === "text") {
      const copy = document.createElement("button");
      copy.type = "button";
      copy.className = "tiny";
      copy.textContent = "Copy again";
      copy.onclick = async () => {
        await window.clipshare.copyHistory(e.id);
      };
      actions.appendChild(copy);
    } else {
      const open = document.createElement("button");
      open.type = "button";
      open.className = "tiny";
      open.textContent = "Open";
      open.onclick = async () => {
        await window.clipshare.openHistoryFile(e.id);
      };
      actions.appendChild(open);
      const show = document.createElement("button");
      show.type = "button";
      show.className = "tiny ghost";
      show.textContent = "Show in folder";
      show.onclick = async () => {
        await window.clipshare.showHistoryFile(e.id);
      };
      actions.appendChild(show);
    }

    const del = document.createElement("button");
    del.type = "button";
    del.className = "tiny ghost";
    del.textContent = "Delete";
    del.onclick = async () => {
      await window.clipshare.deleteHistory(e.id);
      render(await window.clipshare.getState());
    };
    actions.appendChild(del);

    li.appendChild(actions);
    list.appendChild(li);
  }
}

function renderUpdateBar(state) {
  const bar = $("updateBar");
  const ver = state.appVersion ? `v${state.appVersion}` : "v—";
  $("appVersion").textContent = ver;
  const status = state.updateStatus || "idle";
  const btn = $("btnUpdate");
  const fallback = $("btnUpdateFallback");
  const progressWrap = $("updateProgressWrap");
  const progressBar = $("updateProgressBar");

  const busy = status === "downloading" || status === "checking";
  const show =
    !updateDismissed &&
    (status === "available" ||
      status === "downloading" ||
      status === "downloaded" ||
      status === "error" ||
      (!!state.updateAvailable && !!state.updateVersion));

  $("settingsUpdateHint").textContent =
    status === "downloaded"
      ? `Update ready: restart to install v${state.updateVersion}.`
      : status === "available"
        ? `Update available: v${state.updateVersion}.`
        : status === "dev"
          ? "Updates apply in packaged installs (not while running from source)."
          : `Current ${ver}. Checks GitHub Releases automatically when installed.`;

  if (!show) {
    bar.classList.add("hidden");
    return;
  }
  bar.classList.remove("hidden");

  if (status === "downloading") {
    const pct = state.updateProgress ?? 0;
    $("updateText").textContent = `Downloading update… ${pct}%`;
    progressWrap.classList.remove("hidden");
    progressBar.style.width = `${pct}%`;
    btn.textContent = "Downloading…";
    btn.disabled = true;
    fallback.classList.add("hidden");
  } else if (status === "downloaded") {
    $("updateText").textContent = `Update ready: ${ver} → v${state.updateVersion}. Restart to install.`;
    progressWrap.classList.add("hidden");
    btn.textContent = "Restart to update";
    btn.disabled = false;
    fallback.classList.add("hidden");
  } else if (status === "error") {
    $("updateText").textContent = state.updateError || "Update failed.";
    progressWrap.classList.add("hidden");
    btn.textContent = "Retry update";
    btn.disabled = false;
    fallback.classList.remove("hidden");
  } else {
    $("updateText").textContent = `Update available: ${ver} → v${state.updateVersion}`;
    progressWrap.classList.add("hidden");
    btn.textContent = "Update now";
    btn.disabled = !!busy;
    fallback.classList.add("hidden");
  }
}

function render(state) {
  if (!state) return;
  lastState = state;
  $("deviceName").value = state.deviceName;
  const lan = (state.localAddresses || []).join(", ") || "no LAN IP";
  const selfKind = kindLabel(state.deviceKind || "unknown");
  $("deviceMeta").textContent = `${selfKind} · id ${state.deviceId.slice(0, 8)}… · port ${state.listenPort} · ${lan}`;
  $("centerKind").textContent = selfKind;
  $("syncEnabled").checked = state.syncEnabled;
  renderUpdateBar(state);

  const radar = $("radar");
  if (state.pairingActive && state.pairingCode) {
    $("pairCode").textContent = state.pairingCode;
    $("pairCode").classList.remove("hidden");
    $("centerLabel").textContent = "Your code";
    $("btnCancelPair").classList.remove("hidden");
    $("btnPair").textContent = "Code active";
    $("radarHint").textContent =
      "On the other device, tap this device on the radar and enter the code.";
    radar.classList.add("pairing-active");
  } else {
    $("pairCode").classList.add("hidden");
    $("centerLabel").textContent = "You";
    $("btnCancelPair").classList.add("hidden");
    $("btnPair").textContent = "Start pairing";
    $("radarHint").textContent =
      "Start pairing to show a code. Nearby devices appear on the radar.";
    radar.classList.remove("pairing-active");
  }

  placeBlips(state.peers);
  renderPeerList(state.peers);
  renderTransfers(state.transfers);
  renderHistory(state.history);
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function openPairDialog(peerId, name) {
  pendingPeerId = peerId;
  $("pairPeerName").textContent = name;
  $("pairInput").value = "";
  $("pairError").textContent = "";
  $("pairError").classList.add("hidden");
  $("pairDialog").showModal();
  $("pairInput").focus();
}

function closePairDialog() {
  pendingPeerId = null;
  $("pairError").textContent = "";
  $("pairError").classList.add("hidden");
  if ($("pairDialog").open) $("pairDialog").close();
}

$("btnPair").onclick = async () => {
  await window.clipshare.beginPairing();
  render(await window.clipshare.getState());
};

$("btnCancelPair").onclick = async () => {
  await window.clipshare.cancelPairing();
  render(await window.clipshare.getState());
};

$("syncEnabled").onchange = async (e) => {
  await window.clipshare.setSync(e.target.checked);
};

$("deviceName").onchange = async (e) => {
  await window.clipshare.setName(e.target.value.trim() || "ClipShare device");
};

$("btnManual").onclick = async () => {
  const host = $("manualHost").value.trim();
  const port = Number($("manualPort").value.trim());
  if (!host || !port) {
    alert("Enter host and port");
    return;
  }
  await window.clipshare.addManualPeer(host, port);
  render(await window.clipshare.getState());
};

$("btnManualPair").onclick = async () => {
  const peerId = $("manualPeer").value;
  const code = $("manualCode").value.trim();
  const err = $("manualPairError");
  err.classList.add("hidden");
  if (!peerId) {
    err.textContent = "Wait until the other device appears, or add it by host:port first.";
    err.classList.remove("hidden");
    return;
  }
  if (code.length < 4) {
    err.textContent = "Enter the 6-digit code from the other device.";
    err.classList.remove("hidden");
    return;
  }
  try {
    await window.clipshare.pairWith(peerId, code);
    $("manualCode").value = "";
    render(await window.clipshare.getState());
  } catch (e) {
    err.textContent = errText(e);
    err.classList.remove("hidden");
  }
};

$("pairCancel").onclick = () => {
  closePairDialog();
};

$("pairForm").onsubmit = async (e) => {
  e.preventDefault();
  const code = $("pairInput").value.trim();
  if (!pendingPeerId) {
    closePairDialog();
    return;
  }
  if (code.length < 4) {
    $("pairError").textContent = "Enter the 6-digit code from the other device.";
    $("pairError").classList.remove("hidden");
    return;
  }
  try {
    await window.clipshare.pairWith(pendingPeerId, code);
    closePairDialog();
    render(await window.clipshare.getState());
  } catch (err) {
    $("pairError").textContent = errText(err);
    $("pairError").classList.remove("hidden");
  }
};

$("btnUpdate").onclick = async () => {
  const state = await window.clipshare.getState();
  const status = state?.updateStatus;
  if (status === "downloaded") {
    await window.clipshare.installUpdate();
    return;
  }
  if (status === "error" || status === "available" || status === "idle" || !status) {
    $("btnUpdate").disabled = true;
    await window.clipshare.downloadUpdate();
    render(await window.clipshare.getState());
  }
};

$("btnUpdateFallback").onclick = async () => {
  await window.clipshare.openUpdate();
};

$("btnDismissUpdate").onclick = () => {
  updateDismissed = true;
  $("updateBar").classList.add("hidden");
};

$("btnCheckUpdate").onclick = async () => {
  await window.clipshare.checkUpdate();
  render(await window.clipshare.getState());
};

$("btnPickFiles").onclick = async () => {
  const err = $("shareError");
  err.classList.add("hidden");
  const peerId = $("sharePeer").value;
  if (!peerId) {
    err.textContent = "Select a paired online device first.";
    err.classList.remove("hidden");
    return;
  }
  const paths = await window.clipshare.pickFiles();
  if (!paths?.length) return;
  $("btnPickFiles").disabled = true;
  try {
    await window.clipshare.sendFiles(peerId, paths);
  } catch (e) {
    err.textContent = errText(e);
    err.classList.remove("hidden");
  } finally {
    $("btnPickFiles").disabled = false;
    render(await window.clipshare.getState());
  }
};

$("btnOpenReceive").onclick = async () => {
  await window.clipshare.openReceiveFolder();
};

$("btnClearHistory").onclick = async () => {
  if (!confirm("Clear all history on this device?")) return;
  await window.clipshare.clearHistory();
  render(await window.clipshare.getState());
};

setTab("home");
window.clipshare.onState(render);
window.clipshare.getState().then(render);
