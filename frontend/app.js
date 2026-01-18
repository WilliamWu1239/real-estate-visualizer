const imageInput = document.getElementById('imageInput');
const imageCanvas = document.getElementById('imageCanvas');
const maskCanvas = document.getElementById('maskCanvas');
const overlayCanvas = document.getElementById('overlayCanvas');
const brushSizeInput = document.getElementById('brushSize');

const modePaintBtn = document.getElementById('modePaint');
const modeEraseBtn = document.getElementById('modeErase');
const clearMaskBtn = document.getElementById('clearMask');
const promptInput = document.getElementById('prompt');
const stepsInput = document.getElementById('steps');
const guidanceInput = document.getElementById('guidance');
const strengthInput = document.getElementById('strength');
const seedInput = document.getElementById('seed');
const generateBtn = document.getElementById('generate');
const statusDiv = document.getElementById('status');
const resultImg = document.getElementById('resultImg');
const downloadBtn = document.getElementById('downloadBtn');
const segmentBtn = document.getElementById('segmentBtn');
const objectList = document.getElementById('objectList');


// Phase 1: Mask Stack
// We use hidden DOM elements so they are inspectable
const baseMaskCanvas = document.getElementById('baseMaskCanvas');
const addMaskCanvas = document.getElementById('addMaskCanvas');
const subMaskCanvas = document.getElementById('subMaskCanvas');
const finalMaskCanvas = document.getElementById('finalMaskCanvas');

// Contexts
const imgCtx = imageCanvas.getContext('2d');
const overlayCtx = overlayCanvas.getContext('2d');
// maskCanvas is currently in the DOM. We can use it as the "EDIT AREA" display or just use overlayCanvas.
// The user plan says: "Option A... Draw final mask into overlayCanvas each frame".
// Let's hide the old maskCanvas or reuse it?
// The user says "Keep existing: imageCanvas, overlayCanvas... Add: baseMaskCanvas, ..."
// It seems `maskCanvas` in the DOM might be redundant if we use overlayCanvas for everything.
// But let's keep `maskCanvas` as the visible "Edit Layer" for now if we want to separate "Mask" availability from "Highlight/BBox".
// actually, plan says "The user will NOT see 3 masks. They only see the computed final 'Edit Area' overlay."
// "Option A (simplest): Draw final mask into overlayCanvas each frame"
// So `maskCanvas` in the DOM might become unused or reused as `finalMaskCanvas`.
// Let's treat `maskCanvas` (DOM) as the `finalMaskCanvas` that is shown.
// Wait, `maskCanvas` is currently used for drawing.
// Let's use `maskCanvas` (DOM) as the visual representation of the Final Mask.

const baseMaskCtx = baseMaskCanvas.getContext('2d');
const addMaskCtx = addMaskCanvas.getContext('2d');
const subMaskCtx = subMaskCanvas.getContext('2d');
const finalMaskCtx = finalMaskCanvas.getContext('2d');

// We also need to get context for the DOM maskCanvas if we use it for display
const domMaskCtx = maskCanvas.getContext('2d');

let drawing = false;
let brushSize = parseInt(brushSizeInput.value, 10);
let mode = 'paint'; // 'paint' (add), 'erase' (remove) 
// User plan calls them 'add' and 'remove' but UI buttons say 'paint'/'erase'. I'll map them.

// State Variables
let segments = [];
let selectedSegmentIds = new Set(); // IDs of currently selected objects [Phase 1.2]
let segmentMaskBitmaps = new Map(); // id -> ImageBitmap [Phase 1.2]

// Undo Stack [Phase 1.2]
// We need to save history for addMask and subMask.
let undoStack = []; // Helper to track actions? Or list of states?
// User says: "undo stack for addMaskCanvas and subMaskCanvas"
// We'll implement a simple stack of snapshots.
const MAX_UNDO = 20;

let img = null;
let lastX = 0;
let lastY = 0;




imageInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    const maxW = 1100, maxH = 800;
    let w = image.width, h = image.height;
    const scale = Math.min(maxW / w, maxH / h, 1);
    w = Math.round(w * scale);
    h = Math.round(h * scale);

    // Phase 0.1: Canonical sizing
    [imageCanvas, maskCanvas, overlayCanvas, baseMaskCanvas, addMaskCanvas, subMaskCanvas, finalMaskCanvas].forEach(c => {
      c.width = w;
      c.height = h;
    });

    // Visually transparent for the user
    maskCanvas.style.opacity = '0.7';

    imgCtx.drawImage(image, 0, 0, w, h);

    // Reset state
    resetAllMasks();
    overlayCtx.clearRect(0, 0, w, h);

    segments = [];
    selectedObject = null;
    selectedSegmentIds.clear(); // Phase 1.2
    segmentMaskBitmaps.clear(); // Phase 1.2
    undoStack = []; // Phase 8

    img = image;
  };
  image.src = url;
});

// Phase 9.1: Clean clearing functions
function resetAllMasks() {
  const w = imageCanvas.width, h = imageCanvas.height;
  [baseMaskCanvas, addMaskCanvas, subMaskCanvas, finalMaskCanvas].forEach(c => {
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, w, h);
  });

  // Also reset selection state (Step 3G)
  selectedSegmentIds.clear();
  selectedObject = null;

  // Visual update
  domMaskCtx.clearRect(0, 0, w, h);
  updateFinalMask();
  renderSegments(); // Update selection highlights
}

function updateFinalMask() {
  // Phase 4: Compose (base + add - sub)
  const w = finalMaskCanvas.width;
  const h = finalMaskCanvas.height;

  // 1. Clear final
  finalMaskCtx.clearRect(0, 0, w, h);

  // 2. Draw base
  finalMaskCtx.globalCompositeOperation = 'source-over';
  finalMaskCtx.drawImage(baseMaskCanvas, 0, 0);

  // 3. Draw add
  finalMaskCtx.drawImage(addMaskCanvas, 0, 0);

  // 4. Subtract sub
  finalMaskCtx.globalCompositeOperation = 'destination-out';
  finalMaskCtx.drawImage(subMaskCanvas, 0, 0);
  finalMaskCtx.globalCompositeOperation = 'source-over'; // Reset

  // Phase 4.2: Show to user
  // We copy finalMask to the DOM maskCanvas
  domMaskCtx.clearRect(0, 0, w, h);
  domMaskCtx.drawImage(finalMaskCanvas, 0, 0);
}

maskCanvas.addEventListener('mousedown', (e) => {
  drawing = true;
  const { x, y } = getMousePos(e);
  lastX = x;
  lastY = y;

  // Phase 2.1: Draw initial dot or start path
  draw(e);
});
maskCanvas.addEventListener('mousemove', draw);
window.addEventListener('mouseup', () => {
  if (drawing) {
    drawing = false;
    // Phase 8.1: Snapshot on mouseup
    pushUndo();
    // Update final mask after stroke
    updateFinalMask();
  }
});

function pushUndo() {
  // Snapshot add and sub masks
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  undoStack.push({
    add: addMaskCtx.getImageData(0, 0, addMaskCanvas.width, addMaskCanvas.height),
    sub: subMaskCtx.getImageData(0, 0, subMaskCanvas.width, subMaskCanvas.height)
  });
}

// Phase 8.2: Undo
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
    if (undoStack.length === 0) return;
    const state = undoStack.pop();
    addMaskCtx.putImageData(state.add, 0, 0);
    subMaskCtx.putImageData(state.sub, 0, 0);
    updateFinalMask();
  }
});

function getMousePos(e) {
  const rect = maskCanvas.getBoundingClientRect();
  return {
    x: Math.round((e.clientX - rect.left) * (maskCanvas.width / rect.width)),
    y: Math.round((e.clientY - rect.top) * (maskCanvas.height / rect.height))
  };
}

