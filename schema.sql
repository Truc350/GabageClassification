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
