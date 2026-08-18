from __future__ import annotations

import base64
import csv
import io
import os
import sqlite3
import json
import uuid
from functools import wraps
from datetime import datetime, timezone

from flask import Flask, jsonify, render_template, request, session, redirect, url_for, send_from_directory, make_response
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.utils import secure_filename
from PIL import Image

from api_client import BackendApiClient, BackendApiError
from detector import GarbageDetector
from database import get_db, init_app as init_database

app = Flask(__name__)
app.config.update(SECRET_KEY=os.getenv("SECRET_KEY", "it-challenge-local-secret-change-me"), MODEL_PATH=os.getenv("MODEL_PATH", r"E:\\work_space\\edu\\ITChallenge\\vit_garbage_tiny (1).pth"), CONFIDENCE_THRESHOLD=float(os.getenv("CONFIDENCE_THRESHOLD", "0.70")), BACKEND_API_URL=os.getenv("BACKEND_API_URL", ""), DATABASE_PATH=os.getenv("DATABASE_PATH", os.path.join(app.instance_path, "garbage.db")), REPORT_UPLOAD_FOLDER=os.getenv("REPORT_UPLOAD_FOLDER", os.path.join(app.instance_path, "report_uploads")), MAX_CONTENT_LENGTH=8 * 1024 * 1024)
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
        if session.get("role") not in ("admin", "staff", "viewer"):
            if request.path.startswith("/api/"):
                return jsonify(error="Cần đăng nhập quản trị"), 401
            return redirect(url_for("login"))
        if session.get("role") == "viewer" and request.method not in ("GET", "HEAD"):
            return jsonify(error="Tài khoản chỉ có quyền xem"), 403
        return view(*args, **kwargs)
    return wrapped


def superadmin_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if session.get("role") != "admin":
            return jsonify(error="Chỉ quản trị viên được thực hiện thao tác này"), 403
        return view(*args, **kwargs)
    return wrapped


def audit(action, entity_type, entity_id=None, details=""):
    database = get_db()
    database.execute("""INSERT INTO audit_logs (user_id, username, action, entity_type, entity_id, details)
        VALUES (?, ?, ?, ?, ?, ?)""", (session.get("user_id"), session.get("username", ""), action, entity_type, entity_id, details))


@app.get("/")
def index():
    return render_template("index.html", default_user_id=os.getenv("DEFAULT_USER_ID", "1"))


@app.get("/admin")
@admin_required
def admin():
    return render_template("admin.html", current_role=session.get("role"), current_username=session.get("username"))


@app.route("/login", methods=["GET", "POST"])
def login():
    error = ""
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        user = get_db().execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
        if user and user["role"] in ("admin", "staff", "viewer") and check_password_hash(user["password_hash"], password):
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
        "last_maintenance_at": str(data.get("last_maintenance_at", "")).strip() or None,
        "next_maintenance_at": str(data.get("next_maintenance_at", "")).strip() or None,
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
        audit("Tạo", "Danh mục rác", cursor.lastrowid, data["ten_loai"])
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
        if cursor.rowcount:
            audit("Cập nhật", "Danh mục rác", category_id, data["ten_loai"])
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
        if cursor.rowcount:
            audit("Xóa", "Danh mục rác", category_id)
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
        (ten_vi_tri, loai_thung, supported_bins, latitude, longitude, trang_thai, mo_ta, updated_at, last_maintenance_at, next_maintenance_at)
        VALUES (:ten_vi_tri, :loai_thung, :supported_bins, :latitude, :longitude, :trang_thai, :mo_ta, CURRENT_TIMESTAMP, :last_maintenance_at, :next_maintenance_at)""", data)
    audit("Tạo", "Vị trí thùng", cursor.lastrowid, data["ten_vi_tri"])
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
        trang_thai=:trang_thai, mo_ta=:mo_ta, updated_at=CURRENT_TIMESTAMP,
        last_maintenance_at=:last_maintenance_at, next_maintenance_at=:next_maintenance_at WHERE id=:id""", {**data, "id": location_id})
    audit("Cập nhật", "Vị trí thùng", location_id, data["ten_vi_tri"])
    database.commit()
    if not cursor.rowcount:
        return jsonify(error="Không tìm thấy vị trí thùng"), 404
    return jsonify(id=location_id, **data, loai_thung_list=json.loads(data["supported_bins"]))


