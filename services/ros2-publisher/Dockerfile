# syntax=docker/dockerfile:1
# services/ros2-publisher: publishes the trajectories from NATS to ROS2 (C++20, ROS2 Jazzy, colcon).
# Build from the repository root (the context of every service image):
#   docker build -f services/ros2-publisher/Dockerfile -t ros2-publisher .
# The tests run in the CI `ros2-publisher` job, not in the image build.
# Runtime: non-root (uid 10001); ROS writes its logs under ROS_HOME=/tmp/ros
# (a tmpfs in compose, so the root filesystem can be read-only).

ARG ROS_BASE_IMAGE=ros:jazzy-ros-base@sha256:5147d3ae250ce754afd399f6bfec15b33dd4e473ca357e30432a3182031bfad6
ARG ROS_CORE_IMAGE=ros:jazzy-ros-core@sha256:d0b8e70ceecc98a1d475c6b9ca96de9c90bf4e91e7163bf4c7543b794ff7d1f2

FROM ${ROS_BASE_IMAGE} AS build
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
WORKDIR /src/ros2_publisher
COPY services/ros2-publisher/package.xml services/ros2-publisher/CMakeLists.txt ./
COPY services/ros2-publisher/include ./include
COPY services/ros2-publisher/src ./src
RUN source /opt/ros/jazzy/setup.bash \
 && colcon build --merge-install --install-base /opt/ros2_publisher \
      --cmake-args -DCMAKE_BUILD_TYPE=Release -DBUILD_TESTING=OFF

FROM ${ROS_CORE_IMAGE}
# linux-libc-dev holds the kernel headers: a build-time file set (pulled in by
# libc6-dev, which the ROS packages depend on), never used at runtime, and the
# source of every HIGH/CRITICAL finding of this image (kernel CVEs, which
# concern the host kernel, not a container). Removed without its dependents:
# nothing installs packages in this stage afterwards.
RUN dpkg --remove --force-depends linux-libc-dev
COPY --from=build /opt/ros2_publisher /opt/ros2_publisher
ENV ROS_HOME=/tmp/ros
USER 10001:10001
# No health endpoint (the node has no NATS or HTTP probe yet): liveness of
# PID 1 (the node, exec'd by the entrypoint below) only.
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD ["sh", "-c", "kill -0 1"]
ENTRYPOINT ["/bin/bash", "-c", "source /opt/ros/jazzy/setup.bash && source /opt/ros2_publisher/setup.bash && exec /opt/ros2_publisher/lib/ros2_publisher/ros2_publisher_node \"$@\"", "ros2_publisher"]
CMD []
