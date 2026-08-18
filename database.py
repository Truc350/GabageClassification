from __future__ import annotations

import sqlite3
from pathlib import Path
import json

from flask import current_app, g
from werkzeug.security import generate_password_hash


SEED_CATEGORIES = [
    ("battery", "Pin", "Xám", "#7c3aed", "Pin cần chuyển đến điểm thu gom chất thải nguy hại"),
    ("biological", "Rác hữu cơ", "Xanh lá", "#22c55e", "Chất thải thực phẩm và rác hữu cơ"),
    ("brown-glass", "Thủy tinh nâu", "Xanh dương", "#92400e", "Rác có khả năng tái sử dụng, tái chế"),
    ("cardboard", "Bìa carton", "Xanh dương", "#d97706", "Rác có khả năng tái sử dụng, tái chế"),
    ("clothes", "Quần áo", "Xanh dương", "#ec4899", "Rác có khả năng tái sử dụng, tái chế"),
    ("green-glass", "Thủy tinh xanh", "Xanh dương", "#059669", "Rác có khả năng tái sử dụng, tái chế"),
    ("metal", "Kim loại", "Xanh dương", "#64748b", "Rác có khả năng tái sử dụng, tái chế"),
    ("paper", "Giấy", "Xanh dương", "#3b82f6", "Rác có khả năng tái sử dụng, tái chế"),
    ("plastic", "Nhựa", "Xanh dương", "#f59e0b", "Rác có khả năng tái sử dụng, tái chế"),
    ("shoes", "Giày dép", "Xanh dương", "#8b5cf6", "Rác có khả năng tái sử dụng, tái chế"),
    ("trash", "Rác khác", "Xám", "#374151", "Rác sinh hoạt khác không thuộc hai nhóm còn lại"),
    ("white-glass", "Thủy tinh trắng", "Xanh dương", "#06b6d4", "Rác có khả năng tái sử dụng, tái chế"),
]

LEGACY_CATEGORY_COLORS = {"Xanh lá": "#28a66f", "Xanh dương": "#4591d1", "Xám": "#555f5a"}


def get_db():
    if "db" not in g:
        path = Path(current_app.config["DATABASE_PATH"])
        path.parent.mkdir(parents=True, exist_ok=True)
        g.db = sqlite3.connect(path)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


def close_db(_error=None):
    database = g.pop("db", None)
    if database is not None:
        database.close()


