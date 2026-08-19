/**
 * Pinned artifacts for the LOCAL AI ENGINE.
 *
 * Everything the installer downloads is listed here with an exact URL and,
 * where the source publishes one, an exact size and sha256. Pinning beats
 * "latest": the combination below is a TESTED set, and a release that renames
 * its assets (llama.cpp has done this twice) cannot silently break installs.
 * Updating the engine is editing this file.
 *
 * Selection philosophy, in the sprint's priority order:
 *   SPEED            small quantized models on the lightest native runtimes
 *   SIMPLE INSTALL   prebuilt single-binary runtimes; no Python, no Docker
 *   LOW RESOURCE     1.5B text Q4 (~1.0 GB), SD-Turbo Q8 (~1.9 GB)
 *   LOW DEPS         two upstream binaries + Node built-ins. That is all.
 *   RELIABILITY      exact sizes + checksums; resumable downloads
 *   QUALITY          last, on purpose — a fast 1.5B beats a slow 70B here
 */

export const ENGINE_VERSION = '1.0.0';

/* ============================================================
   text runtime — llama.cpp `llama-server`
   ============================================================ */

const LLAMA_TAG = 'b10456';
const LLAMA_BASE = `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_TAG}`;

/* ============================================================
   image runtime — stable-diffusion.cpp `sd`
   ============================================================ */

const SD_TAG = 'master-721-8caa3f9';
const SD_PREFIX = 'sd-master-8caa3f9';
const SD_BASE = `https://github.com/leejet/stable-diffusion.cpp/releases/download/${SD_TAG}`;

/* ============================================================
   models
   ============================================================ */

export const TEXT_MODEL = {
  alias: 'local-fast',
  name: 'qwen2.5-1.5b-instruct-q4_k_m',
  file: 'qwen2.5-1.5b-instruct-q4_k_m.gguf',
  url: 'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf',
  size: 1117320736,
  sha256: '6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e',
  license: 'Apache-2.0',
  quantization: 'Q4_K_M',
  params: '1.5B',
  ctx: 2048,
};

export const IMAGE_MODEL = {
  alias: 'local-image-fast',
  name: 'sd-turbo (q8_0)',
  file: 'sd_turbo-f16-q8_0.gguf',
  url: 'https://huggingface.co/Green-Sky/SD-Turbo-GGUF/resolve/main/sd_turbo-f16-q8_0.gguf',
  size: 2023745376,
  sha256: 'd50be7655f0a554cf8041c145d88b210bd5f3c545423119dee62ae08cae51580',
  license: 'stabilityai-community (via stabilityai/sd-turbo)',
  quantization: 'Q8_0',
  // SD-Turbo is a 1–4 step distilled SD 2.1; cfg must stay at 1.0.
  cfgScale: 1.0,
  nativeSize: 512,
};

/* ============================================================
   runtime asset table
   ============================================================

   Keyed by `${os}-${arch}-${accel}`. Sizes are approximate (GitHub does not
   publish checksums for these); integrity is proven by the archive extracting
   and the binary answering `--version`/`--help`, and the servers themselves
   are supervised at runtime. `binary` is searched for anywhere in the
   extracted tree, so upstream layout changes cannot break us.
*/

function llama(asset, approxMB) {
  return { url: `${LLAMA_BASE}/${asset}`, file: asset, approxMB, binary: ['llama-server', 'llama-server.exe'] };
}
function sd(asset, approxMB) {
  return { url: `${SD_BASE}/${asset}`, file: asset, approxMB, binary: ['sd', 'sd.exe', 'sd-cli', 'sd-cli.exe'] };
}

