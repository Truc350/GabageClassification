const LABELS = {
    battery: 'Pin',
    biological: 'Rác hữu cơ',
    'brown-glass': 'Thủy tinh nâu',
    cardboard: 'Bìa carton',
    clothes: 'Quần áo',
    'green-glass': 'Thủy tinh xanh',
    metal: 'Kim loại',
    paper: 'Giấy',
    plastic: 'Nhựa',
    shoes: 'Giày dép',
    trash: 'Rác khác',
    'white-glass': 'Thủy tinh trắng',
    unknown: 'Không xác định'
};
const FALLBACK = {
    battery: {color: '#7c3aed', bin: 'xám'},
    biological: {color: '#22c55e', bin: 'xanh lá'},
    'brown-glass': {color: '#92400e', bin: 'xanh dương'},
    cardboard: {color: '#d97706', bin: 'xanh dương'},
    clothes: {color: '#ec4899', bin: 'xanh dương'},
    'green-glass': {color: '#059669', bin: 'xanh dương'},
    metal: {color: '#64748b', bin: 'xanh dương'},
    paper: {color: '#3b82f6', bin: 'xanh dương'},
    plastic: {color: '#f59e0b', bin: 'xanh dương'},
    shoes: {color: '#8b5cf6', bin: 'xanh dương'},
    trash: {color: '#374151', bin: 'xám'},
    'white-glass': {color: '#06b6d4', bin: 'xanh dương'}
};
const state = {
    stream: null,
    timer: null,
    busy: false,
    categories: {...FALLBACK},
    recent: [],
    lastSaved: {label: null, at: 0},
    history: [],
    historyPage: 1,
    historyPageSize: 10,
    charts: []
}, $ = id => document.getElementById(id), userId = Number(document.body.dataset.userId || 1);
let vietnameseVoice = null;
const CAMPUS_CENTER = [10.87236, 106.78984];
const BIN_COLORS = {'Xanh lá': '#22c55e', 'Xanh dương': '#3b82f6', 'Xám': '#64748b'};
let campusMap = null, binMarkers = [], binLocations = [], selectedBinFilter = 'all', lastAcceptedLabel = null;

function loadVietnameseVoice() {
    if (!('speechSynthesis' in window)) return;
    const voices = speechSynthesis.getVoices();
    vietnameseVoice = voices.find(v => v.lang.toLowerCase() === 'vi-vn') || voices.find(v => v.lang.toLowerCase().startsWith('vi')) || null
}

const guidanceText = label => label === 'battery'
    ? 'Kết quả nhận diện là pin. Vui lòng đưa đến điểm thu gom pin hoặc chất thải nguy hại, không bỏ chung với rác sinh hoạt.'
    : `Kết quả nhận diện là ${(LABELS[label] || label).toLocaleLowerCase('vi-VN')}. Vui lòng bỏ vào thùng màu ${state.categories[label]?.bin || 'phù hợp'}.`;

async function speakGuidance(label) {
    if (!$('soundEnabled').checked) return;
    // Chỉ dùng các bản thu vẫn đúng với sơ đồ ba thùng mới.
    const recordingsStillCurrent = new Set(['biological', 'clothes', 'paper', 'shoes', 'trash']);
    if (recordingsStillCurrent.has(label)) {
        const recordedAudio = new Audio(`/static/audio/${encodeURIComponent(label)}.mp3`);
        try {
            await recordedAudio.play();
            return;
        } catch (error) {
            console.warn('Không phát được file tiếng Việt, thử giọng hệ thống.', error);
        }
    }
    if (!('speechSynthesis' in window)) {
        notice('Thiết bị không hỗ trợ phát giọng nói tiếng Việt.');
        return;
    }
    const utterance = new SpeechSynthesisUtterance(guidanceText(label));
    loadVietnameseVoice();
    if (!vietnameseVoice) {
        notice('Thiết bị không có giọng đọc tiếng Việt.');
        return;
    }
    utterance.lang = 'vi-VN';
    utterance.rate = .92;
    utterance.pitch = 1;
    if (vietnameseVoice) utterance.voice = vietnameseVoice;
    speechSynthesis.cancel();
    speechSynthesis.speak(utterance)
}

async function getJson(url, options = {}) {
    const r = await fetch(url, {headers: {'Content-Type': 'application/json'}, ...options}),
        d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    return d
}

function notice(x = '') {
    $('notice').textContent = x
}

const pct = x => `${(Number(x) * 100).toFixed(1)}%`;

