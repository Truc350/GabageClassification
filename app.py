from __future__ import annotations

import base64
import io
import os
import sqlite3
import json
from functools import wraps
from datetime import datetime, timezone

from flask import Flask, jsonify, render_template, request, session, redirect, url_for
from werkzeug.security import check_password_hash
from PIL import Image

from api_client import BackendApiClient, BackendApiError
from detector import GarbageDetector
from database import get_db, init_app as init_database

app = Flask(__name__)
app.config.update(SECRET_KEY=os.getenv("SECRET_KEY", "it-challenge-local-secret-change-me"), MODEL_PATH=os.getenv("MODEL_PATH", r"E:\work_space\edu\ITChallenge\vit_garbage_tiny (1).pth"), CONFIDENCE_THRESHOLD=float(os.getenv("CONFIDENCE_THRESHOLD", "0.70")), BACKEND_API_URL=os.getenv("BACKEND_API_URL", ""), DATABASE_PATH=os.getenv("DATABASE_PATH", os.path.join(app.instance_path, "garbage.db")))
init_database(app)
detector = None


def get_detector():
    global detector
    if detector is None:
        detector = GarbageDetector(app.config["MODEL_PATH"], app.config["CONFIDENCE_THRESHOLD"])
    return detector


def backend():
    return BackendApiClient(app.config["BACKEND_API_URL"]) if app.config["BACKEND_API_URL"] else None


def admin_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if session.get("role") != "admin":
            if request.path.startswith("/api/"):
                return jsonify(error="Cần đăng nhập quản trị"), 401
            return redirect(url_for("login"))
        return view(*args, **kwargs)
    return wrapped


@app.get("/")
def index():
    return render_template("index.html", default_user_id=os.getenv("DEFAULT_USER_ID", "1"))


@app.get("/admin")
@admin_required
def admin():
    return render_template("admin.html")


@app.route("/login", methods=["GET", "POST"])
def login():
    error = ""
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        user = get_db().execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
        if user and user["role"] == "admin" and check_password_hash(user["password_hash"], password):
            session.clear()
            session.update(user_id=user["id"], username=user["username"], role=user["role"])
            return redirect(url_for("admin"))
        error = "Tên đăng nhập hoặc mật khẩu không đúng"
    return render_template("login.html", error=error)


@app.post("/logout")
def logout():
    session.clear()
    return redirect(url_for("index"))


@app.post("/api/detect")
def detect():
    encoded = (request.get_json(silent=True) or {}).get("image", "")
    if not encoded:
        return jsonify(error="Thiếu ảnh webcam"), 400
    try:
        image = Image.open(io.BytesIO(base64.b64decode(encoded.split(",", 1)[-1])))
        return jsonify(get_detector().predict(image))
    except Exception as exc:
        app.logger.exception("Detection failed")
        return jsonify(error=f"Không thể nhận diện ảnh: {exc}"), 500


@app.get("/bridge/categories")
def categories():
    client = backend()
    if not client:
        return api_categories_list()
    try:
        return jsonify(client.categories())
    except BackendApiError as exc:
        return jsonify(error=str(exc)), 502


@app.route("/bridge/history", methods=["GET", "POST"])
def history():
    client = backend()
    if not client:
        return api_history()
    try:
        if request.method == "GET":
            return jsonify(client.history(int(request.args.get("user_id", 1))))
        data = request.get_json(silent=True) or {}
        if any(key not in data for key in ("user_id", "category_label", "confidence")):
            return jsonify(error="Thiếu user_id, category_label hoặc confidence"), 400
        return jsonify(client.save_history(data)), 201
    except (BackendApiError, TypeError, ValueError) as exc:
        return jsonify(error=str(exc)), 502


def category_payload(data):
    return {
        "category_label": str(data.get("category_label", "")).strip(),
        "ten_loai": str(data.get("ten_loai", "")).strip(),
        "mau_thung": str(data.get("mau_thung", "")).strip(),
        "color_hex": str(data.get("color_hex", "#16835b")).strip(),
        "mo_ta": str(data.get("mo_ta", "")).strip(),
    }


