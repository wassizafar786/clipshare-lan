/* global clipshare */

const $ = (id) => document.getElementById(id);
let pendingPeerId = null;
let updateDismissed = false;

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

function placeBlips(peers) {
  const host = $("radarPeers");
  host.innerHTML = "";
  const n = peers.length;
  if (!n) return;

  peers.forEach((peer, i) => {
    // Place on the visible disc rim (~39% of stage = ~ half of 78% disk)
    const angle = (-Math.PI / 2) + (2 * Math.PI * i) / n;
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
    opt.textContent = peers.length ? "All nearby devices are already paired" : "Waiting for devices on Wi‑Fi…";
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

function renderPeerList(peers) {
  const list = $("peers");
  list.innerHTML = "";
  fillManualPeerSelect(peers);
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

function renderUpdateBar(state) {
  const bar = $("updateBar");
  const ver = state.appVersion ? `v${state.appVersion}` : "v—";
  $("appVersion").textContent = ver;

  const show =
    !!state.updateAvailable &&
    !!state.updateVersion &&
    !updateDismissed;
  if (!show) {
    bar.classList.add("hidden");
    return;
  }
  $("updateText").textContent = `Update available: ${ver} → v${state.updateVersion}`;
  bar.classList.remove("hidden");
}

function render(state) {
  if (!state) return;
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
    err.textContent = String(e?.message || e);
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
    $("pairError").textContent = String(err?.message || err);
    $("pairError").classList.remove("hidden");
  }
};

$("btnUpdate").onclick = async () => {
  await window.clipshare.openUpdate();
};

$("btnDismissUpdate").onclick = () => {
  updateDismissed = true;
  $("updateBar").classList.add("hidden");
};

window.clipshare.onState(render);
window.clipshare.getState().then(render);
