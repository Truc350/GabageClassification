const $ = id => document.getElementById(id);
let categories = [], locations = [], reports = [], charts = [], adminMap = null, locationMarkers = [], activeQrLocation = null;
const CAMPUS_CENTER = [10.87236, 106.78984];
const BIN_COLORS = {'Xanh lá': '#22c55e', 'Xanh dương': '#3b82f6', 'Xám': '#64748b'};

async function api(url, options = {}) {
    const response = await fetch(url, {headers: {'Content-Type': 'application/json'}, ...options});
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data
}

function message(text = '') {
    $('adminNotice').textContent = text
}

function escapeHtml(value) {
    const node = document.createElement('span');
    node.textContent = value ?? '';
    return node.innerHTML
}

async function load() {
    try {
        [categories, locations, reports] = await Promise.all([api('/api/categories'), api('/api/bin-locations'), api('/api/bin-reports'), loadStats()]);
        $('categoryCount').textContent = categories.length;
        renderCategories();
        renderLocations();
        renderReports()
    } catch (error) {
        message(error.message)
    }
}

async function loadStats() {
    const stats = await api('/api/stats');
    $('totalRecognitions').textContent = stats.total_recognitions;
    $('activeUsers').textContent = stats.active_users;
    const binCounts = Object.fromEntries((stats.by_bin || []).map(item => [item.bin_name, item.count]));
    $('greenBinCount').textContent = `${binCounts['Xanh lá'] || 0} lượt`;
    $('blueBinCount').textContent = `${binCounts['Xanh dương'] || 0} lượt`;
    $('grayBinCount').textContent = `${binCounts['Xám'] || 0} lượt`;
    charts.forEach(chart => chart.destroy());
    charts = [new Chart($('systemPie'), {
        type: 'doughnut',
        data: {labels: stats.by_category.map(x => x.ten_loai), datasets: [{data: stats.by_category.map(x => x.count), backgroundColor: stats.by_category.map(x => x.color_hex)}]},
        options: {maintainAspectRatio: false, plugins: {legend: {position: 'bottom'}}}
    }), new Chart($('systemBar'), {
        type: 'bar',
        data: {labels: stats.by_day.map(x => x.date), datasets: [{data: stats.by_day.map(x => x.count), backgroundColor: '#35a979', borderRadius: 7}]},
        options: {maintainAspectRatio: false, scales: {y: {beginAtZero: true, ticks: {precision: 0}}}, plugins: {legend: {display: false}}}
    })]
}

function renderCategories() {
    $('categoryBody').innerHTML = categories.map(item => `<tr><td><code>${escapeHtml(item.category_label)}</code></td><td>${escapeHtml(item.ten_loai)}</td><td><i class="category-dot" style="background:${escapeHtml(item.color_hex)}"></i><code>${escapeHtml(item.color_hex)}</code></td><td>${escapeHtml(item.mau_thung)}</td><td>${escapeHtml(item.mo_ta)}</td><td><div class="row-actions"><button class="secondary" data-edit="${item.id}">Sửa</button><button class="danger" data-delete="${item.id}">Xóa</button></div></td></tr>`).join('')
}

function locationIcon(binType) {
    return L.divIcon({className: '', html: `<i class="bin-map-marker" style="width:24px;height:24px;background:${BIN_COLORS[binType] || '#64748b'}"></i>`, iconSize: [24, 24], iconAnchor: [12, 12]})
}

function initLocationMap() {
    if (adminMap || typeof L === 'undefined') return;
    adminMap = L.map('adminCampusMap').setView(CAMPUS_CENTER, 16);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom: 20, attribution: '&copy; OpenStreetMap contributors'}).addTo(adminMap);
    adminMap.on('click', event => openLocationDialog({latitude: event.latlng.lat, longitude: event.latlng.lng}))
}

