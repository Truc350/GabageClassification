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
    location_columns = {row[1] for row in database.execute("PRAGMA table_info(bin_locations)")}
    if "supported_bins" not in location_columns:
        database.execute("ALTER TABLE bin_locations ADD COLUMN supported_bins TEXT NOT NULL DEFAULT '[]'")
    if "updated_at" not in location_columns:
        database.execute("ALTER TABLE bin_locations ADD COLUMN updated_at TEXT")
        database.execute("UPDATE bin_locations SET updated_at=COALESCE(created_at, CURRENT_TIMESTAMP) WHERE updated_at IS NULL")
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
