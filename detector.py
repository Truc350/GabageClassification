from __future__ import annotations

import threading
from pathlib import Path

import torch
from PIL import Image
from transformers import ViTConfig, ViTForImageClassification, ViTImageProcessor

CLASSES = ["battery", "biological", "brown-glass", "cardboard", "clothes", "green-glass", "metal", "paper", "plastic", "shoes", "trash", "white-glass"]


class GarbageDetector:
    def __init__(self, model_path: str, confidence_threshold: float = 0.70):
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.threshold = confidence_threshold
        self._lock = threading.Lock()
        model_path = Path(model_path)

        # Recommended export from Kaggle: model.save_pretrained() and
        # processor.save_pretrained() in the same directory. This preserves
        # the architecture, normalization and label order exactly.
        if model_path.is_dir():
            self.processor = ViTImageProcessor.from_pretrained(
                model_path, local_files_only=True
            )
            self.model = ViTForImageClassification.from_pretrained(
                model_path, local_files_only=True
            )
            self.classes = [
                self.model.config.id2label[index]
                for index in range(self.model.config.num_labels)
            ]
            self.model.to(self.device).eval()
            return

        # Backward compatibility for the current ViT Tiny state_dict.
        config = ViTConfig(image_size=224, patch_size=16, num_channels=3, hidden_size=192, num_hidden_layers=12, num_attention_heads=3, intermediate_size=768, num_labels=len(CLASSES), id2label=dict(enumerate(CLASSES)), label2id={v: k for k, v in enumerate(CLASSES)})
        self.processor = ViTImageProcessor(size={"height": 224, "width": 224}, do_resize=True, do_rescale=True, do_normalize=True, image_mean=[0.5] * 3, image_std=[0.5] * 3)
        self.model = ViTForImageClassification(config)
        state = torch.load(model_path, map_location=self.device)
        if isinstance(state, dict) and "state_dict" in state:
            state = state["state_dict"]
        state = self._upgrade_transformers_v4_keys(state)
        self.model.load_state_dict(state, strict=True)
        self.classes = CLASSES
        self.model.to(self.device).eval()

    @staticmethod
    def _upgrade_transformers_v4_keys(state: dict) -> dict:
        """Map ViT v4 checkpoint names to the Transformers v5 module layout."""
        replacements = (
            ("vit.encoder.layer.", "vit.layers."),
            (".attention.attention.query.", ".attention.q_proj."),
            (".attention.attention.key.", ".attention.k_proj."),
            (".attention.attention.value.", ".attention.v_proj."),
            (".attention.output.dense.", ".attention.o_proj."),
            (".intermediate.dense.", ".mlp.fc1."),
            (".output.dense.", ".mlp.fc2."),
        )
        upgraded = {}
        for key, value in state.items():
            for old, new in replacements:
                key = key.replace(old, new)
            upgraded[key] = value
        return upgraded

    def predict(self, image: Image.Image) -> dict:
        inputs = self.processor(images=image.convert("RGB"), return_tensors="pt").to(self.device)
        with self._lock, torch.inference_mode():
            probabilities = torch.softmax(self.model(**inputs).logits, dim=-1)
            confidence, prediction = probabilities.max(dim=-1)
        score = confidence.item()
        raw_label = self.classes[prediction.item()]
        return {"label": raw_label if score >= self.threshold else "unknown", "raw_label": raw_label, "confidence": round(score, 4), "accepted": score >= self.threshold}
