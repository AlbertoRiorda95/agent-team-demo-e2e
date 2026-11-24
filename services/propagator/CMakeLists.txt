cmake_minimum_required(VERSION 3.23)
project(propagator VERSION 0.0.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

option(PROPAGATOR_CLANG_TIDY "Run clang-tidy on the propagator sources" ON)
if(PROPAGATOR_CLANG_TIDY)
  find_program(CLANG_TIDY_EXE NAMES clang-tidy)
  if(CLANG_TIDY_EXE)
    message(STATUS "clang-tidy: ${CLANG_TIDY_EXE}")
  else()
    message(WARNING "clang-tidy not found: static analysis skipped")
  endif()
endif()

find_package(cnats REQUIRED CONFIG)
find_package(protobuf REQUIRED CONFIG)

# The committed generated code of trajectory.v1 (scripts/generate-proto.sh):
# SYSTEM includes and no clang-tidy, it is not ours to lint.
file(GLOB TRAJECTORY_PROTO_SOURCES CONFIGURE_DEPENDS src/gen/trajectory/v1/*.pb.cc)
add_library(trajectory_proto STATIC ${TRAJECTORY_PROTO_SOURCES})
target_include_directories(trajectory_proto SYSTEM PUBLIC src/gen)
target_link_libraries(trajectory_proto PUBLIC protobuf::libprotobuf)

add_library(propagator_core src/propagator.cpp src/propagate.cpp)
target_include_directories(propagator_core PUBLIC include)
target_link_libraries(propagator_core PUBLIC trajectory_proto PRIVATE cnats::nats_static)
target_compile_options(propagator_core PRIVATE -Wall -Wextra -Wpedantic -Werror)

add_executable(propagator src/main.cpp)
target_link_libraries(propagator PRIVATE propagator_core cnats::nats_static)
target_compile_options(propagator PRIVATE -Wall -Wextra -Wpedantic -Werror)

if(CLANG_TIDY_EXE)
  set_target_properties(propagator_core propagator PROPERTIES CXX_CLANG_TIDY "${CLANG_TIDY_EXE}")
endif()

include(CTest)
if(BUILD_TESTING)
  find_package(GTest REQUIRED CONFIG)
  add_executable(propagator_tests tests/smoke_test.cpp tests/propagate_test.cpp)
  target_link_libraries(propagator_tests PRIVATE propagator_core GTest::gtest_main)
  target_compile_options(propagator_tests PRIVATE -Wall -Wextra -Wpedantic -Werror)
  include(GoogleTest)
  gtest_discover_tests(propagator_tests)
endif()

install(TARGETS propagator RUNTIME DESTINATION bin)