def bin_location_payload(data):
    try:
        latitude = float(data.get("latitude"))
        longitude = float(data.get("longitude"))
    except (TypeError, ValueError):
        raise ValueError("Tọa độ không hợp lệ")
    raw_bins = data.get("loai_thung_list", data.get("loai_thung", []))
    bins = [raw_bins] if isinstance(raw_bins, str) else list(raw_bins or [])
    bins = list(dict.fromkeys(str(value).strip() for value in bins if str(value).strip()))
    return {
        "ten_vi_tri": str(data.get("ten_vi_tri", "")).strip(),
        "loai_thung": bins[0] if bins else "",
        "supported_bins": json.dumps(bins, ensure_ascii=False),
        "latitude": latitude,
        "longitude": longitude,
        "trang_thai": str(data.get("trang_thai", "Hoạt động")).strip(),
        "mo_ta": str(data.get("mo_ta", "")).strip(),
    }


def validate_bin_location(data):
    if not data["ten_vi_tri"]:
        return "Tên vị trí là bắt buộc"
    try:
        bins = json.loads(data["supported_bins"])
    except (TypeError, ValueError):
        bins = []
    if not bins or any(value not in ("Xanh lá", "Xanh dương", "Xám") for value in bins):
        return "Loại thùng không hợp lệ"
    if data["trang_thai"] not in ("Hoạt động", "Đầy", "Bảo trì"):
        return "Trạng thái không hợp lệ"
    if not -90 <= data["latitude"] <= 90 or not -180 <= data["longitude"] <= 180:
        return "Tọa độ nằm ngoài phạm vi cho phép"
    return None


@app.route("/api/categories", methods=["GET"], endpoint="api_categories_list")
def api_categories_list():
    rows = get_db().execute("SELECT * FROM waste_categories ORDER BY id").fetchall()
    return jsonify([dict(row) for row in rows])


@app.post("/api/categories")
@admin_required
def api_categories_create():
    data = category_payload(request.get_json(silent=True) or {})
    if not data["category_label"] or not data["ten_loai"] or not data["mau_thung"]:
        return jsonify(error="Nhãn, tên loại và màu thùng là bắt buộc"), 400
    try:
        database = get_db()
        cursor = database.execute("""INSERT INTO waste_categories
            (category_label, ten_loai, mau_thung, color_hex, mo_ta)
            VALUES (:category_label, :ten_loai, :mau_thung, :color_hex, :mo_ta)""", data)
        database.commit()
        return jsonify(id=cursor.lastrowid, **data), 201
    except sqlite3.IntegrityError:
        return jsonify(error="Nhãn model đã tồn tại"), 409


@app.put("/api/categories/<int:category_id>")
@admin_required
def api_categories_update(category_id):
    data = category_payload(request.get_json(silent=True) or {})
    if not data["category_label"] or not data["ten_loai"] or not data["mau_thung"]:
        return jsonify(error="Nhãn, tên loại và màu thùng là bắt buộc"), 400
    try:
        database = get_db()
        cursor = database.execute("""UPDATE waste_categories SET
            category_label=:category_label, ten_loai=:ten_loai,
            mau_thung=:mau_thung, color_hex=:color_hex, mo_ta=:mo_ta
            WHERE id=:id""", {**data, "id": category_id})
        database.commit()
        if not cursor.rowcount:
            return jsonify(error="Không tìm thấy danh mục"), 404
        return jsonify(id=category_id, **data)
    except sqlite3.IntegrityError:
        return jsonify(error="Nhãn model đã tồn tại"), 409


@app.delete("/api/categories/<int:category_id>")
@admin_required
def api_categories_delete(category_id):
    try:
        database = get_db()
        cursor = database.execute("DELETE FROM waste_categories WHERE id=?", (category_id,))
        database.commit()
        if not cursor.rowcount:
            return jsonify(error="Không tìm thấy danh mục"), 404
        return jsonify(success=True)
    except sqlite3.IntegrityError:
        return jsonify(error="Không thể xóa danh mục đã có lịch sử nhận diện"), 409


