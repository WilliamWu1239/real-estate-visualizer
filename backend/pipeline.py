import torch
from diffusers import StableDiffusionInpaintPipeline

_pipe = None

def get_inpaint_pipe() -> StableDiffusionInpaintPipeline:
    global _pipe
    if _pipe is not None:
        return _pipe

    model_id = "runwayml/stable-diffusion-inpainting"
    device = "cuda" if torch.cuda.is_available() else "cpu"
    torch_dtype = torch.float16 if device == "cuda" else torch.float32

    _pipe = StableDiffusionInpaintPipeline.from_pretrained(
        model_id,
        torch_dtype=torch_dtype,
        safety_checker=None,  # optional; consider enabling in production
    )
    _pipe = _pipe.to(device)

    if device == "cuda":
        try:
            _pipe.enable_xformers_memory_efficient_attention()
        except Exception:
            pass
    _pipe.enable_attention_slicing()
    return _pipe