async function loadCategories() {
    try {
        const raw = await getJson('/bridge/categories'),
            rows = Array.isArray(raw) ? raw : (raw.data || raw.categories || []);
        rows.forEach(r => {
            const l = r.category_label || r.label || r.ten_loai;
            state.categories[l] = {
                color: r.color_hex || r.mau_hex || FALLBACK[l]?.color || '#16835b',
                bin: r.bin_color || r.mau_thung || 'phù hợp'
            }
        })
    } catch (e) {
        notice('API danh mục chưa sẵn sàng — đang dùng màu mặc định.')
    }
}

function markerIcon(binType) {
    const color = BIN_COLORS[binType] || '#64748b';
    return L.divIcon({className: '', html: `<i class="bin-map-marker" style="width:22px;height:22px;background:${color}"></i>`, iconSize: [22, 22], iconAnchor: [11, 11]})
}

const locationBins = item => item.loai_thung_list?.length ? item.loai_thung_list : [item.loai_thung];
const normalizedBin = value => ({'xanh lá': 'Xanh lá', 'xanh dương': 'Xanh dương', 'xám': 'Xám'}[String(value || '').toLowerCase()] || value);

function popupContent(item) {
    const bins = locationBins(item).map(escapeMapText).join(', ');
    const updated = item.updated_at ? new Date(`${item.updated_at.replace(' ', 'T')}Z`).toLocaleString('vi-VN') : 'Chưa có';
    const directions = `https://www.google.com/maps/dir/?api=1&destination=${item.latitude},${item.longitude}`;
    return `<strong>${escapeMapText(item.ten_vi_tri)}</strong><br>${bins} · ${escapeMapText(item.trang_thai)}${item.mo_ta ? `<br>${escapeMapText(item.mo_ta)}` : ''}<br><small>Cập nhật: ${updated}</small><div class="popup-actions"><a href="${directions}" target="_blank" rel="noopener">Chỉ đường</a><button type="button" data-report-location="${item.id}">Báo sự cố</button></div>`
}

function renderBinMarkers() {
    if (!campusMap) return;
    binMarkers.forEach(marker => marker.remove());
    const status = $('mapStatusFilter').value;
    const visible = binLocations.filter(item => (selectedBinFilter === 'all' || locationBins(item).includes(selectedBinFilter)) && (status === 'all' || item.trang_thai === status));
    binMarkers = visible.map(item => {
        const marker = L.marker([item.latitude, item.longitude], {icon: markerIcon(locationBins(item)[0])}).bindPopup(popupContent(item)).addTo(campusMap);
        marker.locationId = item.id;
        return marker
    });
    $('mapLocationCount').textContent = `${visible.length}/${binLocations.length} vị trí`;
    $('mapEmpty').hidden = visible.length > 0;
}

async function loadBinMap() {
    if (typeof L === 'undefined') return;
    if (!campusMap) {
        campusMap = L.map('campusMap').setView(CAMPUS_CENTER, 16);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 20,
            attribution: '&copy; OpenStreetMap contributors'
        }).addTo(campusMap)
    }
    try {
        binLocations = await getJson('/api/bin-locations');
        renderBinMarkers();
        const requestedId = Number(new URLSearchParams(location.search).get('bin'));
        const requested = requestedId && binLocations.find(item => item.id === requestedId);
        if (requested) {
            activateSection('campus-map-section');
            campusMap.setView([requested.latitude, requested.longitude], 18);
            binMarkers.find(marker => marker.locationId === requestedId)?.openPopup();
            $('campusMap').scrollIntoView({behavior: 'smooth', block: 'center'})
        }
    } catch (error) {
        $('mapEmpty').hidden = false;
        $('mapEmpty').textContent = `Không tải được bản đồ thùng rác: ${error.message}`
    }
}

function distanceKm(a, b) {
    const rad = value => value * Math.PI / 180, earth = 6371;
    const dLat = rad(b[0] - a[0]), dLng = rad(b[1] - a[1]);
    const value = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
    return earth * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value))
}

