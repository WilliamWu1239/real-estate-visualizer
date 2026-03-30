from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from PIL import Image, ImageFilter
import io, json, base64, asyncio, torch

from pipeline import get_inpaint_pipe
from segment import router as segment_router

app = FastAPI(title="Real‑Estate Image Customizer API", version="0.1.0")

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
    p = prompt.lower()
    colors = ["black", "white", "gray", "red", "blue", "green", "yellow", "brown", "beige", "gold", "silver"]
    materials = ["wood", "marble", "tile", "brick", "stone", "glass", "metal", "concrete", "fabric", "leather"]
    boosts = {c: f"({c}:1.4)" for c in colors}
    boosts.update({m: f"({m}:1.3)" for m in materials})
    words = p.split()
    new_words = []
    for w in words:
        clean_w = w.strip(",.!:;")
        new_words.append(w.replace(clean_w, boosts[clean_w]) if clean_w in boosts else w)
    quality_suffix = ", highly detailed, professional interior design photography, 8k, realistic lighting, sharp focus, magazine quality"
    return " ".join(new_words) + quality_suffix


def get_mask_bbox(mask: Image.Image) -> tuple[int, int, int, int]:
    bbox = mask.getbbox()
    return bbox if bbox is not None else (0, 0, mask.width, mask.height)


def pad_bbox(bbox: tuple[int, int, int, int], width: int, height: int, padding: int = 32) -> tuple[int, int, int, int]:
    min_x, min_y, max_x, max_y = bbox
    return (
        max(0, min_x - padding),
        max(0, min_y - padding),
        min(width, max_x + padding),
        min(height, max_y + padding),
    )


def mask_coverage(mask: Image.Image) -> float:
    """Return fraction of non-zero pixels in the mask (0.0 – 1.0)."""
    import numpy as np
    arr = np.array(mask.convert("L"))
    return float((arr > 128).sum()) / max(arr.size, 1)


def adaptive_steps(base_steps: int, coverage: float, strength: float) -> int:
    """
    Reduce inference steps based on mask size and edit strength.
    High-strength ops (removal) need more steps than regular edits at the same
    mask size since they generate from near-noise, but still benefit from reduction
    on small masks.
    """
    if strength >= 0.9:
        # Removal / heavy fills: gentler reduction — needs enough steps to converge from noise
        if coverage < 0.05:
            return max(18, round(base_steps * 0.57))   # < 5%  → ~20 steps at default 35
        if coverage < 0.15:
            return max(22, round(base_steps * 0.74))   # < 15% → ~26 steps at default 35
        return base_steps
    else:
        # Regular edits: aggressive reduction is safe since model starts closer to the answer
        if coverage < 0.05:
            return max(10, round(base_steps * 0.40))   # < 5%  → ~14 steps
        if coverage < 0.15:
            return max(12, round(base_steps * 0.55))   # < 15% → ~19 steps
        return base_steps


