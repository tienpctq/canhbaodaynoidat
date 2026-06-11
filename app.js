import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getDatabase, ref, onValue, update, set, push } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyDHDU9dCyYz7Ch9WHGfgE7pTUytqghjrHA",
  authDomain: "canhbaodaynoidat.firebaseapp.com",
  databaseURL: "https://canhbaodaynoidat-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "canhbaodaynoidat",
  storageBucket: "canhbaodaynoidat.firebasestorage.app",
  messagingSenderId: "974446692026",
  appId: "1:974446692026:web:c9026440d7217c38b0e483",
  measurementId: "G-PQ2MCZF8L8"
};

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getDatabase(firebaseApp);

let devices = {};
let remoteLogs = [];
let localLogs = [];
let selectedId = null;
let activeDetailTab = "overview";
let lastSnapshot = "";
let currentPage = 1;
let pageSize = 8;

const $ = (id) => document.getElementById(id);
const fmtTime = () => new Date().toLocaleString("vi-VN");
const valueOf = (d, ...keys) => {
  const key = keys.find((name) => d?.[name] !== undefined);
  return key ? d[key] : undefined;
};
const isOk = (v) => Number(v) === 1 || v === true || String(v).trim().toUpperCase() === "OK" || String(v).trim().toUpperCase() === "ONLINE";
const isOnline = (d) => isOk(valueOf(d, "ONLINE", "online"));
const phaseOk = (d, phase) => isOk(valueOf(d, phase, phase.toLowerCase()));
const powerOk = (d) => isOk(valueOf(d, "LINEPW", "POWER", "SOURCE"));
const buzzerOn = (d) => isOk(valueOf(d, "ENABLEBUZZ", "BUZZER"));
const hasAlert = (d) => !phaseOk(d, "LINE1") || !phaseOk(d, "LINE2") || !phaseOk(d, "LINE3") || !powerOk(d) || isOk(valueOf(d, "WARNING"));
const esc = (s = "") => String(s).replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));

function statusBadge(ok, textOk = "ONLINE", textBad = "OFFLINE") {
  return `<span class="badge ${ok ? "green" : "gray"}">${ok ? textOk : textBad}</span>`;
}

function alertBadge(d) {
  return hasAlert(d) ? '<span class="badge red">CẢNH BÁO</span>' : '<span class="badge orange">CHỜ</span>';
}

function lineDot(ok) {
  return `<span class="phase-dot ${ok ? "" : "red"}"></span>`;
}

function lineText(ok) {
  return ok ? "OK" : "ĐỨT";
}

function sourceText(ok) {
  return ok ? "CÓ NGUỒN" : "MẤT NGUỒN";
}

function notify(text, type = "ok") {
  const toast = $("toast");
  toast.textContent = text;
  toast.className = `toast show ${type}`;
  window.clearTimeout(notify.timer);
  notify.timer = window.setTimeout(() => toast.className = "toast", 2600);
}

function loadLocalLogs() {
  try {
    localLogs = JSON.parse(localStorage.getItem("evnLogs") || "[]");
  } catch {
    localLogs = [];
  }
}

function saveLocalLog(item) {
  localLogs.unshift(item);
  localLogs = localLogs.slice(0, 80);
  localStorage.setItem("evnLogs", JSON.stringify(localLogs));
}

async function addLog(text, type = "info") {
  const item = { text, type, time: fmtTime(), ts: Date.now() };
  saveLocalLog(item);
  renderLogs();

  try {
    await push(ref(db, "Logs"), item);
  } catch {
    // Local logs remain available when rules do not allow writing Logs yet.
  }
}

function setConnection(state, text) {
  const el = $("fbStatus");
  el.textContent = text;
  el.className = state;
}

function groupsFromDevices() {
  return [...new Set(Object.values(devices).map((d) => d.GROUP || "Chưa phân nhóm"))].sort((a, b) => String(a).localeCompare(String(b), "vi"));
}

