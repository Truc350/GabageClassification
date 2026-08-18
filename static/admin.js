const $ = id => document.getElementById(id);
let categories = [], locations = [], reports = [], users = [], auditLogs = [], rewardData = {rewards: [], redemptions: []}, charts = [], statusChart = null, adminMap = null, locationMarkers = [], activeQrLocation = null;
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
        const statsRequest = statsUrl();
        [categories, locations, reports, users, auditLogs, rewardData] = await Promise.all([api('/api/categories'), api('/api/bin-locations'), api('/api/bin-reports'), api('/api/users'), api('/api/audit-logs'), api('/api/admin/rewards')]);
        $('categoryCount').textContent = categories.length;
        renderCategories();
        renderLocations();
        renderReports();
        renderSystem();
        renderLocationStatus();
        renderStats(await api(statsRequest));
        renderNotifications(await api('/api/notifications'))
    } catch (error) {
        message(error.message)
    }
}

function renderStats(stats) {
    Chart.defaults.font.family = 'Arial';
    $('totalRecognitions').textContent = stats.total_recognitions;
    $('activeUsers').textContent = stats.active_users;
    const binCounts = Object.fromEntries((stats.by_bin || []).map(item => [item.bin_name, item.count]));
    $('greenBinCount').textContent = `${binCounts['Xanh lá'] || 0} lượt`;
    $('blueBinCount').textContent = `${binCounts['Xanh dương'] || 0} lượt`;
    $('grayBinCount').textContent = `${binCounts['Xám'] || 0} lượt`;
    $('averageResolution').textContent = `${stats.average_resolution_hours || 0} giờ`;
    const top = (stats.top_problem_locations || [])[0];
    $('topProblemLocation').textContent = top && top.count ? `${top.ten_vi_tri} · ${top.count} sự cố` : 'Chưa có sự cố';
    const query = statsUrl().split('?')[1];
    $('exportRecognitions').href = `/api/export/recognitions.csv${query ? `?${query}` : ''}`;
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

function renderNotifications(data) {
    $('notificationBadge').hidden = !data.total;
    $('notificationBadge').textContent = data.total || 0;
    $('notificationBadge').title = `${data.reports} báo cáo chưa xong, ${data.full_bins} thùng đầy, ${data.overdue_maintenance} lịch bảo trì quá hạn`
}

function renderSystem() {
    const roleNames = {admin: 'Quản trị viên', staff: 'Nhân viên thu gom', viewer: 'Chỉ xem'};
    const managementUsers = users.filter(item => item.role !== 'user');
    $('userList').innerHTML = managementUsers.length ? managementUsers.map(item => `<article class="location-item"><i></i><div><strong>${escapeHtml(item.username)}</strong><span>${roleNames[item.role] || escapeHtml(item.role)} · tạo ${formatTime(item.created_at)}</span></div>${document.body.dataset.role === 'admin' ? `<button class="secondary" data-user-edit="${item.id}">Sửa</button>` : ''}</article>`).join('') : '<p class="empty">Chưa có tài khoản quản trị.</p>';
    $('auditList').innerHTML = auditLogs.length ? auditLogs.map(item => `<article class="location-item"><i></i><div><strong>${escapeHtml(item.action)} · ${escapeHtml(item.entity_type)}</strong><span>${escapeHtml(item.username || 'Hệ thống')} · ${escapeHtml(item.details || '')} · ${formatTime(item.created_at)}</span></div></article>`).join('') : '<p class="empty">Chưa có thao tác được ghi nhận.</p>';
    $('adminRewardList').innerHTML = rewardData.rewards.length ? rewardData.rewards.map(item => `<article class="location-item"><i></i><div><strong>${escapeHtml(item.name)} · ${item.points_cost} điểm</strong><span>${item.active ? 'Đang hiển thị' : 'Đã ẩn'} · ${item.stock == null ? 'Không giới hạn' : `Còn ${item.stock}`}</span></div><button class="secondary" data-reward-edit="${item.id}">Sửa</button></article>`).join('') : '<p class="empty">Chưa cấu hình phần quà.</p>';
    $('adminRedemptionList').innerHTML = rewardData.redemptions.length ? rewardData.redemptions.map(item => `<article class="location-item"><i></i><div><strong>${escapeHtml(item.name)} · ${escapeHtml(item.code)}</strong><span>${escapeHtml(item.username)} · ${item.points_spent} điểm · ${formatTime(item.created_at)}</span></div><select data-redemption-status="${item.id}"><option${item.status === 'Chờ nhận' ? ' selected' : ''}>Chờ nhận</option><option${item.status === 'Đã nhận' ? ' selected' : ''}>Đã nhận</option><option${item.status === 'Đã hủy' ? ' selected' : ''}>Đã hủy</option></select></article>`).join('') : '<p class="empty">Chưa có lượt đổi quà.</p>'
}

function statsUrl() {
    const period = $('adminStatsPeriod').value;
    if (period === 'all') return '/api/stats';
    let from = $('adminStatsFrom').value, to = $('adminStatsTo').value;
    if (period !== 'custom') {
        const end = new Date(), start = new Date();
        start.setDate(start.getDate() - Number(period) + 1);
        const key = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        from = key(start); to = key(end)
    }
    const query = new URLSearchParams();
    if (from) query.set('from', from);
    if (to) query.set('to', to);
    const queryString = query.toString();
    return `/api/stats${queryString ? `?${queryString}` : ''}`
}

async function refreshAdminStats() {
    try { renderStats(await api(statsUrl())) } catch (error) { message(error.message) }
}

function renderLocationStatus() {
    Chart.defaults.font.family = 'Arial';
    const statuses = ['Hoạt động', 'Đầy', 'Bảo trì'];
    const counts = Object.fromEntries(statuses.map(status => [status, locations.filter(item => item.trang_thai === status).length]));
    const total = locations.length;
    $('locationStatusTotal').textContent = `${total} điểm`;
    statusChart?.destroy();
    statusChart = new Chart($('binStatusChart'), {
        type: 'doughnut',
        data: {labels: statuses, datasets: [{data: statuses.map(status => counts[status]), backgroundColor: ['#22c55e', '#e0a528', '#64748b'], borderWidth: 3, borderColor: '#fff', hoverOffset: 8}]},
        options: {
            maintainAspectRatio: false,
            cutout: '62%',
            plugins: {
                legend: {position: 'bottom', labels: {padding: 20, usePointStyle: true}},
                tooltip: {callbacks: {label: context => {
                    const count = Number(context.raw || 0);
                    const percentage = total ? (count * 100 / total).toFixed(1) : '0.0';
                    return ` ${context.label}: ${count} điểm (${percentage}%)`
                }}}
            }
        }
    })
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
    $('reportList').innerHTML = reports.length ? reports.map(item => `<article class="report-card report-${item.status === 'Đã xử lý' ? 'done' : 'new'}" data-report-id="${item.id}"><div class="report-card-head"><div><strong>${escapeHtml(item.report_type)} · ${escapeHtml(item.ten_vi_tri)}</strong><span>${escapeHtml(item.reporter_name || 'Ẩn danh')}${item.reporter_contact ? ` · ${escapeHtml(item.reporter_contact)}` : ''} · ${formatTime(item.created_at)}</span></div>${item.image_path ? `<a href="/api/bin-reports/${item.id}/image" target="_blank">Xem ảnh</a>` : ''}</div><p>${escapeHtml(item.note || 'Không có mô tả')}</p><div class="report-workflow"><label>Trạng thái<select data-report-status><option${item.status === 'Mới' ? ' selected' : ''}>Mới</option><option${item.status === 'Đang xử lý' ? ' selected' : ''}>Đang xử lý</option><option${item.status === 'Đã xử lý' ? ' selected' : ''}>Đã xử lý</option></select></label><label>Ghi chú xử lý<input data-report-note value="${escapeHtml(item.admin_note || '')}" placeholder="Nội dung đã xử lý"></label><button class="primary" data-save-report="${item.id}">Lưu</button></div><small>Phụ trách: ${escapeHtml(item.assigned_username || 'Chưa phân công')}</small></article>`).join('') : '<p class="empty">Chưa có báo cáo từ người dùng.</p>'
}

function showQr(item) {
    activeQrLocation = item;
    $('qrTitle').textContent = `Mã QR · ${item.ten_vi_tri}`;
    $('qrCode').innerHTML = '';
    new QRCode($('qrCode'), {text: `${location.origin}/?report=${item.id}`, width: 220, height: 220});
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
    $('lastMaintenance').value = item.last_maintenance_at?.slice(0, 10) || '';
    $('nextMaintenance').value = item.next_maintenance_at?.slice(0, 10) || '';
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

function openUserDialog(item = {}) {
    $('userId').value = item.id || '';
    $('accountUsername').value = item.username || '';
    $('accountUsername').disabled = Boolean(item.id);
    $('accountPassword').required = !item.id;
    $('accountPassword').value = '';
    $('accountRole').value = item.role || 'viewer';
    $('userDialogTitle').textContent = item.id ? 'Sửa tài khoản' : 'Thêm tài khoản';
    $('userDialog').showModal()
}

function openRewardDialog(item = {}) {
    $('rewardNotice').textContent = '';
    $('rewardId').value = item.id || '';
    $('rewardName').value = item.name || '';
    $('rewardDescription').value = item.description || '';
    $('rewardCost').value = item.points_cost || '';
    $('rewardStock').value = item.stock ?? '';
    $('rewardActive').checked = item.active !== 0;
    $('rewardDialogTitle').textContent = item.id ? 'Sửa phần quà' : 'Thêm phần quà';
    $('rewardDialog').showModal()
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
$('newUser')?.addEventListener('click', () => openUserDialog());
$('newReward').addEventListener('click', () => openRewardDialog());
$('cancelUser').addEventListener('click', () => $('userDialog').close());
$('cancelReward').addEventListener('click', () => $('rewardDialog').close());
$('userList').addEventListener('click', event => {
    const id = Number(event.target.dataset.userEdit);
    if (id) openUserDialog(users.find(item => item.id === id))
});
$('userForm').addEventListener('submit', async event => {
    event.preventDefault();
    const id = $('userId').value;
    const data = {username: $('accountUsername').value.trim(), password: $('accountPassword').value, role: $('accountRole').value};
    try {
        await api(id ? `/api/users/${id}` : '/api/users', {method: id ? 'PUT' : 'POST', body: JSON.stringify(data)});
        $('userDialog').close(); message('Đã lưu tài khoản.'); load()
    } catch (error) { message(error.message) }
});
$('adminRewardList').addEventListener('click', event => {
    const id = Number(event.target.dataset.rewardEdit);
    if (id) openRewardDialog(rewardData.rewards.find(item => item.id === id))
});
$('rewardForm').addEventListener('submit', async event => {
    event.preventDefault();
    const saveButton = $('saveReward');
    saveButton.disabled = true;
    saveButton.textContent = 'Đang lưu...';
    $('rewardNotice').textContent = '';
    const id = $('rewardId').value;
    const data = {name: $('rewardName').value.trim(), description: $('rewardDescription').value.trim(), points_cost: Number($('rewardCost').value), stock: $('rewardStock').value === '' ? null : Number($('rewardStock').value), active: $('rewardActive').checked};
    try {
        await api(id ? `/api/admin/rewards/${id}` : '/api/admin/rewards', {method: id ? 'PUT' : 'POST', body: JSON.stringify(data)});
        $('rewardDialog').close();
        await load()
    } catch (error) {
        $('rewardNotice').textContent = error.message
    } finally {
        saveButton.disabled = false;
        saveButton.textContent = 'Lưu phần quà'
    }
});
$('adminRedemptionList').addEventListener('change', async event => {
    const id = event.target.dataset.redemptionStatus;
    if (!id) return;
    try { await api(`/api/admin/redemptions/${id}`, {method: 'PATCH', body: JSON.stringify({status: event.target.value})}); message('Đã cập nhật lượt đổi quà.'); load() }
    catch (error) { message(error.message); load() }
});
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
    const data = {ten_vi_tri: $('locationName').value.trim(), loai_thung_list, latitude: Number($('locationLat').value), longitude: Number($('locationLng').value), trang_thai: $('locationStatus').value, mo_ta: $('locationDescription').value.trim(), last_maintenance_at: $('lastMaintenance').value, next_maintenance_at: $('nextMaintenance').value};
    try {
        await api(id ? `/api/bin-locations/${id}` : '/api/bin-locations', {method: id ? 'PUT' : 'POST', body: JSON.stringify(data)});
        $('locationDialog').close();
        message('Đã lưu vị trí thùng rác.');
        load()
    } catch (error) { message(error.message) }
});
$('reportList').addEventListener('click', async event => {
    const id = event.target.dataset.saveReport;
    if (!id) return;
    const card = event.target.closest('[data-report-id]');
    const data = {status: card.querySelector('[data-report-status]').value, admin_note: card.querySelector('[data-report-note]').value.trim()};
    try { await api(`/api/bin-reports/${id}`, {method: 'PATCH', body: JSON.stringify(data)}); message('Đã cập nhật báo cáo.'); load() } catch (error) { message(error.message) }
});
$('closeQr').addEventListener('click', () => $('qrDialog').close());
$('printQr').addEventListener('click', () => {
    const image = $('qrCode').querySelector('img')?.src || $('qrCode').querySelector('canvas')?.toDataURL();
    if (!image || !activeQrLocation) return;
    const popup = window.open('', '_blank', 'width=500,height=650');
    popup.document.write(`<title>QR ${escapeHtml(activeQrLocation.ten_vi_tri)}</title><div style="font-family:Arial;text-align:center;padding:30px"><h2>${escapeHtml(activeQrLocation.ten_vi_tri)}</h2><img src="${image}" width="300"><p>Quét để báo hư hỏng thùng rác</p></div>`);
    popup.document.close(); popup.focus(); popup.print()
});
$('adminStatsPeriod').addEventListener('change', () => {
    $('adminCustomPeriod').hidden = $('adminStatsPeriod').value !== 'custom';
    refreshAdminStats()
});
$('adminStatsFrom').addEventListener('change', refreshAdminStats);
$('adminStatsTo').addEventListener('change', refreshAdminStats);

const ADMIN_SECTIONS = new Set(['admin-dashboard', 'admin-locations', 'admin-reports', 'admin-categories', 'admin-system']);

function closeAdminSidebar() {
    document.body.classList.remove('sidebar-open');
    $('adminSidebarToggle').setAttribute('aria-expanded', 'false')
}

function activateAdminSection(sectionId, updateHistory = true) {
    const targetId = ADMIN_SECTIONS.has(sectionId) ? sectionId : 'admin-dashboard';
    document.querySelectorAll('.admin-app .app-section').forEach(section => section.classList.toggle('active', section.id === targetId));
    document.querySelectorAll('[data-admin-section]').forEach(link => {
        const active = link.dataset.adminSection === targetId;
        link.classList.toggle('active', active);
        link.setAttribute('aria-current', active ? 'page' : 'false')
    });
    if (updateHistory && location.hash !== `#${targetId}`) history.pushState(null, '', `#${targetId}`);
    if (targetId === 'admin-locations') setTimeout(() => adminMap?.invalidateSize(), 50);
    if (targetId === 'admin-dashboard') setTimeout(() => {
        charts.forEach(chart => chart.resize());
        statusChart?.resize()
    }, 50);
    closeAdminSidebar()
}

$('adminSidebarToggle').addEventListener('click', () => {
    const open = document.body.classList.toggle('sidebar-open');
    $('adminSidebarToggle').setAttribute('aria-expanded', String(open))
});
$('adminSidebarBackdrop').addEventListener('click', closeAdminSidebar);
document.querySelectorAll('[data-admin-section]').forEach(link => link.addEventListener('click', event => {
    event.preventDefault();
    activateAdminSection(link.dataset.adminSection)
}));
document.querySelector('.admin-sidebar-brand').addEventListener('click', event => {
    event.preventDefault();
    activateAdminSection('admin-dashboard')
});
window.addEventListener('popstate', () => activateAdminSection(location.hash.slice(1), false));
activateAdminSection(location.hash.slice(1), false);
load();