@app.delete("/api/bin-locations/<int:location_id>")
@admin_required
def api_bin_locations_delete(location_id):
    database = get_db()
    cursor = database.execute("DELETE FROM bin_locations WHERE id=?", (location_id,))
    if cursor.rowcount:
        audit("Xóa", "Vị trí thùng", location_id)
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
        rows = database.execute("""SELECT r.*, l.ten_vi_tri, u.username AS assigned_username FROM bin_reports r
            JOIN bin_locations l ON l.id=r.location_id
            LEFT JOIN users u ON u.id=r.assigned_to
            ORDER BY CASE r.status WHEN 'Mới' THEN 0 WHEN 'Đang xử lý' THEN 1 ELSE 2 END, r.created_at DESC""").fetchall()
        return jsonify([dict(row) for row in rows])
    data = request.form if request.content_type and request.content_type.startswith("multipart/form-data") else (request.get_json(silent=True) or {})
    try:
        location_id = int(data.get("location_id"))
    except (TypeError, ValueError):
        return jsonify(error="Vị trí không hợp lệ"), 400
    report_type = str(data.get("report_type", "")).strip()
    if report_type not in ("Đầy", "Hư hỏng", "Sai vị trí"):
        return jsonify(error="Loại báo cáo không hợp lệ"), 400
    if not database.execute("SELECT id FROM bin_locations WHERE id=?", (location_id,)).fetchone():
        return jsonify(error="Không tìm thấy vị trí thùng"), 404
    image_path = None
    upload = request.files.get("image")
    if upload and upload.filename:
        try:
            raw = upload.read()
            image = Image.open(io.BytesIO(raw))
            image.verify()
            extension = (image.format or "JPEG").lower().replace("jpeg", "jpg")
            if extension not in ("jpg", "png", "webp"):
                return jsonify(error="Ảnh phải có định dạng JPG, PNG hoặc WebP"), 400
            os.makedirs(app.config["REPORT_UPLOAD_FOLDER"], exist_ok=True)
            image_path = f"{uuid.uuid4().hex}.{extension}"
            with open(os.path.join(app.config["REPORT_UPLOAD_FOLDER"], secure_filename(image_path)), "wb") as output:
                output.write(raw)
        except Exception:
            return jsonify(error="Tệp ảnh không hợp lệ"), 400
    cursor = database.execute("""INSERT INTO bin_reports
        (location_id, report_type, note, reporter_name, reporter_contact, image_path, reporter_user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)""", (location_id, report_type, str(data.get("note", "")).strip(),
        str(data.get("reporter_name", "")).strip(), str(data.get("reporter_contact", "")).strip(), image_path,
        int(data.get("user_id", 1)) if str(data.get("user_id", "1")).isdigit() else None))
    database.commit()
    return jsonify(id=cursor.lastrowid, success=True), 201


