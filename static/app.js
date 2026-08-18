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
let activeQuizAnswers = {};
const QUIZ_BANK = [
    {question: 'Thức ăn thừa nên bỏ vào đâu?', options: [['green', 'Thùng xanh lá'], ['blue', 'Thùng xanh dương'], ['gray', 'Thùng xám']], answer: 'green'},
    {question: 'Pin đã qua sử dụng nên xử lý thế nào?', options: [['gray', 'Bỏ chung vào thùng xám'], ['hazard', 'Mang đến điểm thu gom pin hoặc chất thải nguy hại']], answer: 'hazard'},
    {question: 'Chai nhựa nên chuẩn bị thế nào trước khi thu gom?', options: [['clean', 'Làm sạch sơ bộ và để ráo'], ['full', 'Giữ nguyên chất lỏng bên trong']], answer: 'clean'},
    {question: 'Cách phù hợp để giảm rác từ đầu là gì?', options: [['reuse', 'Ưu tiên đồ dùng có thể sử dụng nhiều lần'], ['single', 'Dùng thêm đồ dùng một lần']], answer: 'reuse'},
    {question: 'Giấy và bìa carton thuộc nhóm thùng nào trong hệ thống?', options: [['green', 'Xanh lá'], ['blue', 'Xanh dương'], ['gray', 'Xám']], answer: 'blue'},
    {question: 'Rác hữu cơ quá ướt nên làm gì trước khi bỏ?', options: [['drain', 'Để ráo nước'], ['mix', 'Trộn với giấy sạch']], answer: 'drain'},
    {question: 'Quần áo còn sử dụng được nên ưu tiên cách nào?', options: [['share', 'Chia sẻ hoặc tái sử dụng'], ['trash', 'Bỏ ngay vào rác còn lại']], answer: 'share'},
    {question: 'Khi thấy thùng bị hư hỏng, bạn nên làm gì?', options: [['report', 'Quét QR và gửi báo cáo'], ['ignore', 'Bỏ qua sự cố']], answer: 'report'},
    {question: 'Thủy tinh trong hệ thống được thu gom theo nhóm nào?', options: [['blue', 'Xanh dương'], ['green', 'Xanh lá'], ['gray', 'Xám']], answer: 'blue'},
    {question: 'Có nên làm móp hoặc chọc thủng pin trước khi thu gom không?', options: [['no', 'Không'], ['yes', 'Có']], answer: 'no'},
    {question: 'Kim loại được hướng dẫn đến thùng nào?', options: [['blue', 'Xanh dương'], ['green', 'Xanh lá'], ['gray', 'Xám']], answer: 'blue'},
    {question: 'Nếu chưa chắc vị trí thùng phù hợp, nên làm gì?', options: [['map', 'Dùng bản đồ tìm điểm thu gom'], ['ground', 'Để rác cạnh đường']], answer: 'map'}
];

function shuffled(items) {
    return [...items].sort(() => Math.random() - .5)
}

async function renderQuiz() {
    try {
        const questions = await getJson(`/api/education/questions?user_id=${userId}`);
        activeQuizAnswers = {};
        $('quizQuestions').innerHTML = questions.map((item, index) => {
            const name = `q${index + 1}`;
            activeQuizAnswers[name] = item.key;
            return `<fieldset><legend>${index + 1}. ${escapeMapText(item.question)}</legend>${item.options.map(([value, label], optionIndex) => `<label><input type="radio" name="${name}" value="${escapeMapText(value)}"${optionIndex === 0 ? ' required' : ''}> ${escapeMapText(label)}</label>`).join('')}</fieldset>`
        }).join('')
    } catch (error) {
        $('quizQuestions').innerHTML = `<p class="empty">Không tải được câu hỏi: ${escapeMapText(error.message)}</p>`
    }
}

