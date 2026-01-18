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

    pipe = get_inpaint_pipe()

    generator = None
    if seed is not None:
        device = pipe.device
        generator = torch.Generator(device=device).manual_seed(int(seed))

    # Run the inpainting pipeline
    result = pipe(
        prompt=prompt,
        image=init_image,
        mask_image=mask_image,
        negative_prompt=negative_prompt,
        guidance_scale=float(guidance_scale),
        num_inference_steps=int(num_inference_steps),
        generator=generator,
        strength=float(strength),
    ).images[0]

    # Stream PNG back
    out_buf = io.BytesIO()
    result.save(out_buf, format="PNG")
    out_buf.seek(0)
    return StreamingResponse(out_buf, media_type="image/png")