@app.patch("/api/bin-reports/<int:report_id>")
@admin_required
def api_bin_report_resolve(report_id):
    database = get_db()
    data = request.get_json(silent=True) or {}
    status = str(data.get("status", "Đã xử lý")).strip()
    if status not in ("Mới", "Đang xử lý", "Đã xử lý"):
        return jsonify(error="Trạng thái xử lý không hợp lệ"), 400
    assigned_to = data.get("assigned_to") or session.get("user_id")
    cursor = database.execute("""UPDATE bin_reports SET status=?, admin_note=?, assigned_to=?,
        resolved_at=CASE WHEN ?='Đã xử lý' THEN CURRENT_TIMESTAMP ELSE NULL END WHERE id=?""",
        (status, str(data.get("admin_note", "")).strip(), assigned_to, status, report_id))
    if cursor.rowcount:
        audit("Cập nhật", "Báo cáo sự cố", report_id, status)
    points_awarded = 0
    if cursor.rowcount and status == "Đã xử lý" and data.get("award_points"):
        report = database.execute("SELECT reporter_user_id FROM bin_reports WHERE id=?", (report_id,)).fetchone()
        if report and report["reporter_user_id"]:
            point_cursor = database.execute("""INSERT OR IGNORE INTO point_transactions
                (user_id, points, reason, source_key) VALUES (?, 3, 'Báo cáo sự cố được xác nhận', ?)""",
                (report["reporter_user_id"], f"report:{report_id}"))
            points_awarded = 3 if point_cursor.rowcount else 0
    database.commit()
    if not cursor.rowcount:
        return jsonify(error="Không tìm thấy báo cáo"), 404
    return jsonify(success=True, points_awarded=points_awarded)


@app.post("/api/disposals/confirm")
def api_disposal_confirm():
    data = request.get_json(silent=True) or {}
    try:
        user_id, history_id, location_id = int(data.get("user_id", 1)), int(data["history_id"]), int(data["location_id"])
    except (KeyError, TypeError, ValueError):
        return jsonify(error="Thông tin xác nhận không hợp lệ"), 400
    database = get_db()
    history = database.execute("""SELECT h.*, c.category_label, c.ten_loai, c.mau_thung
        FROM recognition_history h JOIN waste_categories c ON c.id=h.category_id
        WHERE h.id=? AND h.user_id=?""", (history_id, user_id)).fetchone()
    location = database.execute("SELECT * FROM bin_locations WHERE id=?", (location_id,)).fetchone()
    if not history or not location: return jsonify(error="Không tìm thấy lượt nhận diện hoặc thùng rác"), 404
    if location["trang_thai"] != "Hoạt động":
        return jsonify(error=f"Điểm thu gom đang ở trạng thái {location['trang_thai']}, chưa thể xác nhận bỏ rác"), 409
    try:
        recognized_at = datetime.fromisoformat(history["thoi_gian"].replace("Z", "+00:00"))
        if recognized_at.tzinfo is None: recognized_at = recognized_at.replace(tzinfo=timezone.utc)
    except ValueError: return jsonify(error="Thời gian nhận diện không hợp lệ"), 400
    if (datetime.now(timezone.utc) - recognized_at.astimezone(timezone.utc)).total_seconds() > 600:
        return jsonify(error="Lượt nhận diện đã quá 10 phút, vui lòng nhận diện lại"), 409
    try: supported_bins = json.loads(location["supported_bins"] or "[]")
    except (TypeError, ValueError): supported_bins = [location["loai_thung"]]
    if history["category_label"] == "battery":
        return jsonify(error="Pin phải được mang đến điểm thu gom pin hoặc chất thải nguy hại"), 409
    if history["mau_thung"] not in supported_bins:
        return jsonify(error=f"Loại rác này cần thùng {history['mau_thung']}, không phù hợp với điểm đã quét"), 409
    cursor = database.execute("""INSERT OR IGNORE INTO point_transactions
        (user_id, points, reason, source_key) VALUES (?, 1, ?, ?)""",
        (user_id, f"Bỏ {history['ten_loai']} đúng thùng tại {location['ten_vi_tri']}", f"disposal:{history_id}"))
    if not cursor.rowcount:
        return jsonify(error="Lượt bỏ rác này đã được cộng điểm"), 409
    database.commit()
    balance = database.execute("SELECT COALESCE(SUM(points),0) AS value FROM point_transactions WHERE user_id=?", (user_id,)).fetchone()["value"]
    return jsonify(success=True, points_awarded=1, balance=balance, waste_name=history["ten_loai"], location_name=location["ten_vi_tri"]), 201


