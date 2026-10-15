"""Bounded, in-memory streaming adapter for the pinned EdgeTAM framework.

State field names follow Meta's SAM2VideoPredictor init_state API. We replace
its file-backed frame collection with the one newest tensor, keeping only the
memory window consumed by the model. Captured frames are never written to disk.
"""
from collections import OrderedDict
import math
import os
from pathlib import Path
import sys
import time

import cv2
import numpy as np
import torch

from .shape import StaffShape
from .vision import seed_points


class OfflineBackbone(torch.nn.Module):
    """Same timm module layout as upstream, without redundant network weights.

    The complete, hash-checked EdgeTAM checkpoint supplies every backbone weight.
    Upstream requests ImageNet weights and immediately overwrites them; skip that
    request so running the app is entirely offline.
    """
    def __init__(self, name, features):
        super().__init__()
        import timm
        self.body=timm.create_model(name,pretrained=False,in_chans=3,features_only=True,
                                    out_indices=tuple(int(f.removeprefix("layer")) for f in features))
        self.channel_list=self.body.feature_info.channels()[::-1]
    def forward(self, image):
        return list(self.body(image))


class SegmentationTracker:
    name = "EdgeTAM"

    def __init__(self, checkpoint, source=None, resolution=512, device=None):
        source = Path(source or os.environ.get("KLOBFLOW_EDGETAM_SOURCE", Path.home()/".cache/klobflow/edgetam"))
        if not (source/"sam2/configs/edgetam.yaml").is_file():
            raise RuntimeError("Run motion/setup.sh to install the local EdgeTAM framework")
        sys.path.insert(0,str(source))
        os.environ.setdefault("TQDM_DISABLE","1")
        from sam2.build_sam import build_sam2_video_predictor
        self.device=torch.device(device or ("cuda" if torch.cuda.is_available() else "cpu"))
        self.resolution=resolution
        torch.set_num_threads(min(4,torch.get_num_threads()))
        self.model=build_sam2_video_predictor(
            "configs/edgetam.yaml",str(checkpoint),device=str(self.device),apply_postprocessing=False,
            hydra_overrides_extra=[f"model.image_size={resolution}",
                "model.image_encoder.trunk._target_=motion.segmentation.OfflineBackbone",
                f"model.memory_attention.layer.cross_attention.q_sizes=[{resolution//16},{resolution//16}]"],
        )
        self.window=max(self.model.num_maskmem*self.model.memory_temporal_stride_for_eval,self.model.max_obj_ptrs_in_encoder)+2
        self.reset()

    def reset(self):
        self.state=None;self.shape=None;self.index=0;self.last_time=None

    def tensor(self,image):
        rgb=cv2.cvtColor(cv2.resize(image,(self.resolution,self.resolution)),cv2.COLOR_BGR2RGB)
        value=torch.from_numpy(rgb).to(self.device).permute(2,0,1).float()/255
        return (value-torch.tensor([.485,.456,.406],device=self.device)[:,None,None])/torch.tensor([.229,.224,.225],device=self.device)[:,None,None]

    def initialize(self,image):
        height,width=image.shape[:2]
        return {"images":{0:self.tensor(image)},"num_frames":1,"offload_video_to_cpu":False,"offload_state_to_cpu":False,
                "video_height":height,"video_width":width,"device":self.device,"storage_device":self.device,
                "point_inputs_per_obj":{},"mask_inputs_per_obj":{},"cached_features":{},"constants":{},
                "obj_id_to_idx":OrderedDict(),"obj_idx_to_id":OrderedDict(),"obj_ids":[],
                "output_dict":{"cond_frame_outputs":{},"non_cond_frame_outputs":{}},
                "output_dict_per_obj":{},"temp_output_dict_per_obj":{},
                "consolidated_frame_inds":{"cond_frame_outputs":set(),"non_cond_frame_outputs":set()},
                "tracking_has_started":False,"frames_already_tracked":{}}

    @torch.inference_mode()
    def track(self,image,timestamp,seed=None):
        if not math.isfinite(timestamp) or (seed is None and self.last_time is not None and timestamp<=self.last_time):
            raise ValueError("Frames must arrive in timestamp order")
        started=time.perf_counter()
        if seed is not None:
            points=seed_points(seed)
            self.reset();self.state=self.initialize(image)
            self.shape=StaffShape(points,image.shape[1],image.shape[0],self.resolution)
            self.model.add_new_points_or_box(self.state,frame_idx=0,obj_id=1,
                points=points*[image.shape[1],image.shape[0]],labels=np.array([1,1]))
        elif self.state is None:
            raise ValueError("Select the two staff ends first")
        else:
            if image.shape[:2] != (self.state["video_height"],self.state["video_width"]):
                raise ValueError("Camera dimensions changed. Select the staff again.")
            self.index+=1;self.state["num_frames"]=self.index+1
            self.state["images"]={self.index:self.tensor(image)}
        _,_,logits=next(self.model.propagate_in_video(self.state,start_frame_idx=self.index,max_frame_num_to_track=0))
        probabilities=logits[0,0].sigmoid().float().cpu().numpy()
        mask=probabilities>.5
        presence=float(probabilities[mask].mean()) if mask.any() else 0.
        output=self.shape.update(mask,timestamp,presence)
        output.update({"time":timestamp,"model":self.name,"inferenceMs":(time.perf_counter()-started)*1000,
                       "maskConfidence":presence,"maskPixels":int(mask.sum())})
        self.last_time=timestamp
        oldest=self.index-self.window
        for outputs in [self.state["output_dict"],*self.state["output_dict_per_obj"].values()]:
            for key in list(outputs["non_cond_frame_outputs"]):
                if key<oldest:del outputs["non_cond_frame_outputs"][key]
        self.state["frames_already_tracked"]={k:v for k,v in self.state["frames_already_tracked"].items() if k==0 or k>=oldest}
        self.state["consolidated_frame_inds"]["non_cond_frame_outputs"]={k for k in self.state["consolidated_frame_inds"]["non_cond_frame_outputs"] if k>=oldest}
        return output
