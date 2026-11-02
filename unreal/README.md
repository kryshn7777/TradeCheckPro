# unreal/: the Unreal Engine port of Abyssal Tether

Plan, phases and the owner's PC setup: `docs/abyssal-tether-3d/plans/UNREAL_PORT.md`.

- `tools/export-data.mjs`: writes `data/*.json` (constants, difficulties, Chapter I level) from the web build. `node unreal/tools/export-data.mjs`
- `tools/golden-traces.mjs`: records the web build's physics per fixed step into `golden/` for the C++ port to reproduce. `node unreal/tools/golden-traces.mjs`
- `core/`: the engine-independent game logic in C++17 (CMake). Build and test: `cmake -S unreal/core -B unreal/core/build -G Ninja && cmake --build unreal/core/build && ctest --test-dir unreal/core/build`
- `AbyssalTether/`: the Unreal project (not created yet; it is built on the owner's PC).
Re-run both tools after any change to `public/abyssal-tether-3d/src/sim/` or the level data.