@app.get("/api/bin-reports/<int:report_id>/image")
@admin_required
def api_bin_report_image(report_id):
    row = get_db().execute("SELECT image_path FROM bin_reports WHERE id=?", (report_id,)).fetchone()
    if not row or not row["image_path"]:
        return jsonify(error="Báo cáo không có ảnh"), 404
    return send_from_directory(app.config["REPORT_UPLOAD_FOLDER"], row["image_path"])


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
    from_date = request.args.get("from", "").strip()
    to_date = request.args.get("to", "").strip()
    conditions, params = [], []
    if from_date:
        conditions.append("date(substr(h.thoi_gian, 1, 10)) >= date(?)")
        params.append(from_date)
    if to_date:
        conditions.append("date(substr(h.thoi_gian, 1, 10)) <= date(?)")
        params.append(to_date)
    history_filter = f" WHERE {' AND '.join(conditions)}" if conditions else ""
    join_filter = f" AND {' AND '.join(conditions)}" if conditions else ""
    total = database.execute(f"SELECT COUNT(*) AS count FROM recognition_history h{history_filter}", params).fetchone()["count"]
    active_users = database.execute(f"SELECT COUNT(DISTINCT h.user_id) AS count FROM recognition_history h{history_filter}", params).fetchone()["count"]
    by_category = [dict(row) for row in database.execute("""SELECT c.category_label,
        c.ten_loai, c.color_hex, COUNT(h.id) AS count
        FROM waste_categories c LEFT JOIN recognition_history h ON h.category_id=c.id""" + join_filter + """
        GROUP BY c.id ORDER BY count DESC, c.id""", params).fetchall()]
    for row in by_category:
        row["percentage"] = round(row["count"] * 100 / total, 2) if total else 0
    by_day = [dict(row) for row in database.execute("""SELECT substr(h.thoi_gian, 1, 10) AS date,
        COUNT(*) AS count FROM recognition_history h""" + history_filter + """ GROUP BY substr(h.thoi_gian, 1, 10)
        ORDER BY date DESC LIMIT 30""", params).fetchall()][::-1]
    by_bin = [dict(row) for row in database.execute("""SELECT c.mau_thung AS bin_name,
        COUNT(h.id) AS count FROM waste_categories c
        LEFT JOIN recognition_history h ON h.category_id=c.id""" + join_filter + """
        GROUP BY c.mau_thung ORDER BY c.mau_thung""", params).fetchall()]
    top_problem_locations = [dict(row) for row in database.execute("""SELECT l.ten_vi_tri, COUNT(r.id) AS count
        FROM bin_locations l LEFT JOIN bin_reports r ON r.location_id=l.id
        GROUP BY l.id ORDER BY count DESC, l.id LIMIT 5""").fetchall()]
    average_resolution = database.execute("""SELECT AVG((julianday(resolved_at)-julianday(created_at))*24) AS hours
        FROM bin_reports WHERE resolved_at IS NOT NULL""").fetchone()["hours"]
    return jsonify(total_recognitions=total, active_users=active_users, by_category=by_category,
        by_day=by_day, by_bin=by_bin, top_problem_locations=top_problem_locations,
        average_resolution_hours=round(average_resolution or 0, 1))


@app.get("/api/notifications")
@admin_required
def api_notifications():
    database = get_db()
    reports = database.execute("SELECT COUNT(*) AS count FROM bin_reports WHERE status!='Đã xử lý'").fetchone()["count"]
    overdue = database.execute("""SELECT COUNT(*) AS count FROM bin_locations
        WHERE next_maintenance_at IS NOT NULL AND date(next_maintenance_at)<date('now')""").fetchone()["count"]
    full_bins = database.execute("SELECT COUNT(*) AS count FROM bin_locations WHERE trang_thai='Đầy'").fetchone()["count"]
    return jsonify(total=reports + overdue + full_bins, reports=reports, overdue_maintenance=overdue, full_bins=full_bins)


