# Generative Comic Combat

Simulation → dramatic capture → (optional) AI illustration → comic panel.

**AI is optional.** The game never downloads models for this feature. Potato quality always works with stylized Three.js captures.

---

## A. Architecture (where it plugs in)

```
Nemesis / Combat / Game (facts)
        │
        ▼
 EncounterStory + StoryBeat     ← src/comic/StoryBuilder.ts
        │
        ▼
 Comic Director (importance)    ← src/comic/Director.ts
        │
        ▼
 Virtual Cinematographer        ← src/comic/Cinematographer.ts
        │
        ▼
 Capture RGB (+ depth)          ← src/comic/Capture.ts  (WebGLRenderTarget)
        │
        ├─► Potato stylize      ← src/comic/PostProcess.ts
        └─► Optional AI img     ← existing AIBackend.image()  (src/ai/)
        │
        ▼
 Async ComicQueue               ← never blocks the combat frame
        │
        ▼
 ComicViewer (typography/SFX)   ← src/ui/ComicViewer.ts
```

| Layer | Existing system | Comic role |
| --- | --- | --- |
| Game | `src/core/Game.ts` | Hooks intro / strike / outcome; F1 + `__sim('comicSlice')` |
| Combat | `CombatSystem.onEnemyStrikeLanded` | Named blows become attack/impact beats |
| Nemesis | Encounter director, roster | Names, ranks, weapons, relationship copy |
| AI | `src/ai/AIBackend` | Optional illustration only — same “facts in, text/image out” rule |
| God | — | Not wired in v1 (same story types can feed later) |

**Rule:** simulation creates facts; AI only illustrates. Nothing in `src/comic/` writes HP, rank, or loot.

---

## B. Technology comparison (2026 local / open-source)

Labels: **[cited]** = published figure · **[estimate]** = scaled/interpolated · not measured in this repo.

| Approach | Fit for comic panels | Notes |
| --- | --- | --- |
| **SDXL Lightning** (2–8 step) | Best default for local img2img | Native ~1024; ControlNet/LoRA ecosystem mature. **[cited]** Gigagpu 5090: Lightning 4-step ~0.22s @ 1024; Lightning 8-step ~0.4s. **[cited]** Gigagpu 4090: Lightning 4-step ~0.7s @ 1024. |
| **SDXL Turbo** | Fast drafts / Potato→Fast | Trained ~512; 1-step. **[cited]** Gigagpu 5090 Turbo 1-step ~0.08s @ 1024. Quality usually behind Lightning. |
| **LCM / LCM-LoRA** | OK mid tier | More steps than Turbo/Lightning for similar look; TensorRT path exists (NVIDIA blog). |
| **FLUX.1 Schnell / Dev** | High quality Offline | Heavier VRAM; ControlNet ecosystem younger than SDXL. Prefer when identity+style matter more than adapters. |
| **ControlNet** (depth / pose / canny) | Strong with our depth capture | Depth from Three.js → ControlNet depth is the natural v2 path. |
| **IP-Adapter** | Character consistency | Pair with `CharacterRefStore` refs per nemesis ID. |
| **LoRA** (char / style) | Style profiles | Swap style LoRA via style profile `promptSuffix` + future `loraId` field. |
| **TensorRT / ONNX** | Latency on NVIDIA | **[cited]** NVIDIA: SDXL Turbo / LCM-LoRA accelerated; engines are GPU-arch specific. |
| **Frame interp** | Panel motion only | Prefer in-engine shake/push-in (already shipped) over AI video for v1. |

Sources used: Gigagpu SDXL Lightning vs Turbo / 4090 benchmarks; NVIDIA TensorRT SD blog; VirtusLab diffusion quantization notes; Félix Sanz Lightning vs Turbo memory table; community ComfyUI ControlNet+IP-Adapter guides.

---

## C. Recommended prototype stack (smallest practical)

1. **In-game (shipped):** Three.js capture + potato comic post + Dom viewer  
2. **Optional local AI:** existing `local-ai-engine` / `AIBackend.image` (no new weights in core)  
3. **Next plug-in (not required):** ComfyUI or diffusers endpoint with SDXL Lightning 4-step + ControlNet depth + IP-Adapter face/ref  

