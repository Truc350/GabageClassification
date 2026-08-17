"""Legacy OpenCV interface. The web interface is available through app.py."""

import os

import cv2
from PIL import Image

from detector import GarbageDetector


detector = GarbageDetector(
    os.getenv("MODEL_PATH", "vit_garbage_tiny (1).pth"),
    float(os.getenv("CONFIDENCE_THRESHOLD", "0.70")),
)
print("DEVICE:", detector.device)
print("MODEL LOADED SUCCESSFULLY")

camera = cv2.VideoCapture(0)

while True:
    available, frame = camera.read()
    if not available:
        break

    frame = cv2.flip(frame, 1)
    height, width, _ = frame.shape
    crop_size = int(min(height, width) * 0.8)
    center_x, center_y = width // 2, height // 2
    x1, y1 = center_x - crop_size // 2, center_y - crop_size // 2
    x2, y2 = center_x + crop_size // 2, center_y + crop_size // 2

    crop = frame[y1:y2, x1:x2]
    rgb = cv2.cvtColor(crop, cv2.COLOR_BGR2RGB)
    result = detector.predict(Image.fromarray(rgb))

    label = result["label"]
    confidence = result["confidence"] * 100
    color = (0, 255, 0) if result["accepted"] else (0, 180, 255)

    cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
    cv2.putText(
        frame,
        f"{label} ({confidence:.2f}%)",
        (20, 50),
        cv2.FONT_HERSHEY_SIMPLEX,
        1,
        color,
        2,
    )
    cv2.imshow("Garbage Classification", frame)
    if cv2.waitKey(1) & 0xFF == ord("q"):
        break

camera.release()
cv2.destroyAllWindows()
