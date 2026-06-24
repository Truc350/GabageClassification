import torch
import cv2

from PIL import Image

from transformers import (
    ViTImageProcessor,
    ViTForImageClassification
)
device = torch.device(
    "cuda" if torch.cuda.is_available() else "cpu"
)
print("DEVICE:", device)
classes = [
    'battery',
    'biological',
    'brown-glass',
    'cardboard',
    'clothes',
    'green-glass',
    'metal',
    'paper',
    'plastic',
    'shoes',
    'trash',
    'white-glass'
]
processor = ViTImageProcessor.from_pretrained(
    "WinKawaks/vit-tiny-patch16-224"
)
model = ViTForImageClassification.from_pretrained(
    "WinKawaks/vit-tiny-patch16-224",
    num_labels=12,
    ignore_mismatched_sizes=True
)
state_dict = torch.load(
    "vit_garbage_tiny (1).pth",
    map_location=device
)

model.load_state_dict(
    state_dict,
    strict=False
)
print("MODEL LOADED SUCCESSFULLY")
model.to(device)
model.eval()
cap = cv2.VideoCapture(0)

while True:

    ret, frame = cap.read()

    if not ret:
        break

    frame = cv2.flip(frame, 1)
    h, w, _ = frame.shape

    crop_size = int(min(h, w) * 0.8)

    cx = w // 2
    cy = h // 2

    x1 = cx - crop_size // 2
    y1 = cy - crop_size // 2

    x2 = cx + crop_size // 2
    y2 = cy + crop_size // 2

    frame_crop = frame[
        y1:y2,
        x1:x2
    ]
    rgb = cv2.cvtColor(
        frame_crop,
        cv2.COLOR_BGR2RGB
    )

    pil_image = Image.fromarray(rgb)
    inputs = processor(
        images=pil_image,
        return_tensors="pt"
    ).to(device)
    with torch.no_grad():

        outputs = model(**inputs)

    logits = outputs.logits
    probs = torch.softmax(
        logits,
        dim=-1
    )

    pred = logits.argmax(-1).item()

    confidence = probs[
        0,
        pred
    ].item() * 100
    if confidence < 70:
        label = "Unknown"

    label = classes[pred]
    cv2.rectangle(
        frame,
        (x1, y1),
        (x2, y2),
        (0, 255, 0),
        2
    )
    cv2.putText(
        frame,
        f"{label} ({confidence:.2f}%)",
        (20, 50),
        cv2.FONT_HERSHEY_SIMPLEX,
        1,
        (0, 255, 0),
        2
    )
    cv2.imshow(
        "Garbage Classification",
        frame
    )
    if cv2.waitKey(1) & 0xFF == ord("q"):
        break

cap.release()
cv2.destroyAllWindows()