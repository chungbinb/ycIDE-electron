cmake_minimum_required(VERSION 3.24)
project(ycide_eui_poc LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

find_package(EuiNeo 0.6.3 EXACT CONFIG REQUIRED)
if(NOT EUI_NEO_WINDOW_BACKEND STREQUAL "glfw"
   OR NOT EUI_NEO_RENDER_BACKEND STREQUAL "opengl")
    message(FATAL_ERROR "This proof of concept requires the GLFW + OpenGL SDK.")
endif()

add_library(poc_ui STATIC demo.cpp)
target_link_libraries(poc_ui PUBLIC eui::neo)
if(MSVC)
    target_compile_options(poc_ui PUBLIC /utf-8 /W4)
endif()

add_executable(ycide_eui_poc)
target_link_libraries(ycide_eui_poc PRIVATE poc_ui)
eui_neo_configure_app(ycide_eui_poc)
add_custom_command(TARGET ycide_eui_poc POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
        "${CMAKE_CURRENT_SOURCE_DIR}/assets/layout-preview.svg"
        "$<TARGET_FILE_DIR:ycide_eui_poc>/assets/layout-preview.svg"
    VERBATIM
)

include(CTest)
if(BUILD_TESTING)
    add_executable(poc_ui_tests demo_tests.cpp)
    target_link_libraries(poc_ui_tests PRIVATE poc_ui)
    add_test(NAME poc_ui_interactions COMMAND poc_ui_tests)
endif()
