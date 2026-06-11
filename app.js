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
let map;
let mapMarkers = {};

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

function parseDeviceUpdateTime(value) {
  if (!value) return null;
  if (typeof value === "number") return new Date(value);
  const raw = String(value).trim();
  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) return direct;

  const match = raw.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!match) return null;
  const [, hh, mm, ss = "0", dd, month, yyyy] = match;
  return new Date(Number(yyyy), Number(month) - 1, Number(dd), Number(hh), Number(mm), Number(ss));
}

function getStaleDevices(entries) {
  const now = Date.now();
  const staleMs = 10 * 60 * 1000;
  return entries
    .map(([id, d]) => ({ id, d, updated: parseDeviceUpdateTime(d.LAST_UPDATE || d.lastSeen) }))
    .filter((item) => !item.updated || now - item.updated.getTime() > staleMs)
    .sort((a, b) => (a.updated?.getTime() || 0) - (b.updated?.getTime() || 0))
    .slice(0, 6);
}

function renderDashboardHealth(entries) {
  const total = entries.length;
  const online = entries.filter(([, d]) => isOnline(d)).length;
  const alert = entries.filter(([, d]) => hasAlert(d)).length;
  const stale = getStaleDevices(entries).length;
  const score = total ? Math.max(0, Math.round(100 - ((total - online) / total) * 35 - (alert / total) * 45 - (stale / total) * 20)) : 0;
  const label = score >= 90 ? "Tốt" : score >= 70 ? "Cần chú ý" : score > 0 ? "Nguy hiểm" : "Chưa có dữ liệu";
  const gauge = $("dashboardHealthGauge");
  if (!gauge) return;
  $("dashboardHealthScore").textContent = total ? `${score}%` : "0%";
  $("dashboardHealthLabel").textContent = label;
  $("dashboardHealthDetail").textContent = total ? `${online}/${total} online, ${alert} cảnh báo, ${stale} chưa cập nhật lâu.` : "Chưa có thiết bị để đánh giá.";
  gauge.style.background = `conic-gradient(${score >= 90 ? "var(--green)" : score >= 70 ? "var(--orange)" : "var(--red)"} 0deg ${score * 3.6}deg,#e5eef8 ${score * 3.6}deg 360deg)`;
}

function renderPhaseMatrix(entries) {
  const grid = $("phaseMatrix");
  if (!grid) return;
  grid.innerHTML = entries.length ? entries.slice(0, 40).map(([id, d]) => {
    const l1 = phaseOk(d, "LINE1");
    const l2 = phaseOk(d, "LINE2");
    const l3 = phaseOk(d, "LINE3");
    return `<button class="phase-tile ${hasAlert(d) ? "has-alert" : ""}" data-view-id="${esc(id)}" title="${esc(id)} - ${esc(d.VITRI || "")}">
      <b>${esc(id)}</b>
      <span><i class="${l1 ? "" : "bad"}"></i>L1</span>
      <span><i class="${l2 ? "" : "bad"}"></i>L2</span>
      <span><i class="${l3 ? "" : "bad"}"></i>L3</span>
    </button>`;
  }).join("") : '<div class="list-empty">Chưa có thiết bị để hiển thị ma trận</div>';
}

function renderStaleDevices(entries) {
  const box = $("staleDeviceList");
  if (!box) return;
  const stale = getStaleDevices(entries);
  box.innerHTML = stale.length ? stale.map(({ id, d, updated }) => `<div class="compact-item">
    <b>${esc(id)} - ${esc(d.VITRI || "")}</b>
    <small>${updated ? `Cập nhật cuối: ${esc(d.LAST_UPDATE || d.lastSeen)}` : "Chưa có thời gian cập nhật"}</small>
  </div>`).join("") : '<div class="list-empty">Không có thiết bị quá hạn cập nhật</div>';
}

function alertLogEntries() {
  return allLogs().filter((log) => /cảnh báo|test|đứt|mất nguồn|offline|Firebase cập nhật/i.test(String(log.text || "")));
}