function syncGroupFilter() {
  const filter = $("groupFilter");
  const current = filter.value;
  filter.innerHTML = '<option value="all">Tất cả nhóm</option>' + groupsFromDevices().map((group) => `<option value="${esc(group)}">${esc(group)}</option>`).join("");
  filter.value = [...filter.options].some((o) => o.value === current) ? current : "all";
}

function matchTriState(value, filterValue) {
  return filterValue === "all" || (filterValue === "ok" && value) || (filterValue === "bad" && !value);
}

function filteredDevices() {
  const q = $("searchBox").value.trim().toLowerCase();
  const status = $("statusFilter").value;
  const group = $("groupFilter").value;

  return Object.entries(devices).filter(([id, d]) => {
    const text = [id, d.VITRI, d.SDT, d.SMS, d.GROUP].join(" ").toLowerCase();
    const matchQ = !q || text.includes(q);
    const matchGroup = group === "all" || String(d.GROUP || "Chưa phân nhóm") === group;
    const matchStatus = status === "all" || (status === "online" && isOnline(d)) || (status === "offline" && !isOnline(d)) || (status === "alert" && hasAlert(d));
    const matchLines = matchTriState(phaseOk(d, "LINE1"), $("line1Filter").value)
      && matchTriState(phaseOk(d, "LINE2"), $("line2Filter").value)
      && matchTriState(phaseOk(d, "LINE3"), $("line3Filter").value)
      && matchTriState(powerOk(d), $("powerFilter").value);
    return matchQ && matchGroup && matchStatus && matchLines;
  });
}

function renderStats(list) {
  const total = list.length;
  const online = list.filter(([, d]) => isOnline(d)).length;
  const alert = list.filter(([, d]) => hasAlert(d)).length;
  const offline = total - online;

  $("totalDevices").textContent = total;
  $("onlineDevices").textContent = online;
  $("offlineDevices").textContent = offline;
  $("alertDevices").textContent = alert;
  $("deviceCountTitle").textContent = total;
  $("bellCount").textContent = alert;
  $("sideAlertCount").textContent = alert;
  $("lgOnline").textContent = online;
  $("lgOffline").textContent = offline;
  $("lgAlert").textContent = alert;
  $("onlinePercent").textContent = total ? `${Math.round((online / total) * 100)}% thiết bị đang online` : "0% thiết bị đang online";

  const onlineDeg = total ? (online / total) * 360 : 0;
  const offDeg = total ? (offline / total) * 360 : 0;
  $("donut").style.background = `conic-gradient(var(--green) 0deg ${onlineDeg}deg,var(--gray) ${onlineDeg}deg ${onlineDeg + offDeg}deg,var(--red) ${onlineDeg + offDeg}deg 360deg)`;
}

function renderPagination(total) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  currentPage = Math.min(currentPage, totalPages);
  const start = total ? (currentPage - 1) * pageSize + 1 : 0;
  const end = Math.min(currentPage * pageSize, total);
  $("pageInfo").textContent = `Hiển thị ${start} - ${end} trong ${total} thiết bị`;
  $("prevPage").disabled = currentPage <= 1;
  $("nextPage").disabled = currentPage >= totalPages;

  $("pageButtons").innerHTML = Array.from({ length: totalPages }, (_, idx) => idx + 1)
    .filter((page) => totalPages <= 5 || page === 1 || page === totalPages || Math.abs(page - currentPage) <= 1)
    .map((page, idx, arr) => `${idx && page - arr[idx - 1] > 1 ? '<span class="page-gap">...</span>' : ''}<button class="action-btn ${page === currentPage ? "active-page" : ""}" data-page="${page}">${page}</button>`)
    .join("");
}

