import os
import tempfile
import unittest


class ApiTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tempdir = tempfile.TemporaryDirectory()
        os.environ["DATABASE_PATH"] = os.path.join(cls.tempdir.name, "test.db")
        from app import app
        app.config.update(TESTING=True)
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


if __name__ == "__main__":
    unittest.main()