function draw(e) {
  if (!drawing) return;
  const { x, y } = getMousePos(e);

  // Phase 2.2: Choose target context
  const ctx = (mode === 'paint') ? addMaskCtx : subMaskCtx;
  // Note: If painting, we draw White on AddMask. 
  // If erasing, we draw White on SubMask (which will be subtracted).
  // This differs from old "erase meant clear pixels".
  // User Plan 2.2: "If toolMode === 'remove' -> draw on subMaskCtx"
  // "Keep mask drawing in pure white (opaque) on transparent background."

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = brushSize;
  ctx.strokeStyle = 'white';
  ctx.fillStyle = 'white';

  ctx.beginPath();
  ctx.moveTo(lastX, lastY);
  ctx.lineTo(x, y);
  ctx.stroke();

  // Also draw circle at start for dots?
  // ctx.beginPath(); ctx.arc(x, y, brushSize/2, 0, Math.PI*2); ctx.fill(); 
  // No, stroke is better for lines. 

  lastX = x;
  lastY = y;

  // We need to update the display continuously
  updateFinalMask();
}

function imageFromBase64(b64) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = 'data:image/png;base64,' + b64;
  });
}

// Phase 9.1: Remove old clearOverlay and use resetAllMasks
function resetMask() {
  resetAllMasks();
}

function clearOverlay() {
  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
}

// async function renderSegments() {
//   clearOverlay();

//   // Draw each mask at low alpha so the user sees clickable regions
//   for (const obj of segments) {
//     const maskImg = await imageFromBase64(obj.mask_b64);
//     maskCtx.save();
//     maskCtx.globalAlpha = (selectedObject && selectedObject.id === obj.id) ? 0.45 : 0.18;
//     maskCtx.globalCompositeOperation = 'source-over';
//     maskCtx.drawImage(maskImg, 0, 0, maskCanvas.width, maskCanvas.height);
//     maskCtx.restore();

//     // Draw bbox outline
//     const [x, y, w, h] = obj.bbox;
//     maskCtx.save();
//     maskCtx.lineWidth = (selectedObject && selectedObject.id === obj.id) ? 3 : 2;
//     maskCtx.strokeStyle = (selectedObject && selectedObject.id === obj.id) ? 'yellow' : 'red';
//     maskCtx.strokeRect(x, y, w, h);
//     maskCtx.restore();
//   }
// }
const showSegmentsCheck = document.getElementById('showSegments');
showSegmentsCheck.addEventListener('change', renderSegments);


function renderSegments() {
  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

  if (!showSegmentsCheck.checked) return Promise.resolve();

  // Phase 5: Fix overlay highlighting
  // We only draw:
  // 1. Unselected objects: Faint red outline (or nothing if we want clean UI)
  // 2. Selected objects: Yellow tint + bold outline
  // Actually, the user sees the Final Mask (which includes selected objects). 
  // So we just need to highlight specific objects if we want to show "Hey this is an object you can click".

  const renders = segments.map(async (obj) => {
    const isSelected = selectedSegmentIds.has(Number(obj.id));

    // Phase 4: Make object overlays actually readable
    // Always draw bbox
    const [x, y, w, h] = obj.bbox;
    overlayCtx.save();

    if (isSelected) {
      // Draw mask overlay for selected object
      // Low alpha to let user see "this is selected"
      const m = await imageFromBase64(obj.mask_b64);
      overlayCtx.globalAlpha = 0.25;
      overlayCtx.drawImage(m, 0, 0, overlayCanvas.width, overlayCanvas.height);

      // Bold yellow outline
      overlayCtx.globalAlpha = 1.0;
      overlayCtx.lineWidth = 3;
      overlayCtx.strokeStyle = 'yellow';
      overlayCtx.strokeRect(x, y, w, h);
    } else {
      // Unselected: just faint bbox to show it exists
      overlayCtx.lineWidth = 1;
      overlayCtx.strokeStyle = 'rgba(255, 0, 0, 0.4)';
      overlayCtx.strokeRect(x, y, w, h);
    }
    overlayCtx.restore();
  });

  return Promise.all(renders);
}

// DOM elements for actions
const objectActions = document.getElementById('objectActions');
const addToMaskBtn = document.getElementById('addToMaskBtn');
const renameInput = document.getElementById('renameInput');
const renameBtn = document.getElementById('renameBtn');
const deleteObjectBtn = document.getElementById('deleteObjectBtn');

