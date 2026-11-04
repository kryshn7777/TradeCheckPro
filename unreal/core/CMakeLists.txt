cmake_minimum_required(VERSION 3.16)
project(AbyssalCore LANGUAGES CXX)

# The engine-independent game logic of Abyssal Tether, ported from the web build (docs/abyssal-tether-3d/plans/UNREAL_PORT.md).
# No Unreal, no platform code: it builds and is tested anywhere; the Unreal project links it as a module.
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
# Bit-for-bit repeatability against the web build's doubles: no fused multiply-add, no fast-math.
if(CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
  add_compile_options(-Wall -Wextra -ffp-contract=off)
endif()

add_library(at3d_core STATIC src/json.cpp)
target_include_directories(at3d_core PUBLIC include)

enable_testing()
add_executable(test_data tests/test_data.cpp)
target_link_libraries(test_data PRIVATE at3d_core)
target_compile_definitions(test_data PRIVATE AT3D_ROOT="${CMAKE_CURRENT_SOURCE_DIR}/..")
add_test(NAME data COMMAND test_data)
