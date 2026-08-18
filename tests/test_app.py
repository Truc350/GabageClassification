import os
import io
import tempfile
import unittest
from unittest.mock import patch
from PIL import Image


class ApiTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tempdir = tempfile.TemporaryDirectory()
        os.environ["DATABASE_PATH"] = os.path.join(cls.tempdir.name, "test.db")
        from app import app
        app.config.update(TESTING=True, REPORT_UPLOAD_FOLDER=os.path.join(cls.tempdir.name, "uploads"))
        cls.client = app.test_client()

    @classmethod
    def tearDownClass(cls):
        cls.tempdir.cleanup()

    def setUp(self):
        self.client.post("/login", data={"username": "admin", "password": "admin123"})

    def test_seeded_categories(self):
        response = self.client.get("/api/categories")
        self.assertEqual(response.status_code, 200)
        categories = response.get_json()
        self.assertEqual(len(categories), 12)
        by_label = {item["category_label"]: item for item in categories}
        self.assertEqual({item["mau_thung"] for item in categories}, {"Xanh lá", "Xanh dương", "Xám"})
        self.assertEqual(by_label["biological"]["mau_thung"], "Xanh lá")
        self.assertEqual(by_label["plastic"]["mau_thung"], "Xanh dương")
        self.assertEqual(by_label["battery"]["mau_thung"], "Xám")
        self.assertEqual(len({item["color_hex"] for item in categories}), 12)

    def test_history_and_stats_flow(self):
        created = self.client.post("/api/history", json={
            "user_id": 1,
            "category_label": "plastic",
            "confidence": 0.92,
            "timestamp": "2026-08-14T12:00:00+00:00",
        })
        self.assertEqual(created.status_code, 201)
        history = self.client.get("/api/history?user_id=1").get_json()
        self.assertTrue(any(item["category_label"] == "plastic" for item in history))
        stats = self.client.get("/api/stats").get_json()
        self.assertGreaterEqual(stats["total_recognitions"], 1)
        self.assertEqual(stats["active_users"], 1)
        self.assertEqual({item["bin_name"] for item in stats["by_bin"]}, {"Xanh lá", "Xanh dương", "Xám"})
        filtered = self.client.get("/api/stats?from=2026-08-14&to=2026-08-14").get_json()
        self.assertTrue(all(item["date"] == "2026-08-14" for item in filtered["by_day"]))

    def test_category_crud(self):
        payload = {"category_label": "test-label", "ten_loai": "Thử nghiệm", "mau_thung": "Cam", "color_hex": "#ff8800", "mo_ta": "Danh mục test"}
        created = self.client.post("/api/categories", json=payload)
        self.assertEqual(created.status_code, 201)
        category_id = created.get_json()["id"]
        payload["ten_loai"] = "Đã sửa"
        self.assertEqual(self.client.put(f"/api/categories/{category_id}", json=payload).status_code, 200)
        self.assertEqual(self.client.delete(f"/api/categories/{category_id}").status_code, 200)

    def test_validation(self):
        self.assertEqual(self.client.post("/api/history", json={"user_id": 1}).status_code, 400)
        self.assertEqual(self.client.post("/api/history", json={"user_id": 1, "category_label": "plastic", "confidence": 92}).status_code, 400)

    def test_bin_location_crud(self):
        payload = {"ten_vi_tri": "Điểm thử nghiệm", "loai_thung_list": ["Xanh lá", "Xanh dương"], "latitude": 10.87236, "longitude": 106.78984, "trang_thai": "Hoạt động", "mo_ta": ""}
        created = self.client.post("/api/bin-locations", json=payload)
        self.assertEqual(created.status_code, 201)
        location_id = created.get_json()["id"]
        location = next(item for item in self.client.get("/api/bin-locations").get_json() if item["id"] == location_id)
        self.assertEqual(location["loai_thung_list"], ["Xanh lá", "Xanh dương"])
        payload["trang_thai"] = "Bảo trì"
        self.assertEqual(self.client.put(f"/api/bin-locations/{location_id}", json=payload).status_code, 200)
        self.assertEqual(self.client.delete(f"/api/bin-locations/{location_id}").status_code, 200)

    def test_bin_location_validation(self):
        payload = {"ten_vi_tri": "Sai", "loai_thung": "Đỏ", "latitude": 10.87, "longitude": 106.79, "trang_thai": "Hoạt động"}
        self.assertEqual(self.client.post("/api/bin-locations", json=payload).status_code, 400)

    def test_admin_authentication_and_report_flow(self):
        self.client.post("/logout")
        self.assertEqual(self.client.get("/admin").status_code, 302)
        self.assertEqual(self.client.post("/api/bin-locations", json={}).status_code, 401)
        self.client.post("/login", data={"username": "admin", "password": "admin123"})
        payload = {"ten_vi_tri": "Điểm báo cáo", "loai_thung_list": ["Xám"], "latitude": 10.87236, "longitude": 106.78984, "trang_thai": "Hoạt động", "mo_ta": ""}
        location_id = self.client.post("/api/bin-locations", json=payload).get_json()["id"]
        self.client.post("/logout")
        report = self.client.post("/api/bin-reports", json={"location_id": location_id, "report_type": "Đầy", "note": "Cần kiểm tra"})
        self.assertEqual(report.status_code, 201)
        self.assertEqual(self.client.get("/api/bin-reports").status_code, 401)
        self.client.post("/login", data={"username": "admin", "password": "admin123"})
        report_id = report.get_json()["id"]
        self.assertEqual(self.client.patch(f"/api/bin-reports/{report_id}").status_code, 200)

    def test_extended_operations_and_roles(self):
        created = self.client.post("/api/users", json={"username": "staff_test", "password": "secret12", "role": "staff"})
        self.assertEqual(created.status_code, 201)
        self.assertTrue(any(item["username"] == "staff_test" for item in self.client.get("/api/users").get_json()))
        self.client.post("/logout")
        self.assertEqual(self.client.post("/login", data={"username": "staff_test", "password": "secret12"}).status_code, 302)
        self.assertEqual(self.client.get("/admin").status_code, 200)
        self.assertEqual(self.client.post("/api/users", json={"username": "blocked", "password": "secret12", "role": "viewer"}).status_code, 403)
        self.assertEqual(self.client.get("/api/export/recognitions.csv").status_code, 200)

    def test_notifications_quiz_and_report_workflow(self):
        reward = self.client.post("/api/admin/rewards", json={"name": "Quà thử nghiệm", "description": "Dùng trong kiểm thử", "points_cost": 3, "stock": 2})
        self.assertEqual(reward.status_code, 201)
        reward_id = reward.get_json()["id"]
        payload = {"ten_vi_tri": "Điểm vận hành", "loai_thung_list": ["Xám"], "latitude": 10.87236,
                   "longitude": 106.78984, "trang_thai": "Hoạt động", "mo_ta": "",
                   "last_maintenance_at": "2026-08-01", "next_maintenance_at": "2026-08-10"}
        location_id = self.client.post("/api/bin-locations", json=payload).get_json()["id"]
        self.client.post("/logout")
        image_buffer = io.BytesIO()
        Image.new("RGB", (64, 64), "white").save(image_buffer, format="PNG")
        image_buffer.seek(0)
        report = self.client.post("/api/bin-reports", data={"location_id": str(location_id), "report_type": "Hư hỏng",
                                  "note": "Nắp bị gãy", "reporter_name": "Người báo", "reporter_contact": "email@example.com",
                                  "user_id": "1", "image": (image_buffer, "damage.png")}, content_type="multipart/form-data")
        self.assertEqual(report.status_code, 201)
        quiz = self.client.post("/api/education-quiz", json={"user_id": 1, "score": 4, "total": 4})
        self.assertEqual(quiz.status_code, 201)
        self.assertEqual(quiz.get_json()["points_awarded"], 5)
        self.assertEqual(self.client.post("/api/education-quiz", json={"user_id": 1, "score": 4, "total": 4}).get_json()["points_awarded"], 0)
        redemption = self.client.post(f"/api/rewards/{reward_id}/redeem", json={"user_id": 1})
        self.assertEqual(redemption.status_code, 201)
        self.assertEqual(redemption.get_json()["balance"], 2)
        history = self.client.post("/api/history", json={"user_id": 1, "category_label": "trash", "confidence": 0.95})
        disposal = self.client.post("/api/disposals/confirm", json={"user_id": 1, "history_id": history.get_json()["id"], "location_id": location_id})
        self.assertEqual(disposal.status_code, 201)
        self.assertEqual(disposal.get_json()["points_awarded"], 1)
        self.assertEqual(self.client.post("/api/disposals/confirm", json={"user_id": 1, "history_id": history.get_json()["id"], "location_id": location_id}).status_code, 409)
        self.client.post("/login", data={"username": "admin", "password": "admin123"})
        report_id = report.get_json()["id"]
        with patch("app.get_detector") as mocked_detector:
            mocked_detector.return_value.predict.return_value = {"accepted": True, "label": "plastic", "confidence": 0.91}
            analysis = self.client.post(f"/api/bin-reports/{report_id}/analyze")
            self.assertEqual(analysis.status_code, 200)
            self.assertIn("gợi ý AI", analysis.get_json()["analysis"])
        self.assertEqual(self.client.patch(f"/api/bin-reports/{report_id}", json={"status": "Đang xử lý", "admin_note": "Đã giao nhân viên"}).status_code, 200)
        updated = next(item for item in self.client.get("/api/bin-reports").get_json() if item["id"] == report_id)
        self.assertEqual(updated["status"], "Đang xử lý")
        awarded = self.client.patch(f"/api/bin-reports/{report_id}", json={"status": "Đã xử lý", "admin_note": "Hợp lệ", "award_points": True})
        self.assertEqual(awarded.get_json()["points_awarded"], 3)
        self.assertEqual(self.client.patch(f"/api/bin-reports/{report_id}", json={"status": "Đã xử lý", "award_points": True}).get_json()["points_awarded"], 0)
        self.assertGreaterEqual(self.client.get("/api/notifications").get_json()["total"], 1)
        self.assertEqual(self.client.get("/api/export/reports.csv").status_code, 200)
        rewards = self.client.get("/api/admin/rewards").get_json()
        redemption_id = rewards["redemptions"][0]["id"]
        self.assertEqual(self.client.patch(f"/api/admin/redemptions/{redemption_id}", json={"status": "Đã nhận"}).status_code, 200)

    def test_adaptive_quiz_and_grounded_assistant(self):
        questions = self.client.get("/api/education/questions?user_id=2").get_json()
        self.assertEqual(len(questions), 4)
        self.assertTrue(all("answer" not in item for item in questions))
        known_answers = {"organic_bin": "green", "battery": "hazard", "clean_plastic": "clean", "reduce": "reuse",
                         "paper_bin": "blue", "drain_organic": "drain", "clothes": "share", "damage": "report",
                         "glass": "blue", "battery_safety": "no", "metal": "blue", "find_bin": "map"}
        answers = {item["key"]: known_answers[item["key"]] for item in questions}
        result = self.client.post("/api/education-quiz", json={"user_id": 2, "answers": answers})
        self.assertEqual(result.status_code, 201)
        self.assertEqual(result.get_json()["score"], 4)
        assistant = self.client.post("/api/assistant", json={"question": "Chai nhựa bỏ thùng nào?"})
        self.assertEqual(assistant.status_code, 200)
        self.assertIn("Xanh dương", assistant.get_json()["answer"])
        self.assertEqual(assistant.get_json()["source"], "Danh mục rác trong hệ thống")


if __name__ == "__main__":
    unittest.main()
