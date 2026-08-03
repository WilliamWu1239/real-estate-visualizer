import modal

app = modal.App("real-estate-visualizer")

hf_cache_vol = modal.Volume.from_name("re-visualizer-hf-cache", create_if_missing=True)

image = (
    modal.Image.debian_slim(python_version="3.10")
    .pip_install_from_requirements("requirements.txt")
    .env(
        {
            "HF_HOME": "/cache/huggingface",
            "ALLOWED_ORIGINS": "https://real-estate-visualizer-nine.vercel.app",
        }
    )
    .add_local_python_source("app", "pipeline", "segment")
)


@app.function(
    image=image,
    gpu="T4",
    volumes={"/cache": hf_cache_vol},
    timeout=300,
    scaledown_window=300,
)
@modal.asgi_app()
def fastapi_app():
    from app import app as fastapi_instance

    return fastapi_instance


@app.function(image=image, volumes={"/cache": hf_cache_vol}, timeout=1800)
def warm_cache():
    from pipeline import get_inpaint_pipe
    from segment import get_model

    get_inpaint_pipe()
    get_model()
    hf_cache_vol.commit()
    print("Cache warmed.")