@app.get("/api/bin-locations")
def api_bin_locations_list():
    rows = get_db().execute("SELECT * FROM bin_locations ORDER BY id").fetchall()
    result = []
    for row in rows:
        item = dict(row)
        try:
            item["loai_thung_list"] = json.loads(item.pop("supported_bins") or "[]")
        except (TypeError, ValueError):
            item["loai_thung_list"] = [item["loai_thung"]]
        result.append(item)
    return jsonify(result)


@app.post("/api/bin-locations")
@admin_required
def api_bin_locations_create():
    try:
        data = bin_location_payload(request.get_json(silent=True) or {})
    except ValueError as exc:
        return jsonify(error=str(exc)), 400
    error = validate_bin_location(data)
    if error:
        return jsonify(error=error), 400
    database = get_db()
    cursor = database.execute("""INSERT INTO bin_locations
        (ten_vi_tri, loai_thung, supported_bins, latitude, longitude, trang_thai, mo_ta, updated_at)
        VALUES (:ten_vi_tri, :loai_thung, :supported_bins, :latitude, :longitude, :trang_thai, :mo_ta, CURRENT_TIMESTAMP)""", data)
    database.commit()
    return jsonify(id=cursor.lastrowid, **data, loai_thung_list=json.loads(data["supported_bins"])), 201


@app.put("/api/bin-locations/<int:location_id>")
@admin_required
def api_bin_locations_update(location_id):
    try:
        data = bin_location_payload(request.get_json(silent=True) or {})
    except ValueError as exc:
        return jsonify(error=str(exc)), 400
    error = validate_bin_location(data)
    if error:
        return jsonify(error=error), 400
    database = get_db()
    cursor = database.execute("""UPDATE bin_locations SET
        ten_vi_tri=:ten_vi_tri, loai_thung=:loai_thung,
        supported_bins=:supported_bins,
        latitude=:latitude, longitude=:longitude,
        trang_thai=:trang_thai, mo_ta=:mo_ta, updated_at=CURRENT_TIMESTAMP WHERE id=:id""", {**data, "id": location_id})
    database.commit()
    if not cursor.rowcount:
        return jsonify(error="Không tìm thấy vị trí thùng"), 404
    return jsonify(id=location_id, **data, loai_thung_list=json.loads(data["supported_bins"]))


@app.delete("/api/bin-locations/<int:location_id>")
@admin_required
def api_bin_locations_delete(location_id):
    database = get_db()
    cursor = database.execute("DELETE FROM bin_locations WHERE id=?", (location_id,))
    database.commit()
    if not cursor.rowcount:
        return jsonify(error="Không tìm thấy vị trí thùng"), 404
    return jsonify(success=True)


@app.route("/api/bin-reports", methods=["GET", "POST"])
def api_bin_reports():
    database = get_db()
    if request.method == "GET":
        if session.get("role") != "admin":
            return jsonify(error="Cần đăng nhập quản trị"), 401
        rows = database.execute("""SELECT r.*, l.ten_vi_tri FROM bin_reports r
            JOIN bin_locations l ON l.id=r.location_id
            ORDER BY CASE r.status WHEN 'Mới' THEN 0 ELSE 1 END, r.created_at DESC""").fetchall()
        return jsonify([dict(row) for row in rows])
    data = request.get_json(silent=True) or {}
    try:
        location_id = int(data.get("location_id"))
    except (TypeError, ValueError):
        return jsonify(error="Vị trí không hợp lệ"), 400
    report_type = str(data.get("report_type", "")).strip()
    if report_type not in ("Đầy", "Hư hỏng", "Sai vị trí"):
        return jsonify(error="Loại báo cáo không hợp lệ"), 400
    if not database.execute("SELECT id FROM bin_locations WHERE id=?", (location_id,)).fetchone():
        return jsonify(error="Không tìm thấy vị trí thùng"), 404
    cursor = database.execute("INSERT INTO bin_reports (location_id, report_type, note) VALUES (?, ?, ?)", (location_id, report_type, str(data.get("note", "")).strip()))
    database.commit()
    return jsonify(id=cursor.lastrowid, success=True), 201