def csv_response(filename, headers, rows):
    output = io.StringIO()
    output.write('\ufeff')
    writer = csv.writer(output)
    writer.writerow(headers)
    writer.writerows(rows)
    response = make_response(output.getvalue())
    response.headers["Content-Type"] = "text/csv; charset=utf-8"
    response.headers["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response


@app.get("/api/export/reports.csv")
@admin_required
def export_reports():
    rows = get_db().execute("""SELECT r.id, l.ten_vi_tri, r.report_type, r.status, r.reporter_name,
        r.reporter_contact, r.note, r.admin_note, r.created_at, r.resolved_at
        FROM bin_reports r JOIN bin_locations l ON l.id=r.location_id ORDER BY r.created_at DESC""").fetchall()
    return csv_response("bao-cao-su-co.csv", ["ID", "Vị trí", "Loại", "Trạng thái", "Người báo", "Liên hệ", "Mô tả", "Ghi chú xử lý", "Ngày tạo", "Ngày xử lý"], rows)


@app.get("/api/export/recognitions.csv")
@admin_required
def export_recognitions():
    conditions, params = [], []
    if request.args.get("from"):
        conditions.append("date(substr(h.thoi_gian,1,10))>=date(?)"); params.append(request.args["from"])
    if request.args.get("to"):
        conditions.append("date(substr(h.thoi_gian,1,10))<=date(?)"); params.append(request.args["to"])
    where = f" WHERE {' AND '.join(conditions)}" if conditions else ""
    rows = get_db().execute("""SELECT h.id, u.username, c.ten_loai, c.mau_thung,
        h.confidence_score, h.thoi_gian FROM recognition_history h JOIN users u ON u.id=h.user_id
        JOIN waste_categories c ON c.id=h.category_id""" + where + " ORDER BY h.thoi_gian DESC", params).fetchall()
    return csv_response("lich-su-nhan-dien.csv", ["ID", "Người dùng", "Loại rác", "Thùng", "Độ tin cậy", "Thời gian"], rows)


@app.get("/api/users")
@admin_required
def api_users_list():
    rows = get_db().execute("SELECT id, username, role, created_at FROM users ORDER BY id").fetchall()
    return jsonify([dict(row) for row in rows])


@app.post("/api/users")
@superadmin_required
def api_users_create():
    data = request.get_json(silent=True) or {}
    username, password, role = str(data.get("username", "")).strip(), str(data.get("password", "")), str(data.get("role", "viewer"))
    if not username or len(password) < 6 or role not in ("admin", "staff", "viewer"):
        return jsonify(error="Tên đăng nhập, mật khẩu từ 6 ký tự và vai trò hợp lệ là bắt buộc"), 400
    try:
        database = get_db()
        cursor = database.execute("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)", (username, generate_password_hash(password), role))
        audit("Tạo", "Tài khoản", cursor.lastrowid, f"{username} - {role}")
        database.commit()
        return jsonify(id=cursor.lastrowid, username=username, role=role), 201
    except sqlite3.IntegrityError:
        return jsonify(error="Tên đăng nhập đã tồn tại"), 409


@app.put("/api/users/<int:user_id>")
@superadmin_required
def api_users_update(user_id):
    data = request.get_json(silent=True) or {}
    role, password = str(data.get("role", "")).strip(), str(data.get("password", ""))
    if role not in ("admin", "staff", "viewer"):
        return jsonify(error="Vai trò không hợp lệ"), 400
    database = get_db()
    if password:
        if len(password) < 6: return jsonify(error="Mật khẩu phải có ít nhất 6 ký tự"), 400
        cursor = database.execute("UPDATE users SET role=?, password_hash=? WHERE id=? AND role!='user'", (role, generate_password_hash(password), user_id))
    else:
        cursor = database.execute("UPDATE users SET role=? WHERE id=? AND role!='user'", (role, user_id))
    if not cursor.rowcount: return jsonify(error="Không tìm thấy tài khoản quản trị"), 404
    audit("Cập nhật", "Tài khoản", user_id, role); database.commit()
    return jsonify(success=True)


@app.get("/api/audit-logs")
@admin_required
def api_audit_logs():
    rows = get_db().execute("SELECT * FROM audit_logs ORDER BY created_at DESC, id DESC LIMIT 200").fetchall()
    return jsonify([dict(row) for row in rows])


@app.post("/api/education-quiz")
def api_education_quiz():
    data = request.get_json(silent=True) or {}
    try: score, total, user_id = int(data["score"]), int(data["total"]), int(data.get("user_id", 1))
    except (KeyError, TypeError, ValueError): return jsonify(error="Kết quả không hợp lệ"), 400
    if total <= 0 or score < 0 or score > total: return jsonify(error="Kết quả không hợp lệ"), 400
    database = get_db()
    award = 5
    source_key = f"quiz:{user_id}:{datetime.now(timezone.utc).date().isoformat()}"
    try:
        database.execute("INSERT INTO point_transactions (user_id, points, reason, source_key) VALUES (?, ?, ?, ?)",
            (user_id, award, f"Hoàn thành bài kiểm tra {score}/{total}", source_key))
    except sqlite3.IntegrityError:
        award = 0
    cursor = database.execute("INSERT INTO education_quiz_results (user_id, score, total, points_awarded) VALUES (?, ?, ?, ?)", (user_id, score, total, award))
    database.commit()
    balance = database.execute("SELECT COALESCE(SUM(points),0) AS value FROM point_transactions WHERE user_id=?", (user_id,)).fetchone()["value"]
    return jsonify(id=cursor.lastrowid, success=True, points_awarded=award, balance=balance), 201


@app.get("/api/rewards")
def api_rewards():
    try: user_id = int(request.args.get("user_id", 1))
    except ValueError: return jsonify(error="user_id không hợp lệ"), 400
    database = get_db()
    rewards = [dict(row) for row in database.execute("SELECT * FROM reward_catalog WHERE active=1 ORDER BY points_cost, id").fetchall()]
    balance = database.execute("SELECT COALESCE(SUM(points),0) AS value FROM point_transactions WHERE user_id=?", (user_id,)).fetchone()["value"]
    redemptions = [dict(row) for row in database.execute("""SELECT rr.*, rc.name FROM reward_redemptions rr
        JOIN reward_catalog rc ON rc.id=rr.reward_id WHERE rr.user_id=? ORDER BY rr.created_at DESC LIMIT 20""", (user_id,)).fetchall()]
    return jsonify(balance=balance, rewards=rewards, redemptions=redemptions)


@app.post("/api/rewards/<int:reward_id>/redeem")
def api_reward_redeem(reward_id):
    data = request.get_json(silent=True) or {}
    try: user_id = int(data.get("user_id", 1))
    except (TypeError, ValueError): return jsonify(error="user_id không hợp lệ"), 400
    database = get_db()
    database.execute("BEGIN IMMEDIATE")
    reward = database.execute("SELECT * FROM reward_catalog WHERE id=? AND active=1", (reward_id,)).fetchone()
    if not reward or (reward["stock"] is not None and reward["stock"] <= 0):
        database.rollback(); return jsonify(error="Phần quà không còn khả dụng"), 409
    balance = database.execute("SELECT COALESCE(SUM(points),0) AS value FROM point_transactions WHERE user_id=?", (user_id,)).fetchone()["value"]
    if balance < reward["points_cost"]:
        database.rollback(); return jsonify(error="Bạn chưa đủ điểm để đổi phần quà này"), 409
    code = f"WW-{uuid.uuid4().hex[:8].upper()}"
    cursor = database.execute("INSERT INTO reward_redemptions (user_id, reward_id, points_spent, code) VALUES (?, ?, ?, ?)", (user_id, reward_id, reward["points_cost"], code))
    database.execute("INSERT INTO point_transactions (user_id, points, reason, source_key) VALUES (?, ?, ?, ?)", (user_id, -reward["points_cost"], f"Đổi quà: {reward['name']}", f"redeem:{cursor.lastrowid}"))
    if reward["stock"] is not None: database.execute("UPDATE reward_catalog SET stock=stock-1 WHERE id=?", (reward_id,))
    database.commit()
    return jsonify(success=True, code=code, balance=balance-reward["points_cost"]), 201


@app.route("/api/admin/rewards", methods=["GET", "POST"])
@admin_required
def api_admin_rewards():
    database = get_db()
    if request.method == "GET":
        rewards = [dict(row) for row in database.execute("SELECT * FROM reward_catalog ORDER BY id DESC").fetchall()]
        redemptions = [dict(row) for row in database.execute("""SELECT rr.*, rc.name, u.username FROM reward_redemptions rr
            JOIN reward_catalog rc ON rc.id=rr.reward_id JOIN users u ON u.id=rr.user_id ORDER BY rr.created_at DESC""").fetchall()]
        return jsonify(rewards=rewards, redemptions=redemptions)
    data = request.get_json(silent=True) or {}
    try: cost = int(data.get("points_cost")); stock = None if data.get("stock") in (None, "") else int(data.get("stock"))
    except (TypeError, ValueError): return jsonify(error="Điểm và tồn kho không hợp lệ"), 400
    name = str(data.get("name", "")).strip()
    if not name or cost <= 0 or (stock is not None and stock < 0): return jsonify(error="Thông tin phần quà không hợp lệ"), 400
    cursor = database.execute("INSERT INTO reward_catalog (name, description, points_cost, stock) VALUES (?, ?, ?, ?)", (name, str(data.get("description", "")).strip(), cost, stock))
    audit("Tạo", "Phần quà", cursor.lastrowid, name); database.commit()
    return jsonify(id=cursor.lastrowid, success=True), 201


@app.put("/api/admin/rewards/<int:reward_id>")
@admin_required
def api_admin_reward_update(reward_id):
    data = request.get_json(silent=True) or {}
    try: cost = int(data.get("points_cost")); stock = None if data.get("stock") in (None, "") else int(data.get("stock"))
    except (TypeError, ValueError): return jsonify(error="Điểm và tồn kho không hợp lệ"), 400
    cursor = get_db().execute("UPDATE reward_catalog SET name=?, description=?, points_cost=?, stock=?, active=? WHERE id=?", (str(data.get("name", "")).strip(), str(data.get("description", "")).strip(), cost, stock, 1 if data.get("active", True) else 0, reward_id))
    if not cursor.rowcount: return jsonify(error="Không tìm thấy phần quà"), 404
    audit("Cập nhật", "Phần quà", reward_id, str(data.get("name", ""))); get_db().commit()
    return jsonify(success=True)


@app.patch("/api/admin/redemptions/<int:redemption_id>")
@admin_required
def api_redemption_update(redemption_id):
    status = str((request.get_json(silent=True) or {}).get("status", ""))
    if status not in ("Chờ nhận", "Đã nhận", "Đã hủy"): return jsonify(error="Trạng thái không hợp lệ"), 400
    database = get_db(); current = database.execute("SELECT * FROM reward_redemptions WHERE id=?", (redemption_id,)).fetchone()
    if not current: return jsonify(error="Không tìm thấy lượt đổi quà"), 404
    if status == "Đã hủy" and current["status"] != "Đã hủy":
        database.execute("INSERT OR IGNORE INTO point_transactions (user_id, points, reason, source_key) VALUES (?, ?, ?, ?)", (current["user_id"], current["points_spent"], "Hoàn điểm lượt đổi quà bị hủy", f"refund:{redemption_id}"))
        database.execute("UPDATE reward_catalog SET stock=CASE WHEN stock IS NULL THEN NULL ELSE stock+1 END WHERE id=?", (current["reward_id"],))
    database.execute("UPDATE reward_redemptions SET status=?, fulfilled_at=CASE WHEN ?='Đã nhận' THEN CURRENT_TIMESTAMP ELSE NULL END WHERE id=?", (status, status, redemption_id))
    audit("Cập nhật", "Đổi quà", redemption_id, status); database.commit()
    return jsonify(success=True)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")), debug=True)
