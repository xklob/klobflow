#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
version="${1:?Usage: release.sh VERSION NOTES_FILE}"
notes="${2:?Provide release notes file}"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'Use a stable semantic version'; exit 1; }
: "${KLOBFLOW_SIGNING_PROPERTIES:?Set the external release signing properties path}"
git diff --exit-code
git diff --cached --exit-code
[[ -z "$(git ls-files --others --exclude-standard)" ]] || { echo 'Commit all source files first'; exit 1; }
rg -q "versionName = \"$version\"" app/build.gradle.kts
./gradlew testDebugUnitTest lintDebug assembleRelease
node --test companion/test/*.test.mjs
sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}}"
"$sdk/build-tools/36.0.0/apksigner" verify --verbose app/build/outputs/apk/release/app-release.apk
"$sdk/build-tools/36.0.0/zipalign" -c -P 16 4 app/build/outputs/apk/release/app-release.apk
mkdir -p artifacts
cp app/build/outputs/apk/release/app-release.apk "artifacts/klobflow-$version.apk"
python3 - "$version" <<'PY'
import pathlib,sys,zipfile
version=sys.argv[1]
with zipfile.ZipFile(f'artifacts/klobflow-companion-{version}.zip','w',zipfile.ZIP_DEFLATED) as z:
    for name in ['companion/server.mjs','companion/usb.mjs','companion/package.json','companion/package-lock.json','companion/README.md']:
        z.write(name, name.removeprefix('companion/'))
    for f in pathlib.Path('companion/public').iterdir():
        if f.is_file(): z.write(f,'public/'+f.name)
PY
(cd artifacts && sha256sum "klobflow-$version.apk" "klobflow-companion-$version.zip" > SHA256SUMS)
git tag -a "v$version" -m "Klobflow $version"
git push origin HEAD:main "v$version"
gh release create "v$version" "artifacts/klobflow-$version.apk" "artifacts/klobflow-companion-$version.zip" artifacts/SHA256SUMS --repo xklob/klobflow --title "Klobflow $version" --notes-file "$notes" --verify-tag