function findNearest(binType = selectedBinFilter) {
    if (!navigator.geolocation) return notice('Thiết bị không hỗ trợ định vị.');
    navigator.geolocation.getCurrentPosition(position => {
        const origin = [position.coords.latitude, position.coords.longitude];
        const candidates = binLocations.filter(item => item.trang_thai === 'Hoạt động' && (binType === 'all' || locationBins(item).includes(binType)));
        if (!candidates.length) return notice('Chưa có thùng đang hoạt động phù hợp.');
        const nearest = candidates.map(item => ({item, distance: distanceKm(origin, [item.latitude, item.longitude])})).sort((a, b) => a.distance - b.distance)[0];
        const directions = `https://www.google.com/maps/dir/?api=1&origin=${origin[0]},${origin[1]}&destination=${nearest.item.latitude},${nearest.item.longitude}`;
        $('nearestResult').hidden = false;
        $('nearestResult').innerHTML = `Gần nhất: <strong>${escapeMapText(nearest.item.ten_vi_tri)}</strong> · ${nearest.distance < 1 ? Math.round(nearest.distance * 1000) + ' m' : nearest.distance.toFixed(1) + ' km'}<a href="${directions}" target="_blank" rel="noopener">Chỉ đường</a>`;
        campusMap.setView([nearest.item.latitude, nearest.item.longitude], 18)
    }, error => notice(`Không lấy được vị trí: ${error.message}`), {enableHighAccuracy: true, timeout: 10000})
}

function suggestNearestForLabel(label) {
    const binType = normalizedBin(state.categories[label]?.bin);
    if (!BIN_COLORS[binType] || label === lastAcceptedLabel) return;
    lastAcceptedLabel = label;
    selectedBinFilter = binType;
    document.querySelectorAll('[data-bin-filter]').forEach(button => button.classList.toggle('active', button.dataset.binFilter === binType));
    renderBinMarkers();
    $('nearestResult').hidden = false;
    $('nearestResult').textContent = `Đã lọc các điểm có thùng ${binType.toLocaleLowerCase('vi-VN')}. Bấm “Tìm thùng gần nhất” để sử dụng vị trí của bạn.`
}

function escapeMapText(value) {
    const node = document.createElement('span');
    node.textContent = value ?? '';
    return node.innerHTML
}

async function toggleCamera() {
    if (state.stream) {
        stopCamera();
        return
    }
    try {
        state.stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: 'user',
                width: {ideal: 1280}
            }, audio: false
        });
        $('camera').srcObject = state.stream;
        const activeTrack = state.stream.getVideoTracks()[0];
        const facingMode = activeTrack?.getSettings?.().facingMode;
        $('camera').classList.toggle('mirrored', facingMode !== 'environment');
        $('cameraMessage').hidden = true;
        $('toggleCamera').textContent = 'Tắt camera';
        $('statusDot').classList.add('online');
        $('systemStatus').textContent = 'Đang nhận diện';
        state.timer = setInterval(capture, 800)
    } catch (e) {
        notice(`Không mở được camera: ${e.message}`)
    }
}

function stopCamera() {
    clearInterval(state.timer);
    state.stream?.getTracks().forEach(t => t.stop());
    state.stream = null;
    $('cameraMessage').hidden = false;
    $('toggleCamera').textContent = 'Bật camera';
    $('statusDot').classList.remove('online');
    $('systemStatus').textContent = 'Đã dừng'
}

async function capture() {
    if (state.busy || !state.stream || $('camera').readyState < 2) return;
    state.busy = true;
    const c = $('captureCanvas'), v = $('camera'), s = Math.min(v.videoWidth, v.videoHeight);
    c.width = c.height = 224;
    c.getContext('2d').drawImage(v, (v.videoWidth - s) / 2, (v.videoHeight - s) / 2, s, s, 0, 0, 224, 224);
    try {
        const r = await getJson('/api/detect', {
            method: 'POST',
            body: JSON.stringify({image: c.toDataURL('image/jpeg', .8)})
        });
        show(r);
        stabilize(r)
    } catch (e) {
        notice(e.message)
    } finally {
        state.busy = false
    }
}

function show(r) {
    const displayLabel = r.accepted ? r.label : (r.raw_label || 'unknown');
    $('resultName').textContent = r.accepted
        ? (LABELS[displayLabel] || displayLabel)
        : `Có thể là ${LABELS[displayLabel] || displayLabel}`;
    $('resultConfidence').textContent = pct(r.confidence);
    $('confidenceBar').style.width = `${Math.max(0, Math.min(100, Number(r.confidence) * 100))}%`;
    $('confidenceBar').style.background = r.accepted ? '#16835b' : '#e0a528';
    if (r.accepted) {
        const g = state.categories[r.label] || {};
        $('binSwatch').style.background = g.color || '#e5f4ec';
        $('binText').textContent = r.label === 'battery'
            ? 'Đưa đến điểm thu gom pin/chất thải nguy hại'
            : `Bỏ vào thùng màu ${g.bin || 'phù hợp'}`
        if (r.label !== 'battery') suggestNearestForLabel(r.label)
    } else {
        $('binSwatch').style.background = '#e7eee9';
        $('binText').textContent = 'Chưa đủ tin cậy — đưa một vật lại gần, vào giữa khung và giữ ổn định'
    }
}

