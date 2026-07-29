# Real‑Estate Image Customizer (MVP)

A minimal, **Python‑first** web app for visualizing house/room modifications from a single photo:
- Upload a photo
- Paint a **mask** over the region you want to change
- Describe the change (e.g., “replace brown cabinets with white shaker cabinets and add a marble island”)
- Click **Generate** to see the modified image (diffusers inpainting).

> This is an MVP for concept visualization. It is **not** a construction plan or structural guarantee.

---

## Tech Stack
- **Backend**: FastAPI + [diffusers] Stable Diffusion Inpainting pipeline
- **Frontend**: Vanilla HTML/CSS/JS with a canvas-based mask painter
- **Image Model**: Realistic Vision 5.1 inpainting (`holwech/realistic-vision-5_1-optimized`, branch `realistic-vision-5_1-inpainting`) — an SD1.5-based checkpoint fine-tuned for photorealism; downloads automatically on first run (~4.3 GB)

## ⚙️ Setup

### 1) Create a virtual environment (recommended)
```bash
python -m venv .venv
# Windows
.\.venv\Scripts\activate
# macOS/Linux
source .venv/bin/activate
```

### 2) Install dependencies
```bash
pip install -r backend/requirements.txt
```

> Note: `torch` wheels vary by OS/GPU. If installation is slow, visit https://pytorch.org/get-started/locally/ for the best command for your system.

### 3) Run the backend
```bash
cd backend
uvicorn app:app --host 0.0.0.0 --port 8000 --reload
```

### 4) Open the frontend

**React frontend (recommended):**
```bash
cd frontend-react
npm install
npm run dev
```
Then visit the URL Vite prints (usually http://localhost:5173).

**Legacy vanilla frontend:** open `frontend/index.html` in your browser (or serve it):
```bash
# from the frontend/ folder
python -m http.server 5173
```

---

##  How it works
1. You upload an image of a room or exterior.
2. You paint a **white** mask over areas to change (e.g., cabinets, wall, countertop).
3. The app calls `/api/edit` with the original image, mask, and your prompt.
4. The backend runs Stable Diffusion **inpainting** to synthesize the changes while preserving context.

### Tips for better results
- Mask **only** the regions you want changed.
- Use clear prompts: *“Modern white shaker cabinets, brass pulls, white marble countertop with subtle gray veins, realistic lighting.”*
- Use the **negative prompt** box to reduce artifacts: *“blurry, low quality, extra limbs, distorted, text, watermark”*.
- The backend uses the **DPM++ 2M Karras** scheduler, which converges quickly: **20–30 steps** is usually enough (the default is 24).
- Use a **seed** to reproduce a result; different seeds explore variations.

---

##  Roadmap Ideas
- Auto‑masking with text (GroundingDINO + SAM)
- Layout guidance (ControlNet Depth/Lineart) for stronger structure
- Multi‑view/back‑and‑forth edits (edit history)
- Save/Share projects and prompt presets
- Floor‑plan mode (2D planner) with image compositing

---

## Deployment

The app is designed to run as two separately-hosted pieces, entirely on free tiers:

- **Backend**: FastAPI on an Oracle Cloud "Always Free" Ampere A1 VM (ARM64, no GPU), run via a Python venv + systemd, fronted by [Caddy](https://caddyserver.com/) for automatic HTTPS. A free [DuckDNS](https://www.duckdns.org/) subdomain points at the VM's public IP.
- **Frontend**: `frontend-react/` deployed as a static build on [Vercel](https://vercel.com/).

Config surface (both currently unset locally, using the fallback):

| Var | Where it's set | Purpose |
|---|---|---|
| `ALLOWED_ORIGINS` | systemd unit `Environment=` line on the VM (see `backend/deploy/realestate-backend.service`) | Comma-separated CORS allow-list for `backend/app.py`; defaults to `http://localhost:5173,http://127.0.0.1:5173` if unset |
| `VITE_API_URL` | Vercel Project Environment Variables | Backend base URL the frontend calls; defaults to `http://localhost:8000` if unset. Baked in at build time -- changing it requires a Vercel redeploy |

Deploy templates live in `backend/deploy/`:
- `realestate-backend.service` -- systemd unit for running uvicorn on the VM
- `Caddyfile` -- reverse proxy config for TLS termination and SSE-safe timeouts

Since the backend runs on CPU only (no CUDA on the free Ampere shape), expect noticeably slower inference than local GPU dev — the Caddyfile's proxy timeout is set generously (300s) to accommodate this.

---

## Disclaimer
Generated images are for **visualization only** and may contain inaccuracies. Always consult professionals for feasibility, code compliance, and structural safety.
