import torch
import cv2
from PIL import Image
from transformers import ViTImageProcessor, ViTForImageClassification

device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
print(device)

classes = ['battery', 'biological', 'brown-glass', 'cardboard', 'clothes', 'green-glass', 'metal', 'paper', 'plastic', 'shoes', 'trash', 'white-glass']
processor = ViTImageProcessor.from_pretrained(
    "WinKawaks/vit-tiny-patch16-224"
)

model = ViTForImageClassification.from_pretrained(
    "WinKawaks/vit-tiny-patch16-224",
    num_labels=12,
    ignore_mismatched_sizes=True
)

state_dict = torch.load(
    "vit_garbage_tiny.pth",
    map_location=device
)

model.load_state_dict(state_dict, strict=False)

model.to(device)
model.eval()

# Webcam
cap = cv2.VideoCapture(0)

while True:
    ret, frame = cap.read()
    frame = cv2.flip(frame, 1)

    if not ret:
        break

    image = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    pil_image = Image.fromarray(image)

    inputs = processor(images=pil_image, return_tensors="pt").to(device)

    with torch.no_grad():
        outputs = model(**inputs)

    logits = outputs.logits

    probs = torch.softmax(logits, dim=-1)
    pred = logits.argmax(-1).item()

    confidence = probs[0][pred].item() * 100

    label = classes[pred]

    cv2.putText(
        frame,
        f"{label} ({confidence:.2f}%)",
        (20, 50),
        cv2.FONT_HERSHEY_SIMPLEX,
        1,
        (0, 255, 0),
        2
    )

    cv2.imshow("Garbage Classification", frame)

    if cv2.waitKey(1) & 0xFF == ord("q"):
        break

cap.release()
cv2.destroyAllWindows()