function stabilize(r) {
    if (!r.accepted) {
        state.recent = [];
        return
    }
    state.recent.push(r.label);
    state.recent = state.recent.slice(-3);
    if (state.recent.length === 3 && state.recent.every(x => x === r.label) && !(state.lastSaved.label === r.label && Date.now() - state.lastSaved.at < 5000)) {
        state.lastSaved = {label: r.label, at: Date.now()};
        save(r)
    }
}

async function save(r) {
    const data = {
        user_id: userId,
        category_label: r.label,
        confidence: r.confidence,
        timestamp: new Date().toISOString()
    };
    speakGuidance(r.label);
    try {
        await getJson('/bridge/history', {method: 'POST', body: JSON.stringify(data)});
        notice('Đã lưu kết quả nhận diện.');
        loadHistory()
    } catch (e) {
        notice(`Nhận diện thành công nhưng chưa lưu được: ${e.message}`)
    }
}

const norm = r => ({
    label: r.category_label || r.label || r.ten_loai || 'unknown',
    confidence: Number(r.confidence ?? r.confidence_score ?? 0),
    time: r.timestamp || r.thoi_gian || r.created_at
});

async function loadHistory() {
    try {
        const raw = await getJson(`/bridge/history?user_id=${userId}`);
        state.history = Array.isArray(raw) ? raw : (raw.data || raw.history || []);
        renderHistory();
        renderCharts()
    } catch (e) {
        if (!state.history.length) $('historyBody').innerHTML = '<tr><td colspan="3" class="empty">API lịch sử chưa sẵn sàng</td></tr>'
    }
}

function renderHistory() {
    const selectedDate = $('historyDate').value;
    const rows = state.history.map(norm).filter(r => {
        if (!selectedDate) return true;
        if (!r.time) return false;
        const date = new Date(r.time);
        if (Number.isNaN(date.getTime())) return false;
        const localDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        return localDate === selectedDate
    });
    const totalPages = Math.max(1, Math.ceil(rows.length / state.historyPageSize));
    state.historyPage = Math.min(Math.max(1, state.historyPage), totalPages);
    const start = (state.historyPage - 1) * state.historyPageSize;
    const pageRows = rows.slice(start, start + state.historyPageSize);
    const emptyMessage = selectedDate ? 'Không có dữ liệu trong ngày đã chọn' : 'Chưa có dữ liệu';
    $('historyBody').innerHTML = pageRows.length ? pageRows.map(r => `<tr><td>${LABELS[r.label] || r.label}</td><td>${pct(r.confidence > 1 ? r.confidence / 100 : r.confidence)}</td><td>${r.time ? new Date(r.time).toLocaleString('vi-VN') : '—'}</td></tr>`).join('') : `<tr><td colspan="3" class="empty">${emptyMessage}</td></tr>`;
    $('historyPageInfo').textContent = `Trang ${state.historyPage} / ${totalPages} · ${rows.length} kết quả`;
    $('historyPrev').disabled = state.historyPage === 1;
    $('historyNext').disabled = state.historyPage === totalPages
}

function renderCharts() {
    if (typeof Chart === 'undefined') return;
    state.charts.forEach(c => c.destroy());
    const rows = state.history.map(norm), counts = {};
    rows.forEach(r => counts[r.label] = (counts[r.label] || 0) + 1);
    const days = [...Array(7)].map((_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - 6 + i);
        return d.toISOString().slice(0, 10)
    }), daily = Object.fromEntries(days.map(d => [d, 0]));
    rows.forEach(r => {
        const d = r.time && new Date(r.time).toISOString().slice(0, 10);
        if (d in daily) daily[d]++
    });
    state.charts = [new Chart($('categoryChart'), {
        type: 'doughnut',
        data: {
            labels: Object.keys(counts).map(x => LABELS[x] || x),
            datasets: [{
                data: Object.values(counts),
                backgroundColor: ['#16835b', '#e0a52f', '#4591d1', '#e36d5c', '#6d79cc', '#8a6846']
            }]
        },
        options: {maintainAspectRatio: false, plugins: {legend: {position: 'bottom'}}}
    }), new Chart($('dailyChart'), {
        type: 'bar',
        data: {
            labels: days.map(d => new Date(`${d}T00:00:00`).toLocaleDateString('vi-VN', {
                day: '2-digit',
                month: '2-digit'
            })), datasets: [{data: Object.values(daily), backgroundColor: '#35a979', borderRadius: 7}]
        },
        options: {
            maintainAspectRatio: false,
            scales: {y: {beginAtZero: true, ticks: {precision: 0}}},
            plugins: {legend: {display: false}}
        }
    })]
}

