# Real vehicle models

The selected BMW M5 F90, Mercedes-AMG G63, and Nissan GT-R R35 visuals are now built locally in `src/render/RealVehicleModels.ts` from lightweight Three.js geometry.

No third-party GLB files are required. This keeps the web build and Android APK fully offline and avoids depending on authenticated model-hosting downloads.

The models use the real vehicles' approximate overall proportions and distinctive visual cues, while remaining intentionally low-poly for mobile performance. No manufacturer-provided 3D assets are bundled.
