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
    battery: {color: '#e34f4f', bin: 'đỏ'},
    biological: {color: '#28a66f', bin: 'xanh lá'},
    'brown-glass': {color: '#8a6846', bin: 'nâu'},
    cardboard: {color: '#e0a52f', bin: 'vàng'},
    clothes: {color: '#6d79cc', bin: 'xanh dương'},
    'green-glass': {color: '#28a66f', bin: 'xanh lá'},
    metal: {color: '#e0a52f', bin: 'vàng'},
    paper: {color: '#4591d1', bin: 'xanh dương'},
    plastic: {color: '#e0a52f', bin: 'vàng'},
    shoes: {color: '#6d79cc', bin: 'xanh dương'},
    trash: {color: '#555f5a', bin: 'xám'},
    'white-glass': {color: '#28a66f', bin: 'xanh lá'}
};
const state = {
    stream: null,
    timer: null,
    busy: false,
    categories: {...FALLBACK},
    recent: [],
    lastSaved: {label: null, at: 0},
    history: [],
    charts: []
}, $ = id => document.getElementById(id), userId = Number(document.body.dataset.userId || 1);
let vietnameseVoice = null;

function loadVietnameseVoice() {
    if (!('speechSynthesis' in window)) return;
    const voices = speechSynthesis.getVoices();
    vietnameseVoice = voices.find(v => v.lang.toLowerCase() === 'vi-vn') || voices.find(v => v.lang.toLowerCase().startsWith('vi')) || null
}

async function speakGuidance(label) {
    if (!$('soundEnabled').checked) return;
    const recordedAudio = new Audio(`/static/audio/${encodeURIComponent(label)}.mp3`);
    try {
        await recordedAudio.play();
        return;
    } catch (error) {
        console.warn('Không phát được file tiếng Việt, thử giọng hệ thống.', error);
    }
    if (!('speechSynthesis' in window)) {
        notice('Thiết bị không hỗ trợ phát giọng nói tiếng Việt.');
        return;
    }
    const wasteName = (LABELS[label] || label).toLocaleLowerCase('vi-VN'),
        binColor = state.categories[label]?.bin || 'phù hợp',
        utterance = new SpeechSynthesisUtterance(`Kết quả nhận diện là ${wasteName}. Vui lòng bỏ vào thùng màu ${binColor}.`);
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

async function toggleCamera() {
    if (state.stream) {
        stopCamera();
        return
    }
    try {
        state.stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: 'environment',
                width: {ideal: 1280}
            }, audio: false
        });
        $('camera').srcObject = state.stream;
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
    $('resultName').textContent = LABELS[r.label] || r.label;
    $('confidenceText').textContent = pct(r.confidence);
    $('confidenceBar').style.width = `${Math.min(r.confidence * 100, 100)}%`;
    if (r.accepted) {
        const g = state.categories[r.label] || {};
        $('binSwatch').style.background = g.color || '#e5f4ec';
        $('binText').textContent = `Bỏ vào thùng màu ${g.bin || 'phù hợp'}`
    } else $('binText').textContent = 'Hãy đưa vật lại gần và giữ ổn định'
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
    const rows = state.history.map(norm);
    $('historyBody').innerHTML = rows.length ? rows.slice(0, 50).map(r => `<tr><td>${LABELS[r.label] || r.label}</td><td>${pct(r.confidence > 1 ? r.confidence / 100 : r.confidence)}</td><td>${r.time ? new Date(r.time).toLocaleString('vi-VN') : '—'}</td></tr>`).join('') : '<tr><td colspan="3" class="empty">Chưa có dữ liệu</td></tr>'
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
window.addEventListener('beforeunload', stopCamera);
if ('speechSynthesis' in window) {
    loadVietnameseVoice();
    speechSynthesis.onvoiceschanged = loadVietnameseVoice
}
loadCategories();
loadHistory();
