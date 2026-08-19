# LOCAL AI ENGINE

A minimal, fast, fully local AI service for SHDOWPIT: one lightweight Node
server in front of one text runtime (llama.cpp `llama-server`) and one image
runtime (stable-diffusion.cpp `sd`). No accounts, no API keys, no cloud, no
Docker, no Python — after the models download once, everything works offline.

    GAME ──► server/aiHandler.mjs (provider: OPENAI | LOCAL | AUTO)
                 ├── OpenAI API                (existing path, untouched)
                 └── http://127.0.0.1:11435    (this engine)
                        ├── llama-server ── Qwen2.5-1.5B-Instruct Q4_K_M (~1.0 GB)
                        └── sd           ── SD-Turbo Q8_0 GGUF          (~1.9 GB)

## One button

In the game: PAUSE → AI settings → **DOWNLOAD & RUN LOCAL AI ENGINE**.
That button runs `install.mjs` and streams its progress into the panel.

## Command line

    npm run ai:install      # detect OS/GPU, download runtimes + models, start, verify
    npm run ai:status       # JSON status
    npm run ai:start        # start (reuses a running engine)
    npm run ai:stop
    npm run ai:restart
    npm run ai:remove       # stop + delete runtime/cache/config (models kept)
    node local-ai-engine/install.mjs --remove --purge-models   # also delete models

The installer is idempotent and downloads resume; verified files are never
re-fetched. Disk space is checked before anything downloads.

## Endpoints (OpenAI-compatible)

    GET  /health                    ready | partial | starting (text and image independent)
    GET  /v1/models                 local-fast, local-balanced, local-image-fast
    POST /v1/chat/completions       temperature 0.7, max_tokens 128 by default
    POST /v1/completions
    POST /v1/images/generations     512x512 default (256x256 supported), 1–4 steps,
                                    `response_format: "b64_json"` supported,
                                    otherwise returns a local /generated/... URL

No API key is required; clients that insist can send `Authorization: Bearer local`.
The server binds **127.0.0.1 only** unless you edit `config/config.json`.

## Behaviour notes

- Text stays available when image generation is not (partial readiness).
- The image model runs as one process per generation, so its weights occupy
  memory only while an image is being made.
- GPU out-of-memory retries once at reduced size/steps, then reports
  `OUT_OF_MEMORY`. The server never crashes with the game attached.
- If port 11435 is taken by a stranger, the engine picks the next free port
  and records it in `config/port.json`; the game reads that file.
- Style: prompts get a toxic-neon poster-art suffix so 1–4 step generations
  look intentional. Send `raw_prompt: true` to opt out.
- Logs are minimal (`logs/engine.log`) and never contain prompts unless
  `debug: true` is set in config. Nothing here ever sees an OpenAI key.

## Layout

    runtime/   llama.cpp + stable-diffusion.cpp binaries (per-accelerator)
    models/    downloaded GGUF weights
    cache/     generated images (served at /generated/) + download staging
    config/    config.json, port.json, engine.pid
    logs/      engine + install logs, install-progress.json