function renderAlertTrend() {
  const chart = $("alertTrendChart");
  if (!chart) return;
  const now = Date.now();
  const buckets = Array.from({ length: 24 }, (_, idx) => ({
    hour: new Date(now - (23 - idx) * 60 * 60 * 1000).getHours(),
    count: 0
  }));
  alertLogEntries().forEach((log) => {
    const ts = Number(log.ts || 0);
    if (!ts || now - ts > 24 * 60 * 60 * 1000) return;
    const diff = Math.floor((now - ts) / (60 * 60 * 1000));
    const index = 23 - diff;
    if (buckets[index]) buckets[index].count += 1;
  });
  const max = Math.max(1, ...buckets.map((item) => item.count));
  chart.innerHTML = buckets.map((item) => `<div class="trend-bar" title="${item.hour}h: ${item.count} cảnh báo"><span style="height:${Math.max(6, item.count / max * 100)}%"></span><small>${item.hour}</small></div>`).join("");
}

function renderPriorityAlerts(entries) {
  const box = $("priorityAlertList");
  if (!box) return;
  const priorities = [];
  entries.forEach(([id, d]) => {
    if (!powerOk(d)) priorities.push({ level: "critical", id, text: "Mất nguồn LOOP", d });
    ["LINE1", "LINE2", "LINE3"].forEach((line) => {
      if (!phaseOk(d, line)) priorities.push({ level: "high", id, text: `${line.replace("LINE", "L")}: Đứt dây`, d });
    });
    if (!isOnline(d)) priorities.push({ level: "medium", id, text: "Thiết bị offline", d });
    if (!isOk(d.RESPONSE)) priorities.push({ level: "low", id, text: "Chờ phản hồi lệnh", d });
  });
  const rank = { critical: 0, high: 1, medium: 2, low: 3 };
  priorities.sort((a, b) => rank[a.level] - rank[b.level]);
  box.innerHTML = priorities.slice(0, 10).map((item) => `<button class="priority-item ${item.level}" data-view-id="${esc(item.id)}"><b>${esc(item.id)} - ${esc(item.text)}</b><small>${esc(item.d.VITRI || "")}</small></button>`).join("") || '<div class="list-empty">Không có cảnh báo ưu tiên</div>';
}

function renderTopAlertDevices(entries) {
  const box = $("topAlertDevices");
  if (!box) return;
  const counts = {};
  allLogs().forEach((log) => {
    const text = String(log.text || "");
    if (!/cảnh báo|test|reset|tọa độ|còi|Firebase cập nhật/i.test(text)) return;
    entries.forEach(([id]) => {
      if (text.includes(id)) counts[id] = (counts[id] || 0) + 1;
    });
  });
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const fallback = entries.filter(([, d]) => hasAlert(d)).slice(0, 5).map(([id]) => [id, 1]);
  const list = top.length ? top : fallback;
  box.innerHTML = list.length ? list.map(([id, count]) => {
    const d = devices[id] || {};
    return `<div class="compact-item">
      <b>${esc(id)} - ${esc(d.VITRI || "")}</b>
      <small>${count} lần ghi nhận • ${esc(fmtAlert(d))}</small>
    </div>`;
  }).join("") : '<div class="list-empty">Chưa có dữ liệu cảnh báo</div>';
}

function renderDashboardVisuals() {
  const entries = Object.entries(devices);
  renderDashboardHealth(entries);
  renderPhaseMatrix(entries);
  renderStaleDevices(entries);
  renderTopAlertDevices(entries);
  renderAlertTrend();
  renderPriorityAlerts(entries);
}