async function loadRewards() {
    try {
        const data = await getJson(`/api/rewards?user_id=${userId}`);
        $('greenPoints').textContent = `${data.balance} điểm`;
        $('rewardList').innerHTML = data.rewards.length ? data.rewards.map(item => `<article class="reward-card"><div><h3>${escapeMapText(item.name)}</h3><p>${escapeMapText(item.description || 'Phần quà đổi bằng điểm xanh')}</p></div><strong>${item.points_cost} điểm</strong><small>${item.stock == null ? 'Không giới hạn' : `Còn ${item.stock}`}</small><button class="primary" data-redeem-reward="${item.id}"${data.balance < item.points_cost || item.stock === 0 ? ' disabled' : ''}>Đổi quà</button></article>`).join('') : '<p class="empty">Quản trị viên chưa cấu hình phần quà.</p>';
        $('redemptionList').innerHTML = data.redemptions.length ? `<h3>Lượt đổi gần đây</h3>${data.redemptions.map(item => `<div><strong>${escapeMapText(item.name)}</strong><span>Mã ${escapeMapText(item.code)} · ${escapeMapText(item.status)}</span></div>`).join('')}` : ''
    } catch (error) { notice(`Không tải được điểm thưởng: ${error.message}`) }
}

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

function openReportDialog(location, reportType = '') {
    if (!location) return;
    $('reportLocationId').value = location.id;
    $('reportLocationName').textContent = location.ten_vi_tri;
    $('reportType').value = reportType || 'Đầy';
    $('reportDialog').showModal();
    $('reportNote').focus()
}

