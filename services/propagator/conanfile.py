"""Conan 2 recipe of the propagator: dependencies and CMake integration.

`conan install . --build=missing` (with `-s compiler.cppstd=20` in CI) writes
the toolchain in build/Release/generators/, which the `release` preset of
CMakePresets.json uses.
"""

from conan import ConanFile
from conan.tools.cmake import cmake_layout


class PropagatorConan(ConanFile):
    name = "propagator"
    settings = "os", "arch", "compiler", "build_type"
    generators = "CMakeToolchain", "CMakeDeps"

    # The dev stack and minikube run NATS without TLS: no OpenSSL until a
    # deployment needs it.
    default_options = {"cnats/*:with_tls": False}

    def requirements(self):
        self.requires("cnats/3.14.0")

    def build_requirements(self):
        self.test_requires("gtest/1.18.0")

    def layout(self):
        cmake_layout(self)
