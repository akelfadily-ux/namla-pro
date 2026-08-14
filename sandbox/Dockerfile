# The ONE approved sandbox image.
#
# Built locally in CI and referenced as namla-sandbox:v1. It is deliberately
# minimal: a Node runtime and a dedicated non-root user, nothing else. No
# package manager step runs at mission time, and the image is never pulled
# during normal execution - only `docker image inspect` is consulted.
#
# The uid/gid must match the --user flag in containerSandboxBackend.ts.
FROM node:20-alpine

# Dedicated non-root identity. Never root, never a shared account.
RUN addgroup -g 10001 -S namla && adduser -u 10001 -S namla -G namla

# The single writable mount point and the read-only probe mount point.
RUN mkdir -p /workspace /namla-probe /src-readonly \
    && chown 10001:10001 /workspace

USER 10001:10001
WORKDIR /workspace

# No ENTRYPOINT: the backend always supplies a fixed argv array, so nothing can
# be injected through an image-level shell form.
CMD ["node", "--version"]