def init_db():
    database = get_db()
    schema = Path(current_app.root_path, "schema.sql").read_text(encoding="utf-8")
    database.executescript(schema)
    user_sql = database.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").fetchone()[0]
    if "'staff'" not in user_sql:
        database.execute("PRAGMA foreign_keys = OFF")
        database.executescript("""
            CREATE TABLE users_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin', 'staff', 'viewer')),
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            INSERT INTO users_new (id, username, password_hash, role, created_at)
            SELECT id, username, password_hash, role, created_at FROM users;
            DROP TABLE users;
            ALTER TABLE users_new RENAME TO users;
        """)
        database.execute("PRAGMA foreign_keys = ON")
    location_columns = {row[1] for row in database.execute("PRAGMA table_info(bin_locations)")}
    if "supported_bins" not in location_columns:
        database.execute("ALTER TABLE bin_locations ADD COLUMN supported_bins TEXT NOT NULL DEFAULT '[]'")
    if "updated_at" not in location_columns:
        database.execute("ALTER TABLE bin_locations ADD COLUMN updated_at TEXT")
        database.execute("UPDATE bin_locations SET updated_at=COALESCE(created_at, CURRENT_TIMESTAMP) WHERE updated_at IS NULL")
    if "last_maintenance_at" not in location_columns:
        database.execute("ALTER TABLE bin_locations ADD COLUMN last_maintenance_at TEXT")
    if "next_maintenance_at" not in location_columns:
        database.execute("ALTER TABLE bin_locations ADD COLUMN next_maintenance_at TEXT")
    report_columns = {row[1] for row in database.execute("PRAGMA table_info(bin_reports)")}
    for column, definition in {
        "reporter_name": "TEXT NOT NULL DEFAULT ''",
        "reporter_contact": "TEXT NOT NULL DEFAULT ''",
        "image_path": "TEXT",
        "admin_note": "TEXT NOT NULL DEFAULT ''",
        "assigned_to": "INTEGER",
        "reporter_user_id": "INTEGER",
    }.items():
        if column not in report_columns:
            database.execute(f"ALTER TABLE bin_reports ADD COLUMN {column} {definition}")
    report_sql = database.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='bin_reports'").fetchone()[0]
    if "'Đang xử lý'" not in report_sql:
        database.execute("PRAGMA foreign_keys = OFF")
        database.executescript("""
            ALTER TABLE bin_reports RENAME TO bin_reports_legacy;
            CREATE TABLE bin_reports (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                location_id INTEGER NOT NULL,
                report_type TEXT NOT NULL CHECK (report_type IN ('Đầy', 'Hư hỏng', 'Sai vị trí')),
                note TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'Mới' CHECK (status IN ('Mới', 'Đang xử lý', 'Đã xử lý')),
                reporter_name TEXT NOT NULL DEFAULT '', reporter_contact TEXT NOT NULL DEFAULT '',
                image_path TEXT, admin_note TEXT NOT NULL DEFAULT '', assigned_to INTEGER, reporter_user_id INTEGER,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, resolved_at TEXT,
                FOREIGN KEY (location_id) REFERENCES bin_locations(id) ON DELETE CASCADE,
                FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL,
                FOREIGN KEY (reporter_user_id) REFERENCES users(id) ON DELETE SET NULL
            );
            INSERT INTO bin_reports (id, location_id, report_type, note, status, reporter_name,
                reporter_contact, image_path, admin_note, assigned_to, reporter_user_id, created_at, resolved_at)
            SELECT id, location_id, report_type, note, status, reporter_name,
                reporter_contact, image_path, admin_note, assigned_to, reporter_user_id, created_at, resolved_at
            FROM bin_reports_legacy;
            DROP TABLE bin_reports_legacy;
            CREATE INDEX IF NOT EXISTS idx_bin_reports_status ON bin_reports(status, created_at DESC);
        """)
        database.execute("PRAGMA foreign_keys = ON")
    quiz_columns = {row[1] for row in database.execute("PRAGMA table_info(education_quiz_results)")}
    if "points_awarded" not in quiz_columns:
        database.execute("ALTER TABLE education_quiz_results ADD COLUMN points_awarded INTEGER NOT NULL DEFAULT 0")
    broken_user_foreign_keys = {
        table for table in ("recognition_history", "audit_logs", "education_quiz_results")
        if any(row[2] == "users_legacy" for row in database.execute(f"PRAGMA foreign_key_list({table})"))
    }
    if broken_user_foreign_keys:
        database.commit()
        database.execute("PRAGMA foreign_keys = OFF")
        if "recognition_history" in broken_user_foreign_keys:
            database.executescript("""
                CREATE TABLE recognition_history_fixed (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
                    category_id INTEGER NOT NULL, confidence_score REAL NOT NULL CHECK (confidence_score BETWEEN 0 AND 1),
                    thoi_gian TEXT NOT NULL, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                    FOREIGN KEY (category_id) REFERENCES waste_categories(id) ON DELETE RESTRICT
                );
                INSERT INTO recognition_history_fixed SELECT * FROM recognition_history;
                DROP TABLE recognition_history;
                ALTER TABLE recognition_history_fixed RENAME TO recognition_history;
                CREATE INDEX idx_history_user_time ON recognition_history(user_id, thoi_gian DESC);
                CREATE INDEX idx_history_category ON recognition_history(category_id);
            """)
        if "audit_logs" in broken_user_foreign_keys:
            database.executescript("""
                CREATE TABLE audit_logs_fixed (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, username TEXT NOT NULL DEFAULT '',
                    action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id INTEGER,
                    details TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
                );
                INSERT INTO audit_logs_fixed SELECT * FROM audit_logs;
                DROP TABLE audit_logs;
                ALTER TABLE audit_logs_fixed RENAME TO audit_logs;
            """)
        if "education_quiz_results" in broken_user_foreign_keys:
            database.executescript("""
                CREATE TABLE education_quiz_results_fixed (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL DEFAULT 1,
                    score INTEGER NOT NULL, total INTEGER NOT NULL, points_awarded INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                );
                INSERT INTO education_quiz_results_fixed SELECT * FROM education_quiz_results;
                DROP TABLE education_quiz_results;
                ALTER TABLE education_quiz_results_fixed RENAME TO education_quiz_results;
            """)
        database.execute("PRAGMA foreign_keys = ON")
    for row in database.execute("SELECT id, loai_thung, supported_bins FROM bin_locations").fetchall():
        try:
            bins = json.loads(row["supported_bins"] or "[]")
        except (TypeError, ValueError):
            bins = []
        if not bins:
            database.execute("UPDATE bin_locations SET supported_bins=? WHERE id=?", (json.dumps([row["loai_thung"]], ensure_ascii=False), row["id"]))
    database.executemany(
        """INSERT OR IGNORE INTO waste_categories
           (category_label, ten_loai, mau_thung, color_hex, mo_ta)
           VALUES (?, ?, ?, ?, ?)""",
        SEED_CATEGORIES,
    )
    # Chỉ đổi màu dữ liệu cũ còn dùng màu thùng; màu người quản trị đã sửa được giữ nguyên.
    for label, _name, bin_name, color, _description in SEED_CATEGORIES:
        database.execute(
            "UPDATE waste_categories SET color_hex=? WHERE category_label=? AND lower(color_hex)=?",
            (color, label, LEGACY_CATEGORY_COLORS[bin_name]),
        )
    database.execute(
        """INSERT OR IGNORE INTO users (id, username, password_hash, role)
           VALUES (1, 'demo', ?, 'user')""",
        (generate_password_hash("demo123"),),
    )
    database.execute(
        """INSERT OR IGNORE INTO users (id, username, password_hash, role)
           VALUES (2, 'admin', ?, 'admin')""",
        (generate_password_hash("admin123"),),
    )
    database.commit()


def init_app(app):
    app.teardown_appcontext(close_db)
    with app.app_context():
        init_db()
