# Asset Licenses

## UI typography and identity (2026-10-17)

`assets/fonts/strata-sans-sc.woff2` is a character subset of the variable [Noto Sans SC](https://github.com/google/fonts/tree/main/ofl/notosanssc) font, licensed under the SIL Open Font License 1.1. The complete license accompanies it at `assets/fonts/OFL.txt`. CSS refers to this font using the local family alias `Strata Sans`. `tools/build-ui-font.py` reproduces the subset from the upstream TTF, using characters in the project's HTML, JavaScript and data. Regenerate when new interface characters are added; system fonts cover characters outside the subset. Fonts load locally without an external font service.

`images/strataeye-mark.svg` is original project geometry: a stylized eye framed by rock strata. It has no third-party image dependency.

This project uses only assets with traceable licenses. Model archives must be downloaded through their official download controls. Sketchfab preview/cache files are not acceptable substitutes for official archives.

## Poly Haven Textures

All Poly Haven assets are licensed under CC0 1.0. The files below were downloaded on 2026-07-28 through the public Poly Haven API and verified against the published MD5 hashes.

| Local directory | Source | Usage | Resolution |
| --- | --- | --- | --- |
| `assets/textures/dark_rock_02` | [Dark Rock 02](https://polyhaven.com/a/dark_rock_02) | Coal wall and dark roof strata | 2K |
| `assets/textures/quarry_wall` | [Quarry Wall](https://polyhaven.com/a/quarry_wall) | Rough roadway wall and exposed rock | 2K |
| `assets/textures/rock_ground` | [Rock Ground](https://polyhaven.com/a/rock_ground) | Roadway floor | 1K |
| `assets/textures/metal_plate_02` | [Metal Plate 02](https://polyhaven.com/a/metal_plate_02) | Worn machinery metal | 2K |
| `assets/textures/blue_metal_plate` | [Blue Metal Plate](https://polyhaven.com/a/blue_metal_plate) | Painted equipment panels | 1K |
| `assets/textures/rust_coarse_01` | [Rust Coarse 01](https://polyhaven.com/a/rust_coarse_01) | Rust and wear overlays | 1K |

Each texture set contains diffuse, OpenGL normal, and ARM maps. ARM channels are ambient occlusion, roughness, and metallic respectively.

## Poly Haven HDRI

The environment map is licensed under CC0 1.0 and was downloaded from Poly Haven on 2026-07-28.

| Local file | Source | Usage | MD5 |
| --- | --- | --- | --- |
| `assets/hdri/quarry_02_1k.hdr` | [Quarry 02](https://polyhaven.com/a/quarry_02) | Lightweight fallback environment | `d7e060c7ed5c7dac69b44a859a08caf0` |
| `assets/hdri/quarry_02_4k.hdr` | [Quarry 02](https://polyhaven.com/a/quarry_02) | Primary quarry sky, reflections, and outdoor illumination | `907b9c44f0a3878f1db7a6fa085a1752` |

## Shortlisted Sketchfab Models

These models are licensed under Creative Commons Attribution 4.0 and are marked downloadable by the Sketchfab public API. Their official archives have not yet been added because Sketchfab requires an authenticated download session.

| Intended use | Model and author | License | Status |
| --- | --- | --- | --- |
| Mine scan source | [Ferriere Mines - Lower Tunnels](https://sketchfab.com/3d-models/ferriere-mines-lower-tunnels-17ba7a7ddbfb4d17a86ea1b405c9f5ea), Riccardo Rocca | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Official download pending |
| Roadheader | [PK-3R Roadheader](https://sketchfab.com/3d-models/pk-3r-roadheader-e89ca2fe0f9f41b88780632269de9e30), almapalinka | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Official download pending |
| Conveyor modules | [Quarry Conveyor system Kit](https://sketchfab.com/3d-models/quarry-conveyor-system-kit-badf50e9d6ea47ac814e1cae037799ed), Dumokan Art | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Official download pending |
| Mine locomotive | [Narrow gauge electric locomotive](https://sketchfab.com/3d-models/narrow-gauge-electric-locomotive-9863ce9aa4c449758a304a92dbb03d6f), Lyskilde | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Official download pending |
| Mine cart | [Mine cart Rusted](https://sketchfab.com/3d-models/mine-cart-rusted-0b391322171c449fa0eb9092416fd2a6), Gustavo Simas | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Official download pending |
| Ventilation kit | [Modular Ventilation Duct Kit Free](https://sketchfab.com/3d-models/modular-ventilation-duct-kit-free-d4e35aa0424a43ec9f34d7f8341236a0), AMMediaGames | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Official download pending |
| Industrial props | [Industrial asset pack](https://sketchfab.com/3d-models/industrial-asset-pack-free-94c5011772a84e8791779b342467f245), ForevereQ | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Official download pending |
| CCTV camera | [Weathered CCTV Security Camera](https://sketchfab.com/3d-models/weathered-cctv-security-camera-rigged-256f864b503d4ff9becbb08d1f51dee7), garwiglino1 | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Official download pending |
| Animated worker | [Low-Poly Construction Workers](https://sketchfab.com/3d-models/low-poly-construction-workers-animated-7b62e6e1b58c476f8b421dd007a4ff90), Jungle Jim | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Official download pending |

## Custom Assets

No shortlisted free hydraulic support or double-drum shearer met the combined realism, download, license, and Web-performance requirements. The current scene therefore uses original project geometry for the powered roof supports, double-drum shearer, face conveyor, narrow-gauge train, mine carts, worker, CCTV, ventilation ducting, pipework, roof bolts, and steel ribs. These parts are authored in `js/scene/photoreal-mine.js` from extruded profiles, rounded industrial housings, tubes, fasteners, and articulated groups; their PBR surface response uses the CC0 texture sets listed above.

The original geometry contains no extracted TaiChi/AirCity data, Sketchfab viewer cache, or third-party model mesh. If an official Sketchfab archive is later added, its author, license, download date, original format, and project modifications must be recorded here before release.
