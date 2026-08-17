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


if __name__ == "__main__":
    unittest.main()
