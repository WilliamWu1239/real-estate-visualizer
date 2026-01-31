from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from PIL import Image, ImageOps, ImageFilter
import io, torch, numpy as np

from pipeline import get_inpaint_pipe
from segment import router as segment_router

app = FastAPI(title="Real‑Estate Image Customizer API", version="0.1.0")

# Permissive CORS for local dev; lock down in production
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(segment_router) 

@app.get("/api/health")
def health():
    return {"ok": True}

def preprocess_mask(mask_l: Image.Image, dilate_px: int = 8, blur_px: int = 6) -> Image.Image:
    m = mask_l.convert("L")
    if dilate_px > 0:
        k = dilate_px * 2 + 1
        m = m.filter(ImageFilter.MaxFilter(size=k))
    if blur_px > 0:
        m = m.filter(ImageFilter.GaussianBlur(radius=blur_px))
    return m

def enhance_prompt(prompt: str) -> str:
    """
    Boost specific keywords (colors, materials) and append quality tags.
    """
    p = prompt.lower()
    
    # 1. Boost Colors
    colors = ["black", "white", "gray", "red", "blue", "green", "yellow", "brown", "beige", "gold", "silver"]
    dict_colors = {c: f"({c}:1.4)" for c in colors} # 1.4 is a strong boost
    
    # 2. Boost Materials
    materials = ["wood", "marble", "tile", "brick", "stone", "glass", "metal", "concrete", "fabric", "leather"]
    dict_materials = {m: f"({m}:1.3)" for m in materials}

    # Replace words in prompt
    words = p.split()
    new_words = []
    for w in words:
        # Strip punctuation for matching
        clean_w = w.strip(",.!:;")
        if clean_w in dict_colors:
            new_w = w.replace(clean_w, dict_colors[clean_w])
            new_words.append(new_w)
        elif clean_w in dict_materials:
            new_w = w.replace(clean_w, dict_materials[clean_w])
            new_words.append(new_w)
        else:
            new_words.append(w)
            
    enhanced_base = " ".join(new_words)
    
    # 3. Append Quality Suffix
    quality_suffix = ", highly detailed, professional interior design photography, 8k, realistic lighting, sharp focus, magazine quality"
    
    return enhanced_base + quality_suffix

def get_mask_bbox(mask: Image.Image) -> tuple[int, int, int, int]:
    """Get the bounding box of the mask non-zero regions."""
    bbox = mask.getbbox()
    if bbox is None:
        return (0, 0, mask.width, mask.height)
    return bbox

def pad_bbox(bbox: tuple[int, int, int, int], width: int, height: int, padding: int = 32) -> tuple[int, int, int, int]:
    """Expand bbox by padding, keeping within image bounds."""
    min_x, min_y, max_x, max_y = bbox
    min_x = max(0, min_x - padding)
    min_y = max(0, min_y - padding)
    max_x = min(width, max_x + padding)
    max_y = min(height, max_y + padding)
    return (min_x, min_y, max_x, max_y)

