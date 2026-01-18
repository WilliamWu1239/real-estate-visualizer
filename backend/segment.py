# backend/segment.py
from fastapi import APIRouter, UploadFile, File
from fastapi.responses import JSONResponse
from PIL import Image
import io
import torch
import base64
import numpy as np
from transformers import DetrImageProcessor, DetrForSegmentation

router = APIRouter()

# Global variables to cache the model in memory
_processor = None
_model = None

def get_model():
    global _processor, _model
    if _model is None:
        model_name = "facebook/detr-resnet-50-panoptic"
        _processor = DetrImageProcessor.from_pretrained(model_name)
        _model = DetrForSegmentation.from_pretrained(model_name)
        
        # Use GPU if available
        device = "cuda" if torch.cuda.is_available() else "cpu"
        _model.to(device)
    
    return _processor, _model

@router.post("/api/segment")
async def segment_image(image: UploadFile = File(...), threshold: float = 0.6):
    try:
        # Load user image
        img_bytes = await image.read()
        pil_image = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    except Exception as e:
        return JSONResponse({"error": f"Invalid image: {e}"}, status_code=400)

    processor, model = get_model()
    device = model.device

    # Prepare inputs
    inputs = processor(images=pil_image, return_tensors="pt").to(device)

    # Inference
    with torch.no_grad():
        outputs = model(**inputs)

    # Post-process: convert outputs to COCO-style segmentation
    # "panoptic" returns a pixel map where each pixel value = object ID
    target_sizes = [pil_image.size[::-1]] # (height, width)
    results = processor.post_process_panoptic_segmentation(
        outputs, target_sizes=target_sizes, threshold=threshold
    )[0] 
    # results is a dict: {'segmentation': Tensor(H,W), 'segments_info': [...]}

    # The segmentation map (int32 tensor)
    seg_map = results["segmentation"].cpu().numpy()
    segments_info = results["segments_info"]

    objects = []
    
    # Iterate over each detected object
    # COCO Panoptic "stuff" mapping fallback (approximate standard indices)
    # The model config might miss these high indices
    COCO_PANOPTIC_STUFF = {
        183: "hangar", 184: "nightstand", 185: "curtain", 186: "cabinet", 187: "rug", 
        188: "table", 189: "door-stuff", 190: "shelf", 191: "wall-tile", 192: "wall-panel",
        193: "wall-wood", 194: "wall-brick", 195: "wall-stone", 196: "wall-concrete", 197: "wall-other",
        198: "ceiling-tile", 199: "ceiling-other", 200: "carpet", 201: "floor-wood", 202: "floor-tile",
        203: "floor-stone", 204: "floor-other", 205: "cupboard", 206: "counter", 207: "blinds",
        208: "mirror-stuff", 209: "stairs", 210: "pool", 211: "pillow", 212: "screen-stuff",
        213: "towel", 214: "light", 215: "sink", 216: "shower", 217: "toilet"
    }

    for info in segments_info:
        # label_id maps to a class name (e.g. 'chair')
        label_id = info["label_id"]
        label_name = model.config.id2label.get(label_id)
        if not label_name or label_name.startswith("LABEL_"):
             label_name = COCO_PANOPTIC_STUFF.get(label_id, f"unknown_{label_id}")
        
        # segment_id matches the values in seg_map
        segment_id = info["id"]
        
        # Create a boolean mask for this object
        # shape: (H, W)
        mask_bool = (seg_map == segment_id)
        
        # We need a bounding box [x, y, w, h] for the frontend
        rows, cols = np.where(mask_bool)
        if len(rows) == 0:
            continue
            
        y_min, y_max = rows.min(), rows.max()
        x_min, x_max = cols.min(), cols.max()
        bbox = [int(x_min), int(y_min), int(x_max - x_min), int(y_max - y_min)]
        
        # Create a PIL image for the mask (white on transparent)
        # We need to send a PNG base64 to frontend
        # 0 = transparent, 255 = white
        
        # Create an RGBA image: (255, 255, 255, alpha)
        # Where alpha is 255 if mask_bool is True, else 0
        h_img, w_img = mask_bool.shape
        rgba = np.zeros((h_img, w_img, 4), dtype=np.uint8)
        rgba[mask_bool, 0:3] = 255 # White color
        rgba[mask_bool, 3] = 255   # Full opacity for the object
        
        mask_img = Image.fromarray(rgba, mode="RGBA")
        
        buf = io.BytesIO()
        mask_img.save(buf, format="PNG")
        mask_b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
        
        objects.append({
            "id": int(segment_id),
            "label": label_name,
            "bbox": bbox,
            "mask_b64": mask_b64
        })

    return {"objects": objects}