Quality profiles: `potato` → `fast` → `balanced` → `offline` (`src/comic/QualityProfiles.ts`).

---

## D. Performance estimates

Per **one** panel. Distill steps assume Lightning-class unless noted.

| GPU | 512 **[estimate]** | ~768 **[estimate]** | 1024 **[cited / estimate]** |
| --- | --- | --- | --- |
| RTX 3060 12GB | Lightning ~1.5–3s | ~3–6s | Turbo-class ~7s **[ref WillItRunAI Turbo]**; Lightning slower |
| RTX 4060 8GB | ~1–2.5s | ~2.5–5s | Tight VRAM; offload may apply |
| RTX 4070 | ~0.8–1.8s | ~1.5–3.5s | Distilled **[estimate]** ~1–2s |
| RTX 4080 | ~0.5–1.2s | ~1–2.5s | **[estimate]** from 4090 scaling |
| RTX 4090 | ~0.35–0.8s | ~0.5–1.2s | Lightning 4-step **[cited]** ~0.7s (Gigagpu) |
| RTX 5090 | ~0.2–0.5s | ~0.3–0.8s | Lightning 4-step **[cited]** ~0.22s; Turbo **[cited]** ~0.08s (Gigagpu) |

**Potato (no AI):** capture + canvas stylize is typically **&lt; 30–80 ms** on discrete GPUs at 384–512 — **[estimate]** from WebGL readback cost, not bench’d here.

A 4-panel slice at Potato is interactive; Offline AI may take several seconds — queue shows when ready (intro / outcome / lull / F1 force).

---

## E. Integration map (files)

| Path | Role |
| --- | --- |
| `src/comic/*` | Story, director, cine, capture, queue, styles, service |
| `src/ui/ComicViewer.ts` | Brutalist panel UI |
| `src/core/Game.ts` | Hooks + `__sim('comicSlice')` + F1 |
| `src/combat/CombatSystem.ts` | `onEnemyStrikeLanded` |
| `src/ui/DebugOverlay.ts` | **COMIC SLICE** button |
| `src/style.css` | `#comic-viewer` |
| `docs/COMIC_COMBAT.md` | This doc |
| `tools/comictest.mjs` | Automated smoke |

---

## How to run the vertical slice

```bash
npm run dev
# browser :5173 — Descend into a run
# F1 → COMIC SLICE (4 PANELS)
# or console:
#   SHDOWPIT.__sim('comicSlice')
#   SHDOWPIT.__sim('comicQuality', 'potato')
#   SHDOWPIT.__sim('comicStatus')
```

Automated:

```bash
npm run build && npx vite preview --port 4173
npm run test:comic
```

Expected: named nemesis on stage → 4 panels (intro / attack / impact / outcome) → viewer with in-engine SFX text.

---

## G. Fallback

- Quality `potato`: no AI, stylized RGB only  
- Missing subjects: ink placeholder card  
- AI failure: keep potato image  
- Feature never blocks combat frames (async queue)

---

## H. Plugging another model / ControlNet / LoRA / style

1. **Style profile** — add to `StyleProfiles.ts` (`promptSuffix`, ink knobs). `ComicService.setStyle(id)`.  
2. **Quality profile** — `QualityProfiles.ts` (resolution, `tryAi`, depth).  
3. **New image backend** — implement `AIImageProvider` or extend `AIBackend.image` to POST `{ prompt, initImage, depthImage, lora, controlnet }`. Capture already stores `panel.captureRgb` + `captureDepth`.  
4. **Character refs** — `ComicService.refs.addRef(nemesisId, dataUrl)`. Feed IP-Adapter later.  
5. **ControlNet depth** — send `captureDepth` as conditioning; keep text prompt from `PromptComposer`.  
6. **LoRA** — add optional `loraId` on `ComicStyleProfile`; backend loads adapter. Game still only sends facts + refs.

Do **not** import Python weights into the Vite bundle. Keep generation on `server/` or `local-ai-engine/`.