@app.post("/api/edit")
async def edit_image(
    image: UploadFile = File(..., description="Original image (jpg/png)"),
    prompt: str = Form(..., description="What to change/add"),
    mask: UploadFile | None = File(None, description="White=edit, black=keep (png)"),
    negative_prompt: str = Form("blurry, low quality, watermark, text, distorted",
                                description="What to avoid"),
    guidance_scale: float = Form(7.5),
    num_inference_steps: int = Form(35),
    strength: float = Form(0.65, description="How strong the edit is (0-1)"),
    seed: int | None = Form(None),
    width: int | None = Form(None),
    height: int | None = Form(None),
):
    # Read original
    img_bytes = await image.read()
    try:
        init_image = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    except Exception as e:
        return JSONResponse({"error": f"Invalid image: {e}"}, status_code=400)

    # Optional resizing
    if width and height:
        init_image = init_image.resize((int(width), int(height)), Image.LANCZOS)

    # Read mask (expects white where we want to edit)
    if mask is not None:
        mask_bytes = await mask.read()
        try:
            mask_image = Image.open(io.BytesIO(mask_bytes)).convert("L")
        except Exception as e:
            return JSONResponse({"error": f"Invalid mask: {e}"}, status_code=400)
        # Ensure same size
        if mask_image.size != init_image.size:
            mask_image = mask_image.resize(init_image.size, Image.NEAREST)
    else:
        # If no mask provided, assume full‑frame edit (all white)
        mask_image = Image.new("L", init_image.size, color=255)

    # Step 7: Post-process mask (dilate + feather) for better blending
    mask_image = preprocess_mask(mask_image, dilate_px=8, blur_px=6)

    # --- Crop-to-Mask Logic ---
    # 1. Calculate bounding box of the mask
    bbox = get_mask_bbox(mask_image)
    # 2. Pad the bbox to give context
    padded_bbox = pad_bbox(bbox, init_image.width, init_image.height, padding=64)
    # 3. Crop image and mask
    crop_image = init_image.crop(padded_bbox)
    crop_mask = mask_image.crop(padded_bbox)
    
    # --- DEBUG START: Save intermediates ---
    try:
        import os
        debug_dir = "debug_output"
        os.makedirs(debug_dir, exist_ok=True)
        crop_image.save(os.path.join(debug_dir, "last_crop_input.png"))
        crop_mask.save(os.path.join(debug_dir, "last_mask_input.png"))
        print(f"[DEBUG] Saved crop/mask to {os.path.abspath(debug_dir)}", flush=True)
    except Exception as e:
        print(f"[DEBUG] Failed to save intermediates: {e}", flush=True)
    # --- DEBUG END ---
    
    # 4. Resize for detail (optional, but requested)
    # Resize long side to 1024 for high detail in the crop
    target_size = 1024
    w, h = crop_image.size
    scale = 1.0
    if max(w, h) < target_size:
        # Only upscale if smaller, or usually we might want to scale *to* 1024 regardless?
        # Let's scale to exactly target_size on long edge for consistency
        scale = target_size / max(w, h)
        new_w = int(w * scale)
        new_h = int(h * scale)
        # Ensure divisible by 8 for VAE
        new_w = new_w - (new_w % 8)
        new_h = new_h - (new_h % 8)
        
        proc_image = crop_image.resize((new_w, new_h), Image.LANCZOS)
        proc_mask = crop_mask.resize((new_w, new_h), Image.NEAREST)
    else:
        # Ensure divisible by 8 even if not resizing
        new_w = w - (w % 8)
        new_h = h - (h % 8)
        proc_image = crop_image.crop((0, 0, new_w, new_h))
        proc_mask = crop_mask.crop((0, 0, new_w, new_h))

    pipe = get_inpaint_pipe()
    
    generator = None
    if seed is not None:
        device = pipe.device
        generator = torch.Generator(device=device).manual_seed(int(seed))

    # Run the inpainting pipeline on the CROP
    
    # Enhance prompt before sending to basic pipe
    first_prompt = enhance_prompt(prompt)
    print(f"Original Prompt: {prompt}", flush=True)
    print(f"Enhanced Prompt: {first_prompt}", flush=True)
    
    result_crop = pipe(
        prompt=first_prompt,
        image=proc_image,
        mask_image=proc_mask,
        negative_prompt=negative_prompt,
        guidance_scale=float(guidance_scale),
        num_inference_steps=int(num_inference_steps),
        generator=generator,
        strength=float(strength),
    ).images[0]

    # --- DEBUG START ---
    try:
        import os
        result_crop.save(os.path.join("debug_output", "last_result_crop.png"))
        print(f"[DEBUG] Saved result crop", flush=True)
    except Exception as e:
        print(f"[DEBUG] Failed to save result crop: {e}", flush=True)
    # --- DEBUG END ---

    # 5. Paste back

    # Resize result back to original crop size
    # Note: If we trimmed the original crop to be div-by-8, we might have lost a few pixels.
    # But usually we want to resize back to the *padded_bbox* size.
    # Let's check the size diff.
    orig_crop_w = padded_bbox[2] - padded_bbox[0]
    orig_crop_h = padded_bbox[3] - padded_bbox[1]
    
    result_crop_resized = result_crop.resize((orig_crop_w, orig_crop_h), Image.LANCZOS)
    
    # Paste into full image using the blurred mask as alpha to blend
    # This prevents seams at the square crop boundaries
    final_image = init_image.copy()
    final_image.paste(result_crop_resized, padded_bbox, mask=crop_mask)
    
    result = final_image

    # Stream PNG back
    out_buf = io.BytesIO()
    result.save(out_buf, format="PNG")
    out_buf.seek(0)
    return StreamingResponse(out_buf, media_type="image/png")
