# Module Nguoi dung

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
$env:DEFAULT_USER_ID="1"
.\.venv\Scripts\python.exe app.py
```

Mo `http://localhost:5000` de nhan dien va `http://localhost:5000/admin` de vao
dashboard quan tri. SQLite duoc tao tu dong tai `instance/garbage.db` va seed du
12 nhan model. Confidence duoc gui trong khoang 0 den 1.

Tai khoan seed: `demo / demo123` va `admin / admin123`. Phan dang nhap chua bat
buoc; cac tai khoan san sang cho buoc them xac thuc.

## Dung model moi xuat tu Kaggle

Tai ca thu muc tao boi `model.save_pretrained()` va
`processor.save_pretrained()` vao project, vi du `models/vit_garbage_model`.
Sau do chay:

```powershell
$env:MODEL_PATH="vit_garbage_model"
.\.venv\Scripts\python.exe app.py
```

Khong doi ten checkpoint ViT Base thanh `tiny`. Thu muc model phai chua ca
config model, trong so, mapping nhan va `preprocessor_config.json`.
