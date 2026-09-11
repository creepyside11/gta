#!/usr/bin/env bash
set -euo pipefail

dest='GTA/Проект/public/models/environment'
mkdir -p "$dest/Textures"

base='https://raw.githubusercontent.com/bevyengine/bevy_asset_files/main/kenney/city-kit-suburban'
curl -fL --retry 3 "$base/building-type-a.glb" -o "$dest/house-a.glb"
curl -fL --retry 3 "$base/building-type-d.glb" -o "$dest/house-b.glb"
curl -fL --retry 3 "$base/building-type-h.glb" -o "$dest/house-h.glb"
curl -fL --retry 3 "$base/building-type-i.glb" -o "$dest/house-i.glb"
curl -fL --retry 3 "$base/Textures/colormap.png" -o "$dest/Textures/colormap.png"
curl -fL --retry 3 'https://raw.githubusercontent.com/syuhei176/ai-game-assets/main/models/environment/tree_oak.glb' -o "$dest/tree-oak.glb"
curl -fL --retry 3 'https://raw.githubusercontent.com/syuhei176/ai-game-assets/main/models/environment/tree_palm.glb' -o "$dest/tree-palm.glb"
curl -fL --retry 3 'https://raw.githubusercontent.com/syuhei176/ai-game-assets/main/models/environment/tree_pine.glb' -o "$dest/tree-pine.glb"
curl -fL --retry 3 'https://raw.githubusercontent.com/syuhei176/ai-game-assets/main/models/environment/rock_large.glb' -o "$dest/rock-large.glb"

python - <<'PY'
import json, struct
from pathlib import Path
root=Path('GTA/Проект/public/models/environment').resolve()
expected={'house-a.glb','house-b.glb','house-h.glb','house-i.glb','tree-oak.glb','tree-palm.glb','tree-pine.glb','rock-large.glb'}
assert {p.name for p in root.glob('*.glb')} >= expected
assert (root/'Textures/colormap.png').is_file()
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
    for uri in external:
        dependency=(path.parent/uri).resolve()
        assert root in dependency.parents or dependency == root, f'{path}: unsafe dependency {uri}'
        assert dependency.is_file(), f'{path}: missing dependency {uri}'
    print(path.name, len(raw), 'bytes OK', ('dependencies=' + ','.join(external)) if external else 'self-contained')
PY

cat > "$dest/ASSETS.md" <<'EOF'
# Environment model assets

The environment models in this directory are a curated subset of Kenney CC0 assets.

- `house-a.glb`, `house-b.glb`, `house-h.glb`, `house-i.glb` and `Textures/colormap.png`: Kenney City Kit (Suburban), Creative Commons CC0 1.0.
  Source: https://kenney.nl/assets/city-kit-suburban
- `tree-oak.glb`, `tree-palm.glb`, `tree-pine.glb`, `rock-large.glb`: Kenney Nature Kit, Creative Commons CC0 1.0.
  Source: https://kenney.nl/assets/nature-kit

Exact redistribution sources used by the automated importer:
- https://github.com/bevyengine/bevy_asset_files/tree/main/kenney/city-kit-suburban
- https://github.com/syuhei176/ai-game-assets/tree/main/models/environment

CC0 1.0: https://creativecommons.org/publicdomain/zero/1.0/
Attribution is not required by CC0; provenance is retained here for auditability.
EOF
