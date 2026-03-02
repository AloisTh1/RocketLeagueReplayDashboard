#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="${ROOT_DIR}/dist"
BACKEND_DIST_DIR="${DIST_DIR}/backend"
FRONTEND_DIST_DIR="${DIST_DIR}/frontend"
TOOLS_DIST_DIR="${DIST_DIR}/tools"
PORT="${PORT:-8000}"

echo "Building frontend..."
pushd "${ROOT_DIR}/frontend" >/dev/null
npm ci
npm run build:prod
popd >/dev/null

echo "Building backend binary..."
pushd "${ROOT_DIR}" >/dev/null
uv sync --extra build
uv run pyinstaller --noconfirm --clean --onefile --name rl-dashboard-api backend/main.py
popd >/dev/null

mkdir -p "${BACKEND_DIST_DIR}" "${FRONTEND_DIST_DIR}" "${TOOLS_DIST_DIR}"

BACKEND_BIN_SRC="${DIST_DIR}/rl-dashboard-api"
BACKEND_BIN_NAME="rl-dashboard-api"
if [[ -f "${DIST_DIR}/rl-dashboard-api.exe" ]]; then
  BACKEND_BIN_SRC="${DIST_DIR}/rl-dashboard-api.exe"
  BACKEND_BIN_NAME="rl-dashboard-api.exe"
fi

cp "${BACKEND_BIN_SRC}" "${BACKEND_DIST_DIR}/${BACKEND_BIN_NAME}"
cp -R "${ROOT_DIR}/frontend/dist/." "${FRONTEND_DIST_DIR}/"

BOXCARS_CANDIDATES=()
if [[ -n "${BOXCARS_EXE:-}" ]]; then
  BOXCARS_CANDIDATES+=("${BOXCARS_EXE}")
fi
BOXCARS_CANDIDATES+=(
  "${ROOT_DIR}/.boxcars-src/target/release/examples/json.exe"
  "${ROOT_DIR}/.boxcars-src/target/release/examples/json"
  "${ROOT_DIR}/tools/boxcars.exe"
  "${ROOT_DIR}/tools/boxcars"
)
BOXCARS_SRC=""
for candidate in "${BOXCARS_CANDIDATES[@]}"; do
  if [[ -f "${candidate}" ]]; then
    BOXCARS_SRC="${candidate}"
    break
  fi
done
BOXCARS_BUNDLE_PATH=""
if [[ -n "${BOXCARS_SRC}" ]]; then
  BOXCARS_BUNDLE_PATH="./tools/boxcars"
  if [[ "${BOXCARS_SRC}" == *.exe ]]; then
    BOXCARS_BUNDLE_PATH="./tools/boxcars.exe"
  fi
  cp "${BOXCARS_SRC}" "${DIST_DIR}/${BOXCARS_BUNDLE_PATH#./}"
fi

cat > "${DIST_DIR}/run-backend.sh" <<EOF
#!/usr/bin/env bash
set -euo pipefail
export PORT=${PORT}
EOF
if [[ -n "${BOXCARS_BUNDLE_PATH}" ]]; then
  cat >> "${DIST_DIR}/run-backend.sh" <<EOF
export BOXCARS_EXE="${BOXCARS_BUNDLE_PATH}"
EOF
fi
cat >> "${DIST_DIR}/run-backend.sh" <<EOF
./backend/${BACKEND_BIN_NAME}
EOF
chmod +x "${DIST_DIR}/run-backend.sh"

ARCHIVE_ITEMS=("backend" "frontend" "run-backend.sh")
if [[ -n "${BOXCARS_BUNDLE_PATH}" ]]; then
  ARCHIVE_ITEMS+=("tools")
fi

if command -v zip >/dev/null 2>&1; then
  pushd "${DIST_DIR}" >/dev/null
  rm -f release-dist.zip
  zip -r release-dist.zip "${ARCHIVE_ITEMS[@]}" >/dev/null
  popd >/dev/null
fi

tar -czf "${DIST_DIR}/release-dist.tar.gz" -C "${DIST_DIR}" "${ARCHIVE_ITEMS[@]}"

echo "Release artifacts created in ${DIST_DIR}"