function renderDashboardStatusGrid() {
  const grid = $("dashboardStatusGrid");
  if (!grid) return;
  const entries = Object.entries(devices).slice(0, 12);
  grid.innerHTML = entries.length ? entries.map(([id, d]) => {
    const bad = hasAlert(d);
    return `<div class="status-card">
      <b>${esc(id)}</b>
      ${statusBadge(isOnline(d))}
      <small>${esc(d.VITRI || "--")}</small>
      <small class="${bad ? "bad-text" : ""}">${esc(fmtAlert(d))}</small>
    </div>`;
  }).join("") : '<div class="list-empty">Chưa có thiết bị để theo dõi</div>';
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
  renderDashboardStatusGrid();
  renderDashboardVisuals();
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
  renderMapDeviceSelect(entries);
  $("alertList").innerHTML = entries.filter(([, d]) => hasAlert(d)).map(([id, d]) => `<div class="alert-item"><b>${esc(id)} - ${esc(d.VITRI || "")}</b><small>${esc(fmtAlert(d))}</small></div>`).join("") || '<div class="list-empty">Không có cảnh báo</div>';

  const groups = entries.reduce((acc, [id, d]) => {
    const group = d.GROUP || "Chưa phân nhóm";
    (acc[group] ||= []).push(id);
    return acc;
  }, {});
  $("groupList").innerHTML = Object.entries(groups).map(([group, ids]) => `<p><b>${esc(group)}</b>: ${ids.map(esc).join(", ")}</p>`).join("") || '<div class="list-empty">Chưa có thiết bị</div>';

  $("mapList").innerHTML = entries.map(([id, d]) => {
    const hasLocation = hasValidLocation(d);
    const link = hasLocation ? ` <a target="_blank" href="https://www.google.com/maps?q=${encodeURIComponent(`${d.LAT},${d.LNG}`)}">Mở Google Maps</a>` : "";
    const action = hasLocation ? `<button class="action-btn" data-focus-map-id="${esc(id)}">Đến ghim</button>` : "";
    return `<div class="alert-item"><b>${esc(id)} - ${esc(d.VITRI || "")}</b><small>LAT: ${esc(d.LAT || "chưa có")}, LNG: ${esc(d.LNG || "chưa có")}${link}</small>${action}</div>`;
  }).join("") || "Chưa có thiết bị";
  renderDeviceMap(entries);
}

function hasValidLocation(d) {
  return Number.isFinite(Number(d?.LAT)) && Number.isFinite(Number(d?.LNG));
}

function renderMapDeviceSelect(entries = Object.entries(devices)) {
  const select = $("mapDeviceSelect");
  if (!select) return;
  const current = select.value;
  select.innerHTML = '<option value="">Chọn thiết bị</option>' + entries
    .map(([id, d]) => `<option value="${esc(id)}">${esc(id)} - ${esc(d.VITRI || "chưa có vị trí")}</option>`)
    .join("");
  select.value = devices[current] ? current : "";
}

function ensureMap() {
  if (!$("deviceMap") || !window.L) return null;
  if (map) return map;
  map = L.map("deviceMap").setView([16.047079, 108.20623], 5);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap"
  }).addTo(map);
  map.on("click", (event) => {
    $("mapLat").value = event.latlng.lat.toFixed(6);
    $("mapLng").value = event.latlng.lng.toFixed(6);
  });
  return map;
}

function renderDeviceMap(entries = Object.entries(devices)) {
  const currentMap = ensureMap();
  if (!currentMap) return;

  const activeIds = new Set();
  entries.forEach(([id, d]) => {
    if (!hasValidLocation(d)) return;
    activeIds.add(id);
    const latLng = [Number(d.LAT), Number(d.LNG)];
    const popup = `<b>${esc(id)}</b><br>${esc(d.VITRI || "")}<br>${statusBadge(isOnline(d))}<br>${esc(fmtAlert(d))}`;
    if (!mapMarkers[id]) {
      mapMarkers[id] = L.marker(latLng).addTo(currentMap);
    } else {
      mapMarkers[id].setLatLng(latLng);
    }
    mapMarkers[id].bindPopup(popup);
  });

  Object.entries(mapMarkers).forEach(([id, marker]) => {
    if (!activeIds.has(id)) {
      currentMap.removeLayer(marker);
      delete mapMarkers[id];
    }
  });

  setTimeout(() => currentMap.invalidateSize(), 50);
}

function fitMapToMarkers() {
  const markers = Object.values(mapMarkers);
  if (!map || !markers.length) return notify("Chưa có thiết bị nào có tọa độ", "error");
  map.fitBounds(L.featureGroup(markers).getBounds().pad(0.2));
}