export const TEXT_RUNTIMES = {
  'win-x64-cuda': {
    parts: [
      llama(`llama-${LLAMA_TAG}-bin-win-cuda-12.4-x64.zip`, 239),
      llama(`cudart-llama-bin-win-cuda-12.4-x64.zip`, 373), // self-contained CUDA runtime DLLs
    ],
    accel: 'CUDA',
    gpuLayers: 99,
  },
  'win-x64-vulkan': { parts: [llama(`llama-${LLAMA_TAG}-bin-win-vulkan-x64.zip`, 33)], accel: 'Vulkan', gpuLayers: 99 },
  'win-x64-cpu': { parts: [llama(`llama-${LLAMA_TAG}-bin-win-cpu-x64.zip`, 18)], accel: 'CPU', gpuLayers: 0 },
  'mac-arm64-metal': { parts: [llama(`llama-${LLAMA_TAG}-bin-macos-arm64.tar.gz`, 11)], accel: 'Metal', gpuLayers: 99 },
  'mac-x64-cpu': { parts: [llama(`llama-${LLAMA_TAG}-bin-macos-x64.tar.gz`, 11)], accel: 'CPU', gpuLayers: 0 },
  'linux-x64-vulkan': { parts: [llama(`llama-${LLAMA_TAG}-bin-ubuntu-vulkan-x64.tar.gz`, 32)], accel: 'Vulkan', gpuLayers: 99 },
  'linux-x64-cpu': { parts: [llama(`llama-${LLAMA_TAG}-bin-ubuntu-x64.tar.gz`, 16)], accel: 'CPU', gpuLayers: 0 },
  'linux-arm64-cpu': { parts: [llama(`llama-${LLAMA_TAG}-bin-ubuntu-arm64.tar.gz`, 13)], accel: 'CPU', gpuLayers: 0 },
};

export const IMAGE_RUNTIMES = {
  'win-x64-cuda': {
    parts: [sd(`${SD_PREFIX}-bin-win-cuda12-x64.zip`, 336), sd(`cudart-sd-bin-win-cu12-x64.zip`, 537)],
    accel: 'CUDA',
  },
  'win-x64-vulkan': { parts: [sd(`${SD_PREFIX}-bin-win-vulkan-x64.zip`, 40)], accel: 'Vulkan' },
  'win-x64-cpu': { parts: [sd(`${SD_PREFIX}-bin-win-avx2-x64.zip`, 20)], accel: 'CPU' },
  'win-x64-cpu-noavx': { parts: [sd(`${SD_PREFIX}-bin-win-noavx-x64.zip`, 20)], accel: 'CPU' },
  'mac-arm64-metal': { parts: [sd(`${SD_PREFIX}-bin-Darwin-macOS-15.7.7-arm64.zip`, 47)], accel: 'Metal' },
  'linux-x64-vulkan': { parts: [sd(`${SD_PREFIX}-bin-Linux-Ubuntu-24.04-x86_64-vulkan.zip`, 43)], accel: 'Vulkan' },
  'linux-x64-cpu': { parts: [sd(`${SD_PREFIX}-bin-Linux-Ubuntu-24.04-x86_64.zip`, 24)], accel: 'CPU' },
};

/**
 * Pick runtime keys for detected hardware. Returns ordered candidates —
 * the installer takes the first whose download succeeds, and the engine falls
 * back down the list if a binary refuses to start on this machine.
 */
export function runtimeCandidates(os, arch, gpu) {
  const out = { text: [], image: [] };
  const push = (t, i) => {
    if (t && TEXT_RUNTIMES[t]) out.text.push(t);
    if (i && IMAGE_RUNTIMES[i]) out.image.push(i);
  };
  if (os === 'win' && arch === 'x64') {
    if (gpu === 'nvidia') push('win-x64-cuda', 'win-x64-cuda');
    if (gpu === 'amd' || gpu === 'intel') push('win-x64-vulkan', 'win-x64-vulkan');
    push('win-x64-cpu', 'win-x64-cpu');
  } else if (os === 'mac') {
    if (arch === 'arm64') push('mac-arm64-metal', 'mac-arm64-metal');
    else push('mac-x64-cpu', null);
  } else if (os === 'linux' && arch === 'x64') {
    if (gpu === 'nvidia' || gpu === 'amd') push('linux-x64-vulkan', 'linux-x64-vulkan');
    push('linux-x64-cpu', 'linux-x64-cpu');
  } else if (os === 'linux' && arch === 'arm64') {
    push('linux-arm64-cpu', null);
  }
  return out;
}

/**
 * The style layer. The game's imagery is stylized on purpose — these suffixes
 * make 1–4 step generations read as intent rather than as an underbaked
 * photo. Requests can opt out with `raw_prompt: true`.
 */
export const IMAGE_STYLE_SUFFIX =
  ', minimalist dark fantasy, brutalist poster art, toxic neon accents, high contrast, ' +
  'graphic illustration, rough ink, strong silhouette, low detail';

export const IMAGE_NEGATIVE_DEFAULT =
  'photorealistic, photograph, soft focus, blurry, low contrast, washed out, text, watermark, signature';
