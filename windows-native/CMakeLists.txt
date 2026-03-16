cmake_minimum_required(VERSION 3.24)
project(NeuralVNative LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")

set(NEURALV_VERSION "1.3.1")
if(EXISTS "${CMAKE_SOURCE_DIR}/../gradle.properties")
  file(STRINGS "${CMAKE_SOURCE_DIR}/../gradle.properties" NEURALV_VERSION_LINE REGEX "^neuralv\\.version=")
  if(NEURALV_VERSION_LINE)
    string(REGEX REPLACE "^neuralv\\.version=([0-9]+\\.[0-9]+\\.[0-9]+)$" "\\1" NEURALV_VERSION "${NEURALV_VERSION_LINE}")
  endif()
endif()

configure_file(
  "${CMAKE_SOURCE_DIR}/include/NeuralV/Config.h.in"
  "${CMAKE_BINARY_DIR}/generated/NeuralV/Config.h"
  @ONLY
)

set(NEURALV_COMMON_SOURCES
  src/ApiClient.cpp
  src/SessionStore.cpp
  src/Theme.cpp
)

add_executable(NeuralV WIN32
  src/main.cpp
  ${NEURALV_COMMON_SOURCES}
)

target_include_directories(NeuralV PRIVATE
  "${CMAKE_SOURCE_DIR}/include"
  "${CMAKE_BINARY_DIR}/generated"
)

target_compile_definitions(NeuralV PRIVATE UNICODE _UNICODE WIN32_LEAN_AND_MEAN NOMINMAX)
target_link_libraries(NeuralV PRIVATE winhttp dwmapi shlwapi shell32 comctl32 urlmon ole32)

add_executable(NeuralVSetup WIN32
  setup/SetupMain.cpp
  ${NEURALV_COMMON_SOURCES}
)

target_include_directories(NeuralVSetup PRIVATE
  "${CMAKE_SOURCE_DIR}/include"
  "${CMAKE_BINARY_DIR}/generated"
)

target_compile_definitions(NeuralVSetup PRIVATE UNICODE _UNICODE WIN32_LEAN_AND_MEAN NOMINMAX)
target_link_libraries(NeuralVSetup PRIVATE winhttp shlwapi shell32 comctl32 urlmon ole32)
