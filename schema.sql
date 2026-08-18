PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin', 'staff', 'viewer')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS waste_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_label TEXT NOT NULL UNIQUE,
    ten_loai TEXT NOT NULL,
    mau_thung TEXT NOT NULL,
    color_hex TEXT NOT NULL DEFAULT '#16835b',
    mo_ta TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS recognition_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    category_id INTEGER NOT NULL,
    confidence_score REAL NOT NULL CHECK (confidence_score BETWEEN 0 AND 1),
    thoi_gian TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES waste_categories(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_history_user_time ON recognition_history(user_id, thoi_gian DESC);
CREATE INDEX IF NOT EXISTS idx_history_category ON recognition_history(category_id);

CREATE TABLE IF NOT EXISTS bin_locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ten_vi_tri TEXT NOT NULL,
    loai_thung TEXT NOT NULL CHECK (loai_thung IN ('Xanh lá', 'Xanh dương', 'Xám')),
    latitude REAL NOT NULL CHECK (latitude BETWEEN -90 AND 90),
    longitude REAL NOT NULL CHECK (longitude BETWEEN -180 AND 180),
    trang_thai TEXT NOT NULL DEFAULT 'Hoạt động' CHECK (trang_thai IN ('Hoạt động', 'Đầy', 'Bảo trì')),
    mo_ta TEXT NOT NULL DEFAULT '',
    supported_bins TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    ,last_maintenance_at TEXT
    ,next_maintenance_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_bin_locations_status ON bin_locations(trang_thai);

CREATE TABLE IF NOT EXISTS bin_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    location_id INTEGER NOT NULL,
    report_type TEXT NOT NULL CHECK (report_type IN ('Đầy', 'Hư hỏng', 'Sai vị trí')),
    note TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'Mới' CHECK (status IN ('Mới', 'Đang xử lý', 'Đã xử lý')),
    reporter_name TEXT NOT NULL DEFAULT '',
    reporter_contact TEXT NOT NULL DEFAULT '',
    image_path TEXT,
    admin_note TEXT NOT NULL DEFAULT '',
    assigned_to INTEGER,
    reporter_user_id INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TEXT,
    FOREIGN KEY (location_id) REFERENCES bin_locations(id) ON DELETE CASCADE,
    FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (reporter_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_bin_reports_status ON bin_reports(status, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    username TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id INTEGER,
    details TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS education_quiz_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL DEFAULT 1,
    score INTEGER NOT NULL,
    total INTEGER NOT NULL,
    points_awarded INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reward_catalog (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    points_cost INTEGER NOT NULL CHECK (points_cost > 0),
    stock INTEGER CHECK (stock IS NULL OR stock >= 0),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS point_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    points INTEGER NOT NULL,
    reason TEXT NOT NULL,
    source_key TEXT UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reward_redemptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    reward_id INTEGER NOT NULL,
    points_spent INTEGER NOT NULL,
    code TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'Chờ nhận' CHECK (status IN ('Chờ nhận', 'Đã nhận', 'Đã hủy')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fulfilled_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (reward_id) REFERENCES reward_catalog(id) ON DELETE RESTRICT
);
