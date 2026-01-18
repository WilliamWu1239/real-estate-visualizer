# Real‑Estate Image Customizer (MVP)

A minimal, **Python‑first** web app for visualizing house/room modifications from a single photo:
- Upload a photo
- Paint a **mask** over the region you want to change
- Describe the change (e.g., “replace brown cabinets with white shaker cabinets and add a marble island”)
- Click **Generate** to see the modified image (diffusers inpainting).

> This is an MVP for concept visualization. It is **not** a construction plan or structural guarantee.

---

## 🧱 Tech Stack
- **Backend**: FastAPI + [🤗 diffusers] Stable Diffusion Inpainting pipeline
- **Frontend**: Vanilla HTML/CSS/JS with a canvas-based mask painter
- **Image Model**: `stabilityai/stable-diffusion-2-inpainting` (downloads automatically on first run)

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
Open `frontend/index.html` in your browser (or serve it with a simple HTTP server):
```bash
# from the frontend/ folder
python -m http.server 5173
```
Then visit http://localhost:5173

---

## 🖌️ How it works
1. You upload an image of a room or exterior.
2. You paint a **white** mask over areas to change (e.g., cabinets, wall, countertop).
3. The app calls `/api/edit` with the original image, mask, and your prompt.
4. The backend runs Stable Diffusion **inpainting** to synthesize the changes while preserving context.

### Tips for better results
- Mask **only** the regions you want changed.
- Use clear prompts: *“Modern white shaker cabinets, brass pulls, white marble countertop with subtle gray veins, realistic lighting.”*
- Use the **negative prompt** box to reduce artifacts: *“blurry, low quality, extra limbs, distorted, text, watermark”*.
- Increase **steps** for higher quality (slower). Try 30–50.
- Use a **seed** to reproduce a result; different seeds explore variations.

---

## 🔧 Roadmap Ideas
- Auto‑masking with text (GroundingDINO + SAM)
- Layout guidance (ControlNet Depth/Lineart) for stronger structure
- Multi‑view/back‑and‑forth edits (edit history)
- Save/Share projects and prompt presets
- Floor‑plan mode (2D planner) with image compositing

---

## ⚠️ Disclaimer
Generated images are for **visualization only** and may contain inaccuracies. Always consult professionals for feasibility, code compliance, and structural safety.