function openStationDialog(location) {
    if (!location) return;
    const pending = JSON.parse(localStorage.getItem('pendingDisposal') || 'null');
    const validPending = pending && pending.expiresAt > Date.now();
    $('stationDialog').dataset.locationId = location.id;
    $('stationLocationName').textContent = location.ten_vi_tri;
    $('stationRecognitionStatus').textContent = validPending
        ? `Rác vừa nhận diện: ${LABELS[pending.label] || pending.label}. Xác nhận sau khi đã bỏ đúng thùng.`
        : 'Bạn chưa có lượt nhận diện hợp lệ trong 10 phút gần đây.';
    $('confirmDisposal').disabled = !validPending;
    $('stationDialog').showModal()
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
        const query = new URLSearchParams(location.search);
        const reportLocationId = Number(query.get('report'));
        const stationLocationId = Number(query.get('station'));
        const requestedId = reportLocationId || stationLocationId || Number(query.get('bin'));
        const requested = requestedId && binLocations.find(item => item.id === requestedId);
        if (requested) {
            activateSection('campus-map-section');
            campusMap.setView([requested.latitude, requested.longitude], 18);
            binMarkers.find(marker => marker.locationId === requestedId)?.openPopup();
            if (reportLocationId) openReportDialog(requested, 'Hư hỏng');
            else if (stationLocationId) openStationDialog(requested);
            else $('campusMap').scrollIntoView({behavior: 'smooth', block: 'center'})
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
        const saved = await getJson('/bridge/history', {method: 'POST', body: JSON.stringify(data)});
        if (saved.id) localStorage.setItem('pendingDisposal', JSON.stringify({historyId: saved.id, label: r.label, expiresAt: Date.now() + 10 * 60 * 1000}));
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
    const rows = filterByStatisticsPeriod(state.history.map(norm));
    const totalPages = Math.max(1, Math.ceil(rows.length / state.historyPageSize));
    state.historyPage = Math.min(Math.max(1, state.historyPage), totalPages);
    const start = (state.historyPage - 1) * state.historyPageSize;
    const pageRows = rows.slice(start, start + state.historyPageSize);
    const emptyMessage = $('chartPeriod').value === 'all' ? 'Chưa có dữ liệu' : 'Không có dữ liệu trong khoảng thời gian đã chọn';
    $('historyBody').innerHTML = pageRows.length ? pageRows.map(r => `<tr><td>${LABELS[r.label] || r.label}</td><td>${pct(r.confidence > 1 ? r.confidence / 100 : r.confidence)}</td><td>${r.time ? new Date(r.time).toLocaleString('vi-VN') : '—'}</td></tr>`).join('') : `<tr><td colspan="3" class="empty">${emptyMessage}</td></tr>`;
    $('historyPageInfo').textContent = `Trang ${state.historyPage} / ${totalPages} · ${rows.length} kết quả`;
    $('historyPrev').disabled = state.historyPage === 1;
    $('historyNext').disabled = state.historyPage === totalPages
}

const localDateKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

function statisticsRange() {
    const period = $('chartPeriod').value;
    if (period === 'all') return {period, start: null, end: null};
    if (period === 'custom') {
        const start = $('statisticsFromDate').value ? new Date(`${$('statisticsFromDate').value}T00:00:00`) : null;
        const end = $('statisticsToDate').value ? new Date(`${$('statisticsToDate').value}T23:59:59.999`) : null;
        return {period, start, end}
    }
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    const start = new Date(end);
    start.setDate(start.getDate() - Number(period) + 1);
    start.setHours(0, 0, 0, 0);
    return {period, start, end}
}

function filterByStatisticsPeriod(rows) {
    const {start, end} = statisticsRange();
    return rows.filter(row => {
        if (!start && !end) return true;
        const time = row.time && new Date(row.time);
        return time && !Number.isNaN(time.getTime()) && (!start || time >= start) && (!end || time <= end)
    })
}

function dateSeries(start, end) {
    if (!start || !end || start > end) return [];
    const days = [], cursor = new Date(start);
    cursor.setHours(0, 0, 0, 0);
    while (cursor <= end) {
        days.push(localDateKey(cursor));
        cursor.setDate(cursor.getDate() + 1)
    }
    return days
}

function renderCharts() {
    if (typeof Chart === 'undefined') return;
    state.charts.forEach(c => c.destroy());
    Chart.defaults.font.family = 'Arial';
    const {period, start, end} = statisticsRange();
    const rows = filterByStatisticsPeriod(state.history.map(norm)), counts = {};
    rows.forEach(r => counts[r.label] = (counts[r.label] || 0) + 1);
    let days;
    if (period !== 'all' && start && end) days = dateSeries(start, end);
    else days = [...new Set(rows.map(row => row.time && new Date(row.time)).filter(date => date && !Number.isNaN(date.getTime())).map(localDateKey))].sort();
    const daily = Object.fromEntries(days.map(d => [d, 0]));
    rows.forEach(r => {
        const d = r.time && localDateKey(new Date(r.time));
        if (d in daily) daily[d]++
    });
    $('dailyChartPeriod').textContent = period === 'all' ? 'TẤT CẢ THỜI GIAN' : period === 'custom' ? 'KHOẢNG NGÀY ĐÃ CHỌN' : `${period} NGÀY GẦN NHẤT`;
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
function applyStatisticsFilter() {
    state.historyPage = 1;
    renderHistory();
    renderCharts()
}
$('chartPeriod').addEventListener('change', () => {
    $('customPeriodFields').hidden = $('chartPeriod').value !== 'custom';
    applyStatisticsFilter()
});
$('statisticsFromDate').addEventListener('change', applyStatisticsFilter);
$('statisticsToDate').addEventListener('change', applyStatisticsFilter);
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
    openReportDialog(location)
});
$('cancelReport').addEventListener('click', () => $('reportDialog').close());
$('reportForm').addEventListener('submit', async event => {
    event.preventDefault();
    try {
        const data = new FormData();
        data.append('location_id', $('reportLocationId').value);
        data.append('report_type', $('reportType').value);
        data.append('note', $('reportNote').value.trim());
        data.append('reporter_name', $('reporterName').value.trim());
        data.append('reporter_contact', $('reporterContact').value.trim());
        data.append('user_id', userId);
        if ($('reportImage').files[0]) data.append('image', $('reportImage').files[0]);
        const response = await fetch('/api/bin-reports', {method: 'POST', body: data});
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
        $('reportDialog').close();
        $('reportForm').reset();
        notice('Đã gửi báo cáo đến quản trị viên.')
    } catch (error) { notice(error.message) }
});
$('closeStationDialog').addEventListener('click', () => $('stationDialog').close());
$('stationReportDamage').addEventListener('click', () => {
    const location = binLocations.find(item => item.id === Number($('stationDialog').dataset.locationId));
    $('stationDialog').close();
    openReportDialog(location, 'Hư hỏng')
});
$('confirmDisposal').addEventListener('click', async () => {
    const pending = JSON.parse(localStorage.getItem('pendingDisposal') || 'null');
    if (!pending) return notice('Vui lòng nhận diện rác trước khi xác nhận.');
    try {
        const result = await getJson('/api/disposals/confirm', {method: 'POST', body: JSON.stringify({user_id: userId, history_id: pending.historyId, location_id: Number($('stationDialog').dataset.locationId)})});
        localStorage.removeItem('pendingDisposal');
        $('stationDialog').close();
        notice(`+1 điểm xanh · Đã bỏ ${result.waste_name} đúng thùng tại ${result.location_name}.`);
        loadRewards()
    } catch (error) { notice(error.message) }
});
$('educationQuizForm').addEventListener('submit', async event => {
    event.preventDefault();
    const formAnswers = new FormData(event.currentTarget), submitted = {};
    Object.entries(activeQuizAnswers).forEach(([name, key]) => submitted[key] = formAnswers.get(name));
    try {
        const result = await getJson('/api/education-quiz', {method: 'POST', body: JSON.stringify({user_id: userId, answers: submitted})});
        event.currentTarget.querySelectorAll('label').forEach(label => label.classList.remove('answer-correct', 'answer-wrong'));
        Object.entries(activeQuizAnswers).forEach(([name, key]) => {
            const correctAnswer = result.correct_answers[key];
            const inputs = [...event.currentTarget.querySelectorAll(`input[name="${name}"]`)];
            inputs.find(input => input.value === correctAnswer)?.closest('label')?.classList.add('answer-correct');
            const selected = inputs.find(input => input.checked);
            if (selected && selected.value !== correctAnswer) selected.closest('label').classList.add('answer-wrong')
        });
        $('quizScore').textContent = result.score === result.total ? `${result.score}/${result.total} · Chuyên gia xanh` : `${result.score}/${result.total} câu đúng`;
        $('quizScore').classList.toggle('perfect', result.score === result.total);
        event.currentTarget.classList.add('quiz-graded');
        $('quizScore').textContent += result.points_awarded ? ` · +${result.points_awarded} điểm` : ' · Hôm nay đã nhận điểm';
        loadRewards()
    }
    catch (error) { notice(`Đã chấm điểm nhưng chưa lưu được: ${error.message}`) }
});
$('rewardList').addEventListener('click', async event => {
    const rewardId = event.target.dataset.redeemReward;
    if (!rewardId || !confirm('Bạn muốn dùng điểm để đổi phần quà này?')) return;
    try {
        const result = await getJson(`/api/rewards/${rewardId}/redeem`, {method: 'POST', body: JSON.stringify({user_id: userId})});
        notice(`Đổi quà thành công. Mã nhận quà: ${result.code}`); loadRewards()
    } catch (error) { notice(error.message) }
});
$('assistantForm').addEventListener('submit', async event => {
    event.preventDefault();
    const question = $('assistantQuestion').value.trim();
    if (!question) return;
    $('assistantMessages').insertAdjacentHTML('beforeend', `<div class="assistant-message user">${escapeMapText(question)}</div>`);
    $('assistantQuestion').value = '';
    try {
        const result = await getJson('/api/assistant', {method: 'POST', body: JSON.stringify({question})});
        $('assistantMessages').insertAdjacentHTML('beforeend', `<div class="assistant-message bot">${escapeMapText(result.answer)}<small>Nguồn: ${escapeMapText(result.source)}</small></div>`)
    } catch (error) {
        $('assistantMessages').insertAdjacentHTML('beforeend', `<div class="assistant-message bot error">${escapeMapText(error.message)}</div>`)
    }
    $('assistantMessages').scrollTop = $('assistantMessages').scrollHeight
});
$('educationQuizForm').addEventListener('change', event => {
    if (!event.currentTarget.classList.contains('quiz-graded')) return;
    event.currentTarget.classList.remove('quiz-graded');
    event.currentTarget.querySelectorAll('label').forEach(label => label.classList.remove('answer-correct', 'answer-wrong'));
    $('quizScore').textContent = '';
    $('quizScore').classList.remove('perfect')
});
function closeSidebar() {
    document.body.classList.remove('sidebar-open');
    $('sidebarToggle').setAttribute('aria-expanded', 'false')
}

const VALID_SECTIONS = new Set(['recognition', 'campus-map-section', 'environmental-education', 'green-rewards', 'statistics']);

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
    if (targetId === 'green-rewards') loadRewards();
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
renderQuiz();
loadRewards();
activateSection(location.hash.slice(1), false);
