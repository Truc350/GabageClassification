const $ = id => document.getElementById(id);
let categories = [], charts = [];

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
        [categories] = await Promise.all([api('/api/categories'), loadStats()]);
        $('categoryCount').textContent = categories.length;
        renderCategories()
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
load();