// Phase 3.3: Rebuild Base Mask
function rebuildBaseMask() {
  const w = baseMaskCanvas.width, h = baseMaskCanvas.height;
  baseMaskCtx.clearRect(0, 0, w, h);

  // Draw each selected mask
  selectedSegmentIds.forEach(id => {
    const bmp = segmentMaskBitmaps.get(id);
    if (bmp) {
      baseMaskCtx.drawImage(bmp, 0, 0, w, h);
    }
  });

  updateFinalMask();
  renderSegments(); // Re-render outlines
}

function selectObject(obj) {
  // Phase 3.2: Toggle selection
  const id = Number(obj.id);
  if (selectedSegmentIds.has(id)) {
    selectedSegmentIds.delete(id);
    statusDiv.textContent = `Deselected ${obj.label}`;
  } else {
    selectedSegmentIds.add(id);
    statusDiv.textContent = `Selected ${obj.label}`;
  }

  selectedObject = selectedSegmentIds.has(id) ? obj : null;
  populateObjectList();
  rebuildBaseMask();

  // Hide detailed actions if we just want simple toggle. 
  // Or we can keep rename/delete.
  if (selectedSegmentIds.has(id)) {
    objectActions.style.display = 'flex';
    renameInput.value = obj.label;
    // Hide "Add to mask" since calls rebuildBaseMask automatically
    addToMaskBtn.style.display = 'none';
  } else {
    objectActions.style.display = 'none';
  }
}

// Update populateObjectList to show checking based on selectedSegmentIds
function populateObjectList() {
  objectList.innerHTML = '';
  segments.forEach(obj => {
    const item = document.createElement('button');
    const isSel = selectedSegmentIds.has(Number(obj.id));
    item.textContent = `${isSel ? '☑ ' : '☐ '}${obj.label}`;
    item.className = 'object-item';
    item.style.marginRight = '8px';
    if (selectedObject && selectedObject.id === obj.id) {
      // Highlight focused item for rename/delete
      item.style.border = '2px solid yellow';
    } else {
      item.style.border = '1px solid #ccc';
    }

    if (isSel) {
      item.style.backgroundColor = '#444'; // Visual cue
    }

    item.onclick = () => selectObject(obj);
    objectList.appendChild(item);
  });
}

// Rename/Delete Handlers
renameBtn.onclick = () => {
  if (!selectedObject) return;
  const newName = renameInput.value.trim();
  if (newName) {
    selectedObject.label = newName;
    populateObjectList();
    statusDiv.textContent = `Renamed to: ${newName}`;
  }
};

deleteObjectBtn.onclick = () => {
  if (!selectedObject) return;
  const idToRemove = Number(selectedObject.id);

  // Remove from segments array
  segments = segments.filter(s => Number(s.id) !== idToRemove);

  // Remove from selection set
  selectedSegmentIds.delete(idToRemove);

  // Clear selection state
  selectedObject = null;
  objectActions.style.display = 'none';

  // Refresh UI and Masks
  populateObjectList();
  rebuildBaseMask();
  statusDiv.textContent = 'Object deleted.';
};

brushSizeInput.addEventListener('input', () => {

  brushSize = parseInt(brushSizeInput.value, 10);
});

modePaintBtn.addEventListener('click', () => {
  mode = 'paint';
  modePaintBtn.classList.add('primary');
  modeEraseBtn.classList.remove('primary');
});
modeEraseBtn.addEventListener('click', () => {
  mode = 'erase';
  modeEraseBtn.classList.add('primary');
  modePaintBtn.classList.remove('primary');
});
clearMaskBtn.addEventListener('click', resetMask);

