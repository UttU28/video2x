#!/usr/bin/env bash
#
# Build the video2x C++ engine (backend/engine) into backend/engine/build/install.
# Bundled ncnn + spdlog (git submodules); system ffmpeg, boost, vulkan-headers.
#
#   bash backend/buildEngine.sh          # build only if sources changed
#   bash backend/buildEngine.sh --force  # always rebuild
#
# Arch prerequisites (once):  sudo pacman -S --needed vulkan-headers boost cmake ninja
#
set -euo pipefail

backendDir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
engineDir="${backendDir}/engine"
buildDir="${engineDir}/build"
installDir="${buildDir}/install"
stampFile="${buildDir}/.sourceStamp"

forceBuild=0
for arg in "$@"; do [[ "$arg" == "--force" ]] && forceBuild=1; done

missing=()
[[ -f /usr/include/vulkan/vulkan.h ]] || missing+=("vulkan-headers")
[[ -f /usr/include/boost/program_options.hpp ]] || missing+=("boost")
command -v cmake >/dev/null || missing+=("cmake")
command -v ninja >/dev/null || missing+=("ninja")
if [[ ${#missing[@]} -gt 0 ]]; then
  echo "[engine] Missing build prerequisites: ${missing[*]}" >&2
  echo "[engine] Run: sudo pacman -S --needed ${missing[*]}" >&2
  exit 1
fi

cd "${backendDir}/.."
echo "[engine] Syncing submodules (ncnn, spdlog, ncnn-vulkan libs)…"
git submodule update --init --recursive \
  backend/engine/third_party/ncnn \
  backend/engine/third_party/spdlog \
  backend/engine/third_party/librealesrgan_ncnn_vulkan \
  backend/engine/third_party/librealcugan_ncnn_vulkan \
  backend/engine/third_party/librife_ncnn_vulkan

# Rebuild only when engine sources change (HEAD tree of backend/engine + local edits).
sourceStamp="$(git rev-parse HEAD:backend/engine 2>/dev/null || echo none)-$(git status --porcelain -- backend/engine | grep -v '^?? backend/engine/build' | sha1sum | cut -c1-12)"
if [[ "$forceBuild" -eq 0 && -x "${installDir}/bin/video2x" && -f "$stampFile" && "$(cat "$stampFile")" == "$sourceStamp" ]]; then
  echo "[engine] Up to date: ${installDir}/bin/video2x"
  exit 0
fi

# C++17 pinned: GCC 16 defaults to C++20 where path::u8string() returns std::u8string (breaks upstream code).
echo "[engine] Configuring (Release, C++17, native CPU opts)…"
cmake -G Ninja -S "$engineDir" -B "$buildDir" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_CXX_STANDARD=17 \
  -DCMAKE_CXX_STANDARD_REQUIRED=ON \
  -DCMAKE_INSTALL_PREFIX="$installDir" \
  -DCMAKE_INSTALL_LIBDIR=lib \
  -DVIDEO2X_ENABLE_NATIVE=ON \
  -DVIDEO2X_USE_EXTERNAL_NCNN=OFF \
  -DVIDEO2X_USE_EXTERNAL_SPDLOG=OFF \
  -DVIDEO2X_USE_EXTERNAL_BOOST=ON

echo "[engine] Building…"
cmake --build "$buildDir" --config Release --parallel "$(nproc)" --target install

echo "$sourceStamp" > "$stampFile"
echo "[engine] Installed: ${installDir}/bin/video2x"
LD_LIBRARY_PATH="${installDir}/lib" "${installDir}/bin/video2x" --version || true