function renderTable() {
  const allEntries = Object.entries(devices);
  const list = filteredDevices();
  renderStats(allEntries);
  syncGroupFilter();
  $("emptyState").classList.toggle("hidden", allEntries.length !== 0);
  renderPagination(list.length);

  const pageItems = list.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  $("deviceRows").innerHTML = pageItems.map(([id, d]) => {
    const l1 = phaseOk(d, "LINE1");
    const l2 = phaseOk(d, "LINE2");
    const l3 = phaseOk(d, "LINE3");
    const power = powerOk(d);
    return `
      <tr class="${selectedId === id ? "selected" : ""}">
        <td><b>${esc(id)}</b></td>
        <td>${esc(d.VITRI || "--")}</td>
        <td>${statusBadge(isOnline(d))}</td>
        <td>${lineDot(l1)}</td>
        <td>${lineDot(l2)}</td>
        <td>${lineDot(l3)}</td>
        <td>${power ? '<span class="badge green">CÓ NGUỒN</span>' : '<span class="badge red">MẤT NGUỒN</span>'}</td>
        <td>${alertBadge(d)}</td>
        <td>${esc(d.LAST_UPDATE || d.lastSeen || "--")}</td>
        <td class="actions">
          <button class="action-btn" data-view-id="${esc(id)}" title="Xem chi tiết">👁</button>
          <button class="action-btn" data-test-id="${esc(id)}" title="Test cảnh báo">⚡</button>
          <button class="action-btn" data-reset-id="${esc(id)}" title="Reset thiết bị">↻</button>
        </td>
      </tr>`;
  }).join("") || '<tr><td colspan="10">Không có thiết bị phù hợp</td></tr>';

  renderRecentAlerts();
  renderLists();
}

function selectDevice(id) {
  selectedId = id;
  activeDetailTab = "overview";
  renderDetail();
  renderTable();
}

function renderDetail() {
  const d = devices[selectedId];
  if (!selectedId || !d) {
    $("detailContent").innerHTML = '<div class="detail-empty">Chọn một thiết bị để xem chi tiết</div>';
    return;
  }

  const l1 = phaseOk(d, "LINE1");
  const l2 = phaseOk(d, "LINE2");
  const l3 = phaseOk(d, "LINE3");
  const power = powerOk(d);
  const tabButtons = `
    <div class="tabs">
      <button class="${activeDetailTab === "overview" ? "active" : ""}" data-detail-tab="overview">Tổng quan</button>
      <button class="${activeDetailTab === "config" ? "active" : ""}" data-detail-tab="config">Cấu hình</button>
      <button class="${activeDetailTab === "history" ? "active" : ""}" data-detail-tab="history">Lịch sử</button>
    </div>`;

  const overview = `
    <h4>TRẠNG THÁI 3 PHA</h4>
    <div class="phase-grid">
      <div class="phase-box ${l1 ? "" : "bad"}">L1<b>${lineText(l1)}</b></div>
      <div class="phase-box ${l2 ? "" : "bad"}">L2<b>${lineText(l2)}</b></div>
      <div class="phase-box ${l3 ? "" : "bad"}">L3<b>${lineText(l3)}</b></div>
    </div>
    <div class="mini-grid">
      <div class="mini-box">🔌<br>Nguồn LOOP<b class="${power ? "" : "bad-text"}">${sourceText(power)}</b></div>
      <div class="mini-box">🔔<br>Còi cảnh báo<b>${buzzerOn(d) ? "BẬT" : "TẮT"}</b></div>
      <div class="mini-box">⏱<br>Phản hồi<b>${isOk(d.RESPONSE) ? "ĐÃ NHẬN" : "CHỜ"}</b></div>
    </div>`;

  const config = `
    <div class="config-list">
      <div class="config-row"><label>Số điện thoại</label><input id="cfgPhone" value="${esc(d.SDT || "")}"><button data-save-field="SDT">💾</button></div>
      <div class="config-row"><label>Nội dung SMS</label><input id="cfgSms" value="${esc(d.SMS || "")}"><button data-save-field="SMS">💾</button></div>
      <div class="config-row"><label>Chu kỳ gửi (giây)</label><input id="cfgInterval" type="number" min="5" value="${esc(d.SEND_INTERVAL || 30)}"><button data-save-field="SEND_INTERVAL">💾</button></div>
      <div class="config-row"><label>Vị trí</label><input id="cfgLocation" value="${esc(d.VITRI || "")}"><button data-save-field="VITRI">💾</button></div>
      <button class="outline save-wide" id="saveAllCfg">💾 Lưu cấu hình</button>
    </div>`;

  const history = logsForDevice(selectedId).slice(0, 12).map((log) => `<div class="history-item"><b>${esc(log.text)}</b><small>${esc(log.time || "")}</small></div>`).join("") || '<div class="list-empty">Chưa có lịch sử cho thiết bị này</div>';
  const content = activeDetailTab === "config" ? config : activeDetailTab === "history" ? history : overview;

  $("detailContent").innerHTML = `
    <div class="device-detail">
      <div class="device-title"><h2>${esc(selectedId)}</h2>${statusBadge(isOnline(d))}</div>
      <p>${esc(d.VITRI || "--")}</p>
      <p class="updated">Cập nhật: ${esc(d.LAST_UPDATE || d.lastSeen || "--")}</p>
      ${tabButtons}
      ${content}
      <h4>ĐIỀU KHIỂN THIẾT BỊ</h4>
      <div class="control-grid">
        <button class="warn" data-test-id="${esc(selectedId)}">⚡<br>Test cảnh báo</button>
        <button class="buzz" data-buzz-id="${esc(selectedId)}">🔕<br>${buzzerOn(d) ? "Tắt còi" : "Bật còi"}</button>
        <button class="reset" data-reset-id="${esc(selectedId)}">↻<br>Reset thiết bị</button>
      </div>
    </div>`;
}