function focusMapDevice(id) {
  const marker = mapMarkers[id];
  if (!map || !marker) return notify("Thiết bị chưa có tọa độ", "error");
  map.setView(marker.getLatLng(), 15);
  marker.openPopup();
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
  renderDashboardVisuals();
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

function activateView(viewName) {
  document.querySelectorAll(".nav").forEach((nav) => nav.classList.toggle("active", nav.dataset.view === viewName));
  document.querySelectorAll(".page").forEach((pageEl) => pageEl.classList.remove("active"));
  $(`view-${viewName}`).classList.add("active");
  document.querySelector(".sidebar").classList.remove("open");
  if (viewName === "map") setTimeout(() => renderDeviceMap(), 80);
}

function showDeviceModuleWithFilter(kind) {
  activateView("devices");
  if (kind === "alert") $("statusFilter").value = "alert";
  if (kind === "offline") $("statusFilter").value = "offline";
  if (kind === "power") {
    $("statusFilter").value = "all";
    $("powerFilter").value = "bad";
    $("advancedPanel").classList.remove("hidden");
  }
  if (kind === "stale") {
    $("statusFilter").value = "all";
    $("searchBox").value = "";
    $("advancedPanel").classList.add("hidden");
    const first = getStaleDevices(Object.entries(devices))[0];
    if (first) selectedId = first.id;
  }
  currentPage = 1;
  renderTable();
  renderDetail();
}

async function restoreBackupFromFile() {
  const input = $("restoreBackupFile");
  const file = input?.files?.[0];
  if (!file) return notify("Chọn file JSON cần khôi phục", "error");
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    return notify("File JSON không hợp lệ", "error");
  }
  const deviceData = data.Device || data.devices || data;
  const logsData = data.Logs || data.logs;
  if (!deviceData || typeof deviceData !== "object" || Array.isArray(deviceData)) return notify("Không tìm thấy dữ liệu Device hợp lệ", "error");
  if (!confirm("Khôi phục sẽ ghi đè dữ liệu /Device hiện tại. Tiếp tục?")) return;
  try {
    await set(ref(db, "Device"), deviceData);
    if (logsData && confirm("File có dữ liệu Logs. Khôi phục cả /Logs?")) await set(ref(db, "Logs"), logsData);
    await addLog("Khôi phục dữ liệu từ file backup");
    notify("Khôi phục dữ liệu thành công");
  } catch (err) {
    notify(`Lỗi khôi phục dữ liệu: ${err.message}`, "error");
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
$("restoreBackup").onclick = restoreBackupFromFile;
$("monitorModeBtn").onclick = () => document.body.classList.add("monitor-mode");
$("exitMonitorMode").onclick = () => document.body.classList.remove("monitor-mode");
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") document.body.classList.remove("monitor-mode");
});
document.querySelectorAll("[data-quick-filter]").forEach((btn) => btn.addEventListener("click", () => showDeviceModuleWithFilter(btn.dataset.quickFilter)));
$("fitMapMarkers").onclick = fitMapToMarkers;
$("mapDeviceSelect").addEventListener("change", () => {
  const id = $("mapDeviceSelect").value;
  const d = devices[id];
  $("mapLat").value = d?.LAT || "";
  $("mapLng").value = d?.LNG || "";
  if (id) focusMapDevice(id);
});
$("saveDeviceLocation").onclick = () => {
  const id = $("mapDeviceSelect").value;
  const lat = Number($("mapLat").value);
  const lng = Number($("mapLng").value);
  if (!id) return notify("Chọn thiết bị cần ghim vị trí", "error");
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return notify("Nhập LAT/LNG hợp lệ", "error");
  writeDevice(id, { LAT: lat, LNG: lng, RESPONSE: 0 }, "Cập nhật tọa độ bản đồ");
};
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

  const focusMapId = target.dataset.focusMapId;
  if (focusMapId) return focusMapDevice(focusMapId);

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
    activateView(target.dataset.view);
  }
});