@app.post("/api/edit")
async def edit_image(
    image: UploadFile = File(...),
    prompt: str = Form(...),
    mask: UploadFile | None = File(None),
    negative_prompt: str = Form("blurry, low quality, watermark, text, distorted"),
    guidance_scale: float = Form(7.5),
    num_inference_steps: int = Form(35),
    strength: float = Form(0.65),
    seed: int | None = Form(None),
    width: int | None = Form(None),
    height: int | None = Form(None),
):
    # --- Read inputs ---
    img_bytes = await image.read()
    try:
        init_image = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    except Exception as e:
        return JSONResponse({"error": f"Invalid image: {e}"}, status_code=400)

    if width and height:
        init_image = init_image.resize((int(width), int(height)), Image.LANCZOS)

    if mask is not None:
        mask_bytes = await mask.read()
        try:
            mask_image = Image.open(io.BytesIO(mask_bytes)).convert("L")
        except Exception as e:
            return JSONResponse({"error": f"Invalid mask: {e}"}, status_code=400)
        if mask_image.size != init_image.size:
            mask_image = mask_image.resize(init_image.size, Image.NEAREST)
    else:
        mask_image = Image.new("L", init_image.size, color=255)

    mask_image = preprocess_mask(mask_image, dilate_px=8, blur_px=6)

    # --- Adaptive steps based on mask coverage ---
    coverage = mask_coverage(mask_image)
    effective_step_count = adaptive_steps(int(num_inference_steps), coverage, float(strength))
    print(f"[INFO] Mask coverage: {coverage:.1%}, strength: {strength} → using {effective_step_count} steps", flush=True)

    # --- Crop to mask bounding box ---
    bbox = get_mask_bbox(mask_image)
    padded_bbox = pad_bbox(bbox, init_image.width, init_image.height, padding=64)
    crop_image = init_image.crop(padded_bbox)
    crop_mask = mask_image.crop(padded_bbox)

    # --- Resize crop to 512 (SD 1.5 native resolution, 4× faster than 1024) ---
    TARGET_SIZE = 512
    w, h = crop_image.size
    if max(w, h) > TARGET_SIZE or max(w, h) < TARGET_SIZE:
        scale = TARGET_SIZE / max(w, h)
        new_w = max(8, int(w * scale) - (int(w * scale) % 8))
        new_h = max(8, int(h * scale) - (int(h * scale) % 8))
        proc_image = crop_image.resize((new_w, new_h), Image.LANCZOS)
        proc_mask = crop_mask.resize((new_w, new_h), Image.NEAREST)
    else:
        new_w = w - (w % 8)
        new_h = h - (h % 8)
        proc_image = crop_image.crop((0, 0, new_w, new_h))
        proc_mask = crop_mask.crop((0, 0, new_w, new_h))

    # --- Pipeline setup ---
    pipe = get_inpaint_pipe()
    generator = None
    if seed is not None:
        generator = torch.Generator(device=pipe.device).manual_seed(int(seed))

    first_prompt = enhance_prompt(prompt)
    print(f"[INFO] Prompt: {first_prompt}", flush=True)

    # Effective steps the scheduler will actually run (strength truncates the schedule)
    reported_total = max(1, round(effective_step_count * float(strength)))

    # --- SSE streaming via queue + step callback ---
    queue: asyncio.Queue = asyncio.Queue()
    loop = asyncio.get_running_loop()

    def step_callback(_pipe, step_index: int, _timestep, callback_kwargs: dict):
        loop.call_soon_threadsafe(
            queue.put_nowait,
            {"type": "progress", "step": step_index + 1, "total": reported_total},
        )
        return callback_kwargs

    async def run_pipe():
        try:
            result = await loop.run_in_executor(
                None,
                lambda: pipe(
                    prompt=first_prompt,
                    image=proc_image,
                    mask_image=proc_mask,
                    negative_prompt=negative_prompt,
                    guidance_scale=float(guidance_scale),
                    num_inference_steps=effective_step_count,
                    generator=generator,
                    strength=float(strength),
                    callback_on_step_end=step_callback,
                ),
            )
            await queue.put({"type": "done", "image": result.images[0]})
        except Exception as e:
            await queue.put({"type": "error", "message": str(e)})

    async def event_stream():
        asyncio.create_task(run_pipe())
        try:
            while True:
                event = await queue.get()

                if event["type"] == "progress":
                    yield f"data: {json.dumps({'step': event['step'], 'total': event['total']})}\n\n"

                elif event["type"] == "done":
                    result_crop = event["image"]
                    orig_w = padded_bbox[2] - padded_bbox[0]
                    orig_h = padded_bbox[3] - padded_bbox[1]
                    result_crop_resized = result_crop.resize((orig_w, orig_h), Image.LANCZOS)
                    final_image = init_image.copy()
                    final_image.paste(result_crop_resized, padded_bbox, mask=crop_mask)

                    buf = io.BytesIO()
                    final_image.save(buf, format="PNG")
                    b64 = base64.b64encode(buf.getvalue()).decode()
                    yield f"data: {json.dumps({'done': True, 'image': b64})}\n\n"
                    break

                elif event["type"] == "error":
                    yield f"data: {json.dumps({'error': event['message']})}\n\n"
                    break
        except asyncio.CancelledError:
            pass

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