@app.patch("/api/bin-reports/<int:report_id>")
@admin_required
def api_bin_report_resolve(report_id):
    database = get_db()
    cursor = database.execute("UPDATE bin_reports SET status='Đã xử lý', resolved_at=CURRENT_TIMESTAMP WHERE id=?", (report_id,))
    database.commit()
    if not cursor.rowcount:
        return jsonify(error="Không tìm thấy báo cáo"), 404
    return jsonify(success=True)


@app.route("/api/history", methods=["GET", "POST"])
def api_history():
    database = get_db()
    if request.method == "GET":
        try:
            user_id = int(request.args.get("user_id", 1))
        except ValueError:
            return jsonify(error="user_id không hợp lệ"), 400
        rows = database.execute("""SELECT h.id, h.user_id, c.id AS category_id,
            c.category_label, c.ten_loai, c.mau_thung, c.color_hex,
            h.confidence_score, h.thoi_gian
            FROM recognition_history h JOIN waste_categories c ON c.id=h.category_id
            WHERE h.user_id=? ORDER BY h.thoi_gian DESC LIMIT 500""", (user_id,)).fetchall()
        return jsonify([dict(row) for row in rows])

    data = request.get_json(silent=True) or {}
    try:
        user_id = int(data["user_id"])
        confidence = float(data["confidence"])
        label = str(data["category_label"])
    except (KeyError, TypeError, ValueError):
        return jsonify(error="user_id, category_label và confidence không hợp lệ"), 400
    if not 0 <= confidence <= 1:
        return jsonify(error="confidence phải nằm trong khoảng 0 đến 1"), 400
    category = database.execute("SELECT id FROM waste_categories WHERE category_label=?", (label,)).fetchone()
    user = database.execute("SELECT id FROM users WHERE id=?", (user_id,)).fetchone()
    if not category:
        return jsonify(error="Nhãn không tồn tại trong danh mục"), 404
    if not user:
        return jsonify(error="Người dùng không tồn tại"), 404
    timestamp = data.get("timestamp") or datetime.now(timezone.utc).isoformat()
    cursor = database.execute("""INSERT INTO recognition_history
        (user_id, category_id, confidence_score, thoi_gian) VALUES (?, ?, ?, ?)""",
        (user_id, category["id"], confidence, timestamp))
    database.commit()
    return jsonify(id=cursor.lastrowid, user_id=user_id, category_label=label, confidence=confidence, timestamp=timestamp), 201


@app.get("/api/stats")
def api_stats():
    database = get_db()
    total = database.execute("SELECT COUNT(*) AS count FROM recognition_history").fetchone()["count"]
    active_users = database.execute("SELECT COUNT(DISTINCT user_id) AS count FROM recognition_history").fetchone()["count"]
    by_category = [dict(row) for row in database.execute("""SELECT c.category_label,
        c.ten_loai, c.color_hex, COUNT(h.id) AS count
        FROM waste_categories c LEFT JOIN recognition_history h ON h.category_id=c.id
        GROUP BY c.id ORDER BY count DESC, c.id""").fetchall()]
    for row in by_category:
        row["percentage"] = round(row["count"] * 100 / total, 2) if total else 0
    by_day = [dict(row) for row in database.execute("""SELECT substr(thoi_gian, 1, 10) AS date,
        COUNT(*) AS count FROM recognition_history GROUP BY substr(thoi_gian, 1, 10)
        ORDER BY date DESC LIMIT 30""").fetchall()][::-1]
    by_bin = [dict(row) for row in database.execute("""SELECT c.mau_thung AS bin_name,
        COUNT(h.id) AS count FROM waste_categories c
        LEFT JOIN recognition_history h ON h.category_id=c.id
        GROUP BY c.mau_thung ORDER BY c.mau_thung""").fetchall()]
    return jsonify(total_recognitions=total, active_users=active_users, by_category=by_category, by_day=by_day, by_bin=by_bin)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")), debug=True)
