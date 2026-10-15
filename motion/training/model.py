"""Small pretrained vision backbone plus a learned physical-tip classifier.

The score distinguishes a visible tip from a mask/occlusion boundary. It is
not a calibrated probability of tracking accuracy and does not locate hidden
ends. Runtime construction never downloads weights.
"""
import cv2
import numpy as np
import torch
from torch import nn
from torchvision.models import MobileNet_V3_Small_Weights, mobilenet_v3_small

from .data import aligned_crop


class TipFeatures(nn.Module):
    def __init__(self, pretrained=False):
        super().__init__()
        self.backbone = mobilenet_v3_small(weights=MobileNet_V3_Small_Weights.IMAGENET1K_V1 if pretrained else None).features
        self.pool = nn.AdaptiveAvgPool2d(1)
        self.register_buffer("mean", torch.tensor([.485, .456, .406]).reshape(1,3,1,1))
        self.register_buffer("std", torch.tensor([.229, .224, .225]).reshape(1,3,1,1))

    def forward(self, crops):
        return self.pool(self.backbone((crops-self.mean)/self.std)).flatten(1)


def candidate_crops(image, point, inward, length, size=224):
    return [aligned_crop(image, point, inward, length, size, .45)]


def tensor_crops(crops, device):
    rgb = np.stack([cv2.cvtColor(c, cv2.COLOR_BGR2RGB) for c in crops])
    return torch.from_numpy(rgb).to(device).permute(0,3,1,2).float()/255


class TipClassifier(nn.Module):
    def __init__(self):
        super().__init__()
        self.features = TipFeatures()
        self.register_buffer("center", torch.zeros(576))
        self.register_buffer("scale", torch.ones(576))
        self.head = nn.Linear(576, 1)

    def forward(self, crops):
        features = self.features(crops)
        return self.head((features-self.center)/self.scale).flatten()

    @classmethod
    def load(cls, path, device="cpu"):
        checkpoint = torch.load(path, map_location="cpu", weights_only=True)
        if checkpoint.get("format") != "klobflow-tip-v2":
            raise ValueError("Unsupported tip checkpoint")
        model = cls()
        model.load_state_dict(checkpoint["state_dict"], strict=True)
        return model.to(device).eval(), checkpoint["metadata"]

    @torch.inference_mode()
    def score(self, image, boundaries, length):
        points = np.asarray(boundaries, float)
        delta = points[1]-points[0]
        crops = []
        for i in range(2):
            crops.extend(candidate_crops(image, points[i], delta if i == 0 else -delta, length))
        # Rank logits directly. Sigmoid can round two strong scores to the same
        # float32 value and lose the very distinction this head supplies.
        return self(tensor_crops(crops, self.center.device)).cpu().numpy()