async function generate() {
  if (!img) { alert('Please upload an image first.'); return; }
  statusDiv.textContent = 'Generating... (first run may download the model)';
  resultImg.src = '';

  // Phase 6.1: Export correct mask (finalMaskCanvas)
  // We need to send black/white mask. finalMaskCanvas is white-on-transparent.
  // We compose it over black.

  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = finalMaskCanvas.width;
  tempCanvas.height = finalMaskCanvas.height;
  const tempCtx = tempCanvas.getContext('2d');

  // Fill black (preserve)
  tempCtx.fillStyle = 'black';
  tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

  // Draw final mask (white = edit)
  tempCtx.drawImage(finalMaskCanvas, 0, 0);

  // Phase 6.2: Optional Threshold Logic?
  // Since we use logical composition (bitmap + paint), edges might be anti-aliased.
  // We can leave it as is for soft blending, or threshold.
  // User says "accept soft edges for nicer blending" is okay.

  const blobMask = await new Promise(resolve => tempCanvas.toBlob(resolve, 'image/png'));
  const blobOriginal = await new Promise(resolve => imageCanvas.toBlob(resolve, 'image/png'));

  const fd = new FormData();
  fd.append('image', blobOriginal, 'image.png');
  fd.append('mask', blobMask, 'mask.png');
  fd.append('prompt', promptInput.value || '');
  // fd.append('negative_prompt', ...); // Removed in duplicate cleanup, but maybe still referenced in generate?
  // I removed the negativeInput variable declaration in previous step. I should check if I need to restore it or remove usage.
  // I will check if negativeInput is defined. Ah, I deleted it. I should re-add it or remove usage.
  // Let's assume I need to restore it. 
  // Note: I missed adding negativeInput back in step 30. I'll add logic to get it by ID inside here if needed or just skip.
  const negEl = document.getElementById('negative'); // It was id 'negative' in HTML
  fd.append('negative_prompt', negEl ? negEl.value : '');

  fd.append('num_inference_steps', stepsInput.value || 35);
  fd.append('guidance_scale', guidanceInput.value || 7.5);
  fd.append('strength', strengthInput.value || 0.85);
  if (seedInput.value) fd.append('seed', seedInput.value);

  try {
    const resp = await fetch('http://localhost:8000/api/edit', {
      method: 'POST',
      body: fd
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${resp.status}`);
    }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    resultImg.src = url;
    statusDiv.textContent = 'Done.';
    downloadBtn.onclick = () => {
      const a = document.createElement('a');
      a.href = url;
      a.download = 'result.png';
      a.click();
    };
  } catch (e) {
    console.error(e);
    statusDiv.textContent = 'Error: ' + e.message;
  }
}

generateBtn.addEventListener('click', generate);
segmentBtn.addEventListener('click', async () => {
  if (!img) { alert('Upload an image first'); return; }
  statusDiv.textContent = 'Segmenting objects...';

  // Phase 7.2: Pass sensitivity (threshold)
  // But wait, user plan 7.2 says "Detection sensitivity" ui label.
  // I need to add that UI element first or assume it's there (I haven't added it to HTML yet).
  // For now I'll use 0.55 if not found.
  // I'll update HTML in next step or now. 
  // Let's assume I'll add id="sensitivity" to HTML.
  const sensitivityInput = document.getElementById('sensitivity');
  const threshold = sensitivityInput ? parseFloat(sensitivityInput.value) : 0.55;

  const blobOriginal = await new Promise(r => imageCanvas.toBlob(r, 'image/png'));
  const fd = new FormData();
  fd.append('image', blobOriginal, 'image.png');
  // Pass threshold as query param or form data?
  // Backend segment.py receives `image` as UploadFile.
  // It doesn't seem to look for other form fields in `segment_image` signature yet.
  // I will update backend later to accept `threshold` query param.

  const url = new URL('http://localhost:8000/api/segment');
  url.searchParams.append('threshold', threshold);

  try {
    const resp = await fetch(url.toString(), { method: 'POST', body: fd });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();

    segments = data.objects || [];
    // Phase 3.1: Store bitmaps
    segmentMaskBitmaps.clear();
    selectedSegmentIds.clear();

    for (const obj of segments) {
      // Decode base64 to ImageBitmap for performance
      const img = await imageFromBase64(obj.mask_b64);
      const bmp = await createImageBitmap(img);
      segmentMaskBitmaps.set(Number(obj.id), bmp);
    }

    selectedObject = null;
    populateObjectList();
    resetAllMasks(); // Clear old selection/paint
    renderSegments(); // Draw potential objects

    statusDiv.textContent = segments.length
      ? 'Segmentation complete. Click objects to select.'
      : 'No objects found.';
  } catch (e) {
    console.error(e);
    statusDiv.textContent = 'Segmentation failed.';
  }
});
