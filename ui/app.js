/* global clipshare */

const $ = (id) => document.getElementById(id);
let pendingPeerId = null;

function render(state) {
  if (!state) return;
  $("deviceName").value = state.deviceName;
  $("deviceMeta").textContent = `id ${state.deviceId.slice(0, 8)}… · port ${state.listenPort}`;
  $("syncEnabled").checked = state.syncEnabled;

  if (state.pairingActive && state.pairingCode) {
    $("pairCode").textContent = state.pairingCode;
    $("pairCode").classList.remove("hidden");
    $("btnCancelPair").classList.remove("hidden");
    $("btnPair").textContent = "Code active";
  } else {
    $("pairCode").classList.add("hidden");
    $("btnCancelPair").classList.add("hidden");
    $("btnPair").textContent = "Show code";
  }

  const list = $("peers");
  list.innerHTML = "";
  if (!state.peers.length) {
    const empty = document.createElement("li");
    empty.innerHTML = "<span class='hint'>No peers yet — start the app on another device on this Wi‑Fi.</span>";
    list.appendChild(empty);
    return;
  }

  for (const peer of state.peers) {
    const li = document.createElement("li");
    const left = document.createElement("div");
    left.innerHTML = `<strong>${escapeHtml(peer.name)}</strong><div class="meta">${escapeHtml(peer.host)}:${peer.port}</div>`;
    const right = document.createElement("div");
    right.className = "row";
    const badge = document.createElement("span");
    badge.className = "badge" + (peer.paired && peer.connected ? " ok" : "");
    badge.textContent = peer.paired
      ? peer.connected
        ? "paired"
        : "paired · offline"
      : "seen";
    right.appendChild(badge);
    if (!peer.paired) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "Enter code";
      btn.onclick = () => openPairDialog(peer.id, peer.name);
      right.appendChild(btn);
    }
    li.appendChild(left);
    li.appendChild(right);
    list.appendChild(li);
  }
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
  $("pairDialog").showModal();
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

$("pairForm").onsubmit = async (e) => {
  const submitter = e.submitter;
  if (submitter && submitter.value === "cancel") return;
  e.preventDefault();
  const code = $("pairInput").value.trim();
  if (!pendingPeerId || code.length < 4) return;
  try {
    await window.clipshare.pairWith(pendingPeerId, code);
    $("pairDialog").close();
    render(await window.clipshare.getState());
  } catch (err) {
    alert(String(err?.message || err));
  }
};

window.clipshare.onState(render);
window.clipshare.getState().then(render);