function renderRecentAlerts() {
  const alerts = Object.entries(devices).filter(([, d]) => hasAlert(d)).slice(0, 5);
  $("recentAlerts").innerHTML = alerts.length
    ? alerts.map(([id, d]) => `<div class="alert-item"><b>${esc(id)} - ${esc(d.VITRI || "")}</b><small>${esc(fmtAlert(d))}</small></div>`).join("")
    : '<div class="list-empty">Chưa có cảnh báo</div>';
}

function allLogs() {
  const merged = [...remoteLogs, ...localLogs];
  const seen = new Set();
  return merged
    .filter((log) => {
      const key = `${log.time}|${log.text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0));
}

function logsForDevice(id) {
  return allLogs().filter((log) => String(log.text || "").includes(id));
}

function renderLogs() {
  const logs = allLogs();
  $("activityLog").innerHTML = logs.length ? logs.slice(0, 5).map((l) => `<div class="log"><b>${esc(l.text)}</b><small>${esc(l.time || "")}</small></div>`).join("") : '<div class="list-empty">Chưa có nhật ký</div>';
  $("historyList").innerHTML = logs.length ? logs.map((l) => `<div class="history-item"><b>${esc(l.text)}</b><small>${esc(l.time || "")}</small></div>`).join("") : '<div class="list-empty">Chưa có lịch sử</div>';
}

function renderLists() {
  const entries = Object.entries(devices);
  $("alertList").innerHTML = entries.filter(([, d]) => hasAlert(d)).map(([id, d]) => `<div class="alert-item"><b>${esc(id)} - ${esc(d.VITRI || "")}</b><small>${esc(fmtAlert(d))}</small></div>`).join("") || '<div class="list-empty">Không có cảnh báo</div>';

  const groups = entries.reduce((acc, [id, d]) => {
    const group = d.GROUP || "Chưa phân nhóm";
    (acc[group] ||= []).push(id);
    return acc;
  }, {});
  $("groupList").innerHTML = Object.entries(groups).map(([group, ids]) => `<p><b>${esc(group)}</b>: ${ids.map(esc).join(", ")}</p>`).join("") || '<div class="list-empty">Chưa có thiết bị</div>';

  $("mapList").innerHTML = entries.map(([id, d]) => {
    const hasLocation = d.LAT && d.LNG;
    const link = hasLocation ? ` <a target="_blank" href="https://www.google.com/maps?q=${encodeURIComponent(`${d.LAT},${d.LNG}`)}">Mở bản đồ</a>` : "";
    return `<div class="alert-item"><b>${esc(id)} - ${esc(d.VITRI || "")}</b><small>LAT: ${esc(d.LAT || "chưa có")}, LNG: ${esc(d.LNG || "chưa có")}${link}</small></div>`;
  }).join("") || "Chưa có thiết bị";
}

function fmtAlert(d) {
  const arr = [];
  if (!phaseOk(d, "LINE1")) arr.push("L1 đứt");
  if (!phaseOk(d, "LINE2")) arr.push("L2 đứt");
  if (!phaseOk(d, "LINE3")) arr.push("L3 đứt");
  if (!powerOk(d)) arr.push("Mất nguồn");
  if (isOk(valueOf(d, "WARNING"))) arr.push("Đang cảnh báo");
  return arr.join(", ") || "Bình thường";
}

async function writeDevice(id, data, actionText) {
  try {
    await update(ref(db, `Device/${id}`), { ...data, LAST_UPDATE: fmtTime() });
    await addLog(`${actionText}: ${id}`);
    notify(`${actionText} thành công`);
  } catch (err) {
    notify(`Lỗi ghi Firebase: ${err.message}`, "error");
  }
}

function saveConfig(id) {
  writeDevice(id, {
    SDT: $("cfgPhone").value.trim(),
    SMS: $("cfgSms").value.trim(),
    SEND_INTERVAL: Number($("cfgInterval").value || 30),
    VITRI: $("cfgLocation").value.trim(),
    RESPONSE: 0
  }, "Cập nhật cấu hình");
}

function handleSnapshot(snapshot) {
  const next = snapshot.val() || {};
  const serialized = JSON.stringify(next);
  if (lastSnapshot && serialized !== lastSnapshot) addLog("Firebase cập nhật dữ liệu realtime");
  lastSnapshot = serialized;

  devices = next;
  setConnection("ok", "AUTHENTICATED");
  $("lastSync").textContent = new Date().toLocaleTimeString("vi-VN");
  if (!selectedId && Object.keys(devices).length) selectedId = Object.keys(devices)[0];
  if (selectedId && !devices[selectedId]) selectedId = Object.keys(devices)[0] || null;
  renderTable();
  renderDetail();
}

function handleLogs(snapshot) {
  remoteLogs = Object.values(snapshot.val() || {}).sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0)).slice(0, 80);
  renderLogs();
  renderDetail();
}

async function startFirebase() {
  try {
    setConnection("pending", "AUTHENTICATING");
    const credential = await signInAnonymously(auth);
    setConnection("ok", "AUTHENTICATED");
    saveLocalLog({ text: `Firebase Auth anonymous: ${credential.user.uid}`, type: "auth", time: fmtTime(), ts: Date.now() });

    onValue(ref(db, "Device"), handleSnapshot, (err) => {
      setConnection("error", "DATABASE ERROR");
      notify(`Không đọc được Firebase: ${err.message}`, "error");
    });
    onValue(ref(db, "Logs"), handleLogs, () => renderLogs());
  } catch (err) {
    setConnection("error", "AUTH ERROR");
    notify(`Không đăng nhập được Firebase Auth: ${err.message}`, "error");
  }
}

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

loadLocalLogs();
renderLogs();
startFirebase();
$("clock").textContent = new Date().toLocaleTimeString("vi-VN");
setInterval(() => $("clock").textContent = new Date().toLocaleTimeString("vi-VN"), 1000);

["searchBox", "statusFilter", "groupFilter", "line1Filter", "line2Filter", "line3Filter", "powerFilter"].forEach((id) => $(id).addEventListener("input", () => {
  currentPage = 1;
  renderTable();
}));

$("pageSize").addEventListener("change", () => {
  pageSize = Number($("pageSize").value);
  currentPage = 1;
  renderTable();
});
$("prevPage").onclick = () => { currentPage = Math.max(1, currentPage - 1); renderTable(); };
$("nextPage").onclick = () => { currentPage += 1; renderTable(); };
$("advancedFilterBtn").onclick = () => $("advancedPanel").classList.toggle("hidden");
$("clearFilters").onclick = () => {
  ["searchBox"].forEach((id) => $(id).value = "");
  ["statusFilter", "groupFilter", "line1Filter", "line2Filter", "line3Filter", "powerFilter"].forEach((id) => $(id).value = "all");
  currentPage = 1;
  renderTable();
};
$("exportDevices").onclick = () => downloadJson(`devices-${Date.now()}.json`, devices);
$("backupAll").onclick = () => downloadJson(`canhbaodaynoidat-backup-${Date.now()}.json`, { Device: devices, Logs: allLogs() });
$("addDeviceBtn").onclick = () => $("deviceModal").classList.add("show");
$("cancelAdd").onclick = () => $("deviceModal").classList.remove("show");
$("confirmAdd").onclick = async () => {
  const id = $("newId").value.trim();
  if (!id) return notify("Nhập ID thiết bị", "error");
  if (devices[id] && !confirm(`Thiết bị ${id} đã tồn tại. Ghi đè dữ liệu?`)) return;
  try {
    await set(ref(db, `Device/${id}`), {
      LINE1: 1,
      LINE2: 1,
      LINE3: 1,
      LINEPW: 1,
      ONLINE: 0,
      WARNING: 0,
      ENABLEBUZZ: 0,
      SDT: $("newPhone").value.trim(),
      SMS: "Phat hien dut day dien",
      SEND_INTERVAL: 30,
      VITRI: $("newLocation").value.trim(),
      RST: 0,
      RESPONSE: 0,
      LAST_UPDATE: fmtTime()
    });
    await addLog(`Thêm thiết bị ${id}`);
    notify("Đã tạo thiết bị");
    $("deviceModal").classList.remove("show");
    $("newId").value = "";
    $("newLocation").value = "";
    $("newPhone").value = "";
  } catch (err) {
    notify(`Lỗi tạo thiết bị: ${err.message}`, "error");
  }
};

$("clearLogs").onclick = () => {
  localLogs = [];
  localStorage.removeItem("evnLogs");
  renderLogs();
};
$("closeDetail").onclick = () => {
  selectedId = null;
  renderDetail();
  renderTable();
};
$("toggleSidebar").onclick = () => {
  if (window.matchMedia("(max-width: 760px)").matches) {
    document.querySelector(".sidebar").classList.toggle("open");
  } else {
    document.body.classList.toggle("sidebar-collapsed");
  }
};

document.addEventListener("click", (event) => {
  const target = event.target.closest("button");
  if (!target) return;

  const viewId = target.dataset.viewId;
  if (viewId) return selectDevice(viewId);

  const page = target.dataset.page;
  if (page) {
    currentPage = Number(page);
    return renderTable();
  }

  const detailTab = target.dataset.detailTab;
  if (detailTab) {
    activeDetailTab = detailTab;
    return renderDetail();
  }

  const testId = target.dataset.testId;
  if (testId) return writeDevice(testId, { WARNING: 1, RESPONSE: 0 }, "Gửi lệnh test cảnh báo");

  const resetId = target.dataset.resetId;
  if (resetId && confirm(`Reset thiết bị ${resetId}?`)) return writeDevice(resetId, { RST: 1, RESPONSE: 0 }, "Gửi lệnh reset");

  const buzzId = target.dataset.buzzId;
  if (buzzId) return writeDevice(buzzId, { ENABLEBUZZ: buzzerOn(devices[buzzId]) ? 0 : 1, RESPONSE: 0 }, "Đổi trạng thái còi");

  if (target.dataset.saveField && selectedId) return saveConfig(selectedId);
  if (target.id === "saveAllCfg" && selectedId) return saveConfig(selectedId);

  if (target.classList.contains("nav")) {
    document.querySelectorAll(".nav").forEach((nav) => nav.classList.remove("active"));
    target.classList.add("active");
    document.querySelectorAll(".page").forEach((pageEl) => pageEl.classList.remove("active"));
    $(`view-${target.dataset.view}`).classList.add("active");
    document.querySelector(".sidebar").classList.remove("open");
  }
});
