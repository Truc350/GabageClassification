from __future__ import annotations

import sqlite3
from pathlib import Path

from flask import current_app, g
from werkzeug.security import generate_password_hash


SEED_CATEGORIES = [
    ("battery", "Pin", "Đỏ", "#e34f4f", "Pin và rác thải điện tử nhỏ"),
    ("biological", "Rác hữu cơ", "Xanh lá", "#28a66f", "Thức ăn thừa và rác hữu cơ"),
    ("brown-glass", "Thủy tinh nâu", "Nâu", "#8a6846", "Chai lọ thủy tinh màu nâu"),
    ("cardboard", "Bìa carton", "Vàng", "#e0a52f", "Bìa và hộp carton"),
    ("clothes", "Quần áo", "Xanh dương", "#6d79cc", "Quần áo và vải"),
    ("green-glass", "Thủy tinh xanh", "Xanh lá", "#28a66f", "Chai lọ thủy tinh màu xanh"),
    ("metal", "Kim loại", "Vàng", "#e0a52f", "Lon và vật dụng kim loại"),
    ("paper", "Giấy", "Xanh dương", "#4591d1", "Giấy có thể tái chế"),
    ("plastic", "Nhựa", "Vàng", "#e0a52f", "Chai lọ và đồ nhựa"),
    ("shoes", "Giày dép", "Xanh dương", "#6d79cc", "Giày dép đã qua sử dụng"),
    ("trash", "Rác khác", "Xám", "#555f5a", "Rác không thuộc nhóm tái chế"),
    ("white-glass", "Thủy tinh trắng", "Xanh lá", "#28a66f", "Chai lọ thủy tinh trong suốt"),
]


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
    database.executemany(
        """INSERT OR IGNORE INTO waste_categories
           (category_label, ten_loai, mau_thung, color_hex, mo_ta)
           VALUES (?, ?, ?, ?, ?)""",
        SEED_CATEGORIES,
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
