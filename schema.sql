PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
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
);

CREATE INDEX IF NOT EXISTS idx_bin_locations_status ON bin_locations(trang_thai);

CREATE TABLE IF NOT EXISTS bin_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    location_id INTEGER NOT NULL,
    report_type TEXT NOT NULL CHECK (report_type IN ('Đầy', 'Hư hỏng', 'Sai vị trí')),
    note TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'Mới' CHECK (status IN ('Mới', 'Đã xử lý')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TEXT,
    FOREIGN KEY (location_id) REFERENCES bin_locations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_bin_reports_status ON bin_reports(status, created_at DESC);