function renderLocations() {
    initLocationMap();
    if (!adminMap) return;
    locationMarkers.forEach(marker => marker.remove());
    locationMarkers = locations.map(item => {
        const bins = item.loai_thung_list?.length ? item.loai_thung_list : [item.loai_thung];
        const marker = L.marker([item.latitude, item.longitude], {icon: locationIcon(bins[0]), draggable: true}).addTo(adminMap);
        marker.bindTooltip(item.ten_vi_tri);
        marker.on('dragend', async event => {
            const point = event.target.getLatLng();
            try {
                await api(`/api/bin-locations/${item.id}`, {method: 'PUT', body: JSON.stringify({...item, latitude: point.lat, longitude: point.lng})});
                message('Đã cập nhật tọa độ thùng rác.');
                load()
            } catch (error) {
                message(error.message);
                load()
            }
        });
        return marker
    });
    $('locationList').innerHTML = locations.length ? locations.map(item => { const bins = item.loai_thung_list?.length ? item.loai_thung_list : [item.loai_thung]; return `<article class="location-item"><i style="background:${BIN_COLORS[bins[0]] || '#64748b'}"></i><div><strong>${escapeHtml(item.ten_vi_tri)}</strong><span>${bins.map(escapeHtml).join(', ')} · ${escapeHtml(item.trang_thai)} · cập nhật ${formatTime(item.updated_at)}</span></div><div class="row-actions"><button class="secondary" data-location-qr="${item.id}">QR</button><button class="secondary" data-location-edit="${item.id}">Sửa</button><button class="danger" data-location-delete="${item.id}">Xóa</button></div></article>` }).join('') : '<p class="empty">Chưa có vị trí thùng rác. Bấm lên bản đồ để thêm.</p>'
}

const formatTime = value => value ? new Date(`${value.replace(' ', 'T')}Z`).toLocaleString('vi-VN') : 'chưa có';

function renderReports() {
    const fresh = reports.filter(item => item.status === 'Mới').length;
    $('newReportCount').textContent = `${fresh} báo cáo mới`;
    $('reportList').innerHTML = reports.length ? reports.map(item => `<article class="location-item report-${item.status === 'Mới' ? 'new' : 'done'}"><i></i><div><strong>${escapeHtml(item.report_type)} · ${escapeHtml(item.ten_vi_tri)}</strong><span>${escapeHtml(item.note || 'Không có ghi chú')} · ${formatTime(item.created_at)}</span></div>${item.status === 'Mới' ? `<button class="secondary" data-resolve-report="${item.id}">Đánh dấu đã xử lý</button>` : '<span>Đã xử lý</span>'}</article>`).join('') : '<p class="empty">Chưa có báo cáo từ người dùng.</p>'
}

function showQr(item) {
    activeQrLocation = item;
    $('qrTitle').textContent = `Mã QR · ${item.ten_vi_tri}`;
    $('qrCode').innerHTML = '';
    new QRCode($('qrCode'), {text: `${location.origin}/?bin=${item.id}`, width: 220, height: 220});
    $('qrDialog').showModal()
}

function openLocationDialog(item = {}) {
    $('locationId').value = item.id || '';
    $('locationName').value = item.ten_vi_tri || '';
    const bins = item.loai_thung_list?.length ? item.loai_thung_list : (item.loai_thung ? [item.loai_thung] : ['Xanh lá']);
    document.querySelectorAll('.location-bin-check').forEach(input => input.checked = bins.includes(input.value));
    $('locationStatus').value = item.trang_thai || 'Hoạt động';
    $('locationLat').value = Number(item.latitude ?? CAMPUS_CENTER[0]).toFixed(6);
    $('locationLng').value = Number(item.longitude ?? CAMPUS_CENTER[1]).toFixed(6);
    $('locationDescription').value = item.mo_ta || '';
    $('locationDialogTitle').textContent = item.id ? 'Sửa vị trí thùng' : 'Thêm vị trí thùng';
    $('locationDialog').showModal()
}

function openDialog(item = {}) {
    $('categoryId').value = item.id || '';
    $('categoryLabel').value = item.category_label || '';
    $('categoryName').value = item.ten_loai || '';
    $('binColor').value = item.mau_thung || '';
    $('colorHex').value = item.color_hex || '#16835b';
    $('description').value = item.mo_ta || '';
    $('dialogTitle').textContent = item.id ? 'Sửa danh mục' : 'Thêm danh mục';
    $('categoryDialog').showModal()
}