$('toggleCamera').addEventListener('click', toggleCamera);
$('refreshHistory').addEventListener('click', loadHistory);
$('historyDate').addEventListener('change', () => {
    state.historyPage = 1;
    renderHistory()
});
$('clearHistoryDate').addEventListener('click', () => {
    $('historyDate').value = '';
    state.historyPage = 1;
    renderHistory()
});
$('historyPrev').addEventListener('click', () => {
    state.historyPage--;
    renderHistory()
});
$('historyNext').addEventListener('click', () => {
    state.historyPage++;
    renderHistory()
});
document.querySelectorAll('[data-bin-filter]').forEach(button => button.addEventListener('click', () => {
    selectedBinFilter = button.dataset.binFilter;
    document.querySelectorAll('[data-bin-filter]').forEach(item => item.classList.toggle('active', item === button));
    renderBinMarkers()
}));
$('mapStatusFilter').addEventListener('change', renderBinMarkers);
$('findNearest').addEventListener('click', () => findNearest());
$('campusMap').addEventListener('click', event => {
    const button = event.target.closest('[data-report-location]');
    if (!button) return;
    const location = binLocations.find(item => item.id === Number(button.dataset.reportLocation));
    if (!location) return;
    $('reportLocationId').value = location.id;
    $('reportLocationName').textContent = location.ten_vi_tri;
    $('reportDialog').showModal()
});
$('cancelReport').addEventListener('click', () => $('reportDialog').close());
$('reportForm').addEventListener('submit', async event => {
    event.preventDefault();
    try {
        await getJson('/api/bin-reports', {method: 'POST', body: JSON.stringify({location_id: Number($('reportLocationId').value), report_type: $('reportType').value, note: $('reportNote').value.trim()})});
        $('reportDialog').close();
        $('reportNote').value = '';
        notice('Đã gửi báo cáo đến quản trị viên.')
    } catch (error) { notice(error.message) }
});
function closeSidebar() {
    document.body.classList.remove('sidebar-open');
    $('sidebarToggle').setAttribute('aria-expanded', 'false')
}

const VALID_SECTIONS = new Set(['recognition', 'campus-map-section', 'statistics']);

function activateSection(sectionId, updateHistory = true) {
    const targetId = VALID_SECTIONS.has(sectionId) ? sectionId : 'recognition';
    document.querySelectorAll('.app-section').forEach(section => section.classList.toggle('active', section.id === targetId));
    document.querySelectorAll('.sidebar-link').forEach(link => {
        const active = link.dataset.section === targetId;
        link.classList.toggle('active', active);
        link.setAttribute('aria-current', active ? 'page' : 'false')
    });
    if (updateHistory && location.hash !== `#${targetId}`) history.pushState(null, '', `#${targetId}`);
    if (targetId === 'campus-map-section') setTimeout(() => campusMap?.invalidateSize(), 50);
    if (targetId === 'statistics') setTimeout(() => state.charts.forEach(chart => chart.resize()), 50);
    closeSidebar()
}

$('sidebarToggle').addEventListener('click', () => {
    const open = document.body.classList.toggle('sidebar-open');
    $('sidebarToggle').setAttribute('aria-expanded', String(open))
});
$('sidebarBackdrop').addEventListener('click', closeSidebar);
document.querySelectorAll('.sidebar-link').forEach(link => link.addEventListener('click', event => {
    event.preventDefault();
    activateSection(link.dataset.section)
}));
document.querySelector('.sidebar-brand').addEventListener('click', event => {
    event.preventDefault();
    activateSection('recognition')
});
window.addEventListener('popstate', () => activateSection(location.hash.slice(1), false));
window.addEventListener('beforeunload', stopCamera);
if ('speechSynthesis' in window) {
    loadVietnameseVoice();
    speechSynthesis.onvoiceschanged = loadVietnameseVoice
}
loadCategories();
loadHistory();
loadBinMap();
activateSection(location.hash.slice(1), false);
