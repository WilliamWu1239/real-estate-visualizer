import torch
from diffusers import DPMSolverMultistepScheduler, StableDiffusionInpaintPipeline

_pipe = None

def get_inpaint_pipe() -> StableDiffusionInpaintPipeline:
    global _pipe
    if _pipe is not None:
        return _pipe

    # Realistic Vision 5.1 (SD1.5-based, fine-tuned for photorealism) — the
    # inpainting weights live on a branch of this repo, not main.
    # Fallback if quality disappoints: "stabilityai/stable-diffusion-2-inpainting"
    # (already cached locally; drop the revision kwarg when using it).
    model_id = "holwech/realistic-vision-5_1-optimized"
    revision = "realistic-vision-5_1-inpainting"
    device = "cuda" if torch.cuda.is_available() else "cpu"
    torch_dtype = torch.float16 if device == "cuda" else torch.float32

    _pipe = StableDiffusionInpaintPipeline.from_pretrained(
        model_id,
        revision=revision,
        torch_dtype=torch_dtype,
        safety_checker=None,  # optional; consider enabling in production
    )

    # DPM++ 2M Karras converges in ~20 steps with better detail than the
    # default scheduler at 35+ — a large speedup on CPU.
    _pipe.scheduler = DPMSolverMultistepScheduler.from_config(
        _pipe.scheduler.config,
        algorithm_type="dpmsolver++",
        use_karras_sigmas=True,
    )

    _pipe = _pipe.to(device)

    if device == "cuda":
        try:
            _pipe.enable_xformers_memory_efficient_attention()
        except Exception:
            pass
    _pipe.enable_attention_slicing()
    return _pipe