$('categoryBody').addEventListener('click', async event => {
    const edit = event.target.dataset.edit, remove = event.target.dataset.delete;
    if (edit) openDialog(categories.find(x => x.id === Number(edit)));
    if (remove && confirm('Bạn chắc chắn muốn xóa danh mục này?')) {
        try {
            await api(`/api/categories/${remove}`, {method: 'DELETE'});
            message('Đã xóa danh mục.');
            load()
        } catch (error) {
            message(error.message)
        }
    }
});

$('categoryForm').addEventListener('submit', async event => {
    event.preventDefault();
    const id = $('categoryId').value;
    const data = {category_label: $('categoryLabel').value.trim(), ten_loai: $('categoryName').value.trim(), mau_thung: $('binColor').value.trim(), color_hex: $('colorHex').value, mo_ta: $('description').value.trim()};
    try {
        await api(id ? `/api/categories/${id}` : '/api/categories', {method: id ? 'PUT' : 'POST', body: JSON.stringify(data)});
        $('categoryDialog').close();
        message('Đã lưu danh mục. Màu nhận diện sẽ đồng bộ sang trang người dùng.');
        load()
    } catch (error) {
        message(error.message)
    }
});

$('newCategory').addEventListener('click', () => openDialog());
$('cancelDialog').addEventListener('click', () => $('categoryDialog').close());
$('newLocation').addEventListener('click', () => openLocationDialog());
$('cancelLocationDialog').addEventListener('click', () => $('locationDialog').close());
$('locationList').addEventListener('click', async event => {
    const edit = event.target.dataset.locationEdit, remove = event.target.dataset.locationDelete, qr = event.target.dataset.locationQr;
    if (edit) openLocationDialog(locations.find(item => item.id === Number(edit)));
    if (qr) showQr(locations.find(item => item.id === Number(qr)));
    if (remove && confirm('Bạn chắc chắn muốn xóa vị trí thùng này?')) {
        try {
            await api(`/api/bin-locations/${remove}`, {method: 'DELETE'});
            message('Đã xóa vị trí thùng.');
            load()
        } catch (error) { message(error.message) }
    }
});
$('locationForm').addEventListener('submit', async event => {
    event.preventDefault();
    const id = $('locationId').value;
    const loai_thung_list = [...document.querySelectorAll('.location-bin-check:checked')].map(input => input.value);
    if (!loai_thung_list.length) return message('Chọn ít nhất một loại thùng.');
    const data = {ten_vi_tri: $('locationName').value.trim(), loai_thung_list, latitude: Number($('locationLat').value), longitude: Number($('locationLng').value), trang_thai: $('locationStatus').value, mo_ta: $('locationDescription').value.trim()};
    try {
        await api(id ? `/api/bin-locations/${id}` : '/api/bin-locations', {method: id ? 'PUT' : 'POST', body: JSON.stringify(data)});
        $('locationDialog').close();
        message('Đã lưu vị trí thùng rác.');
        load()
    } catch (error) { message(error.message) }
});
$('reportList').addEventListener('click', async event => {
    const id = event.target.dataset.resolveReport;
    if (!id) return;
    try { await api(`/api/bin-reports/${id}`, {method: 'PATCH'}); message('Đã xử lý báo cáo.'); load() } catch (error) { message(error.message) }
});
$('closeQr').addEventListener('click', () => $('qrDialog').close());
$('printQr').addEventListener('click', () => {
    const image = $('qrCode').querySelector('img')?.src || $('qrCode').querySelector('canvas')?.toDataURL();
    if (!image || !activeQrLocation) return;
    const popup = window.open('', '_blank', 'width=500,height=650');
    popup.document.write(`<title>QR ${escapeHtml(activeQrLocation.ten_vi_tri)}</title><div style="font-family:Arial;text-align:center;padding:30px"><h2>${escapeHtml(activeQrLocation.ten_vi_tri)}</h2><img src="${image}" width="300"><p>Quét để xem vị trí và báo sự cố</p></div>`);
    popup.document.close(); popup.focus(); popup.print()
});
load();
