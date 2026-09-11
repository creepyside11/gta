#!/usr/bin/env bash
set -euo pipefail

dest='GTA/Проект/public/models/environment'
mkdir -p "$dest"

curl -fL --retry 3 'https://raw.githubusercontent.com/syuhei176/ai-game-assets/main/models/environment/building_house.glb' -o "$dest/house-a.glb"
curl -fL --retry 3 'https://raw.githubusercontent.com/petroulacl/fps-buildings-env-kit/main/buildings/kenney-city-kit-suburban/Models/GLB%20format/building-type-b.glb' -o "$dest/house-b.glb"
curl -fL --retry 3 'https://raw.githubusercontent.com/petroulacl/fps-buildings-env-kit/main/buildings/kenney-city-kit-suburban/Models/GLB%20format/building-type-h.glb' -o "$dest/house-h.glb"
curl -fL --retry 3 'https://raw.githubusercontent.com/petroulacl/fps-buildings-env-kit/main/buildings/kenney-city-kit-suburban/Models/GLB%20format/building-type-i.glb' -o "$dest/house-i.glb"
curl -fL --retry 3 'https://raw.githubusercontent.com/syuhei176/ai-game-assets/main/models/environment/tree_oak.glb' -o "$dest/tree-oak.glb"
curl -fL --retry 3 'https://raw.githubusercontent.com/syuhei176/ai-game-assets/main/models/environment/tree_palm.glb' -o "$dest/tree-palm.glb"
curl -fL --retry 3 'https://raw.githubusercontent.com/syuhei176/ai-game-assets/main/models/environment/tree_pine.glb' -o "$dest/tree-pine.glb"
curl -fL --retry 3 'https://raw.githubusercontent.com/syuhei176/ai-game-assets/main/models/environment/rock_large.glb' -o "$dest/rock-large.glb"

python - <<'PY'
import json, struct
from pathlib import Path
root=Path('GTA/Проект/public/models/environment')
expected={'house-a.glb','house-b.glb','house-h.glb','house-i.glb','tree-oak.glb','tree-palm.glb','tree-pine.glb','rock-large.glb'}
assert {p.name for p in root.glob('*.glb')} >= expected
for path in root.glob('*.glb'):
    raw=path.read_bytes()
    assert raw[:4] == b'glTF', f'{path}: bad GLB magic'
    version,total=struct.unpack_from('<II', raw, 4)
    assert version == 2 and total == len(raw), f'{path}: invalid GLB header'
    chunk_len,chunk_type=struct.unpack_from('<II',raw,12)
    assert chunk_type == 0x4E4F534A, f'{path}: JSON chunk missing'
    doc=json.loads(raw[20:20+chunk_len].decode('utf-8').rstrip('\x00 '))
    external=[]
    for item in doc.get('buffers',[]):
        uri=item.get('uri')
        if uri and not uri.startswith('data:'): external.append(uri)
    for item in doc.get('images',[]):
        uri=item.get('uri')
        if uri and not uri.startswith('data:'): external.append(uri)
    assert not external, f'{path}: external dependencies {external}'
    print(path.name, len(raw), 'bytes OK')
PY

cat > "$dest/ASSETS.md" <<'EOF'
# Environment model assets

The GLB files in this directory are a curated subset of Kenney CC0 assets.

- `house-a.glb`, `house-b.glb`, `house-h.glb`, `house-i.glb`: Kenney City Kit (Suburban), Creative Commons CC0 1.0.
  Source: https://kenney.nl/assets/city-kit-suburban
- `tree-oak.glb`, `tree-palm.glb`, `tree-pine.glb`, `rock-large.glb`: Kenney Nature Kit, Creative Commons CC0 1.0.
  Source: https://kenney.nl/assets/nature-kit

Redistribution sources used for the exact GLB files:
- https://github.com/petroulacl/fps-buildings-env-kit
- https://github.com/syuhei176/ai-game-assets

CC0 1.0: https://creativecommons.org/publicdomain/zero/1.0/
Attribution is not required by CC0; provenance is retained here for auditability.
EOF
