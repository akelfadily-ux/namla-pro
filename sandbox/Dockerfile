# The ONE approved sandbox image.
#
# Built locally in CI and referenced as namla-sandbox:v1. It contains the
# minimal runtime plus a NAMLA-owned verification toolchain installed only
# while the image is built. No package-manager operation runs at mission time.
#
# The uid/gid must match the approved image identity in containerSandboxBackend.ts.
FROM node@sha256:afdf98210b07b586eb71fa22ba2e432e058e4cd1304d31ed60888755b8c865fb

# Dedicated non-root identity. Never root, never a shared account.
RUN addgroup -g 10001 -S namla && adduser -u 10001 -S namla -G namla

# NAMLA-owned verification toolchain.
# TypeScript is locked to an exact version and package-lock integrity.
RUN mkdir -p /opt/namla-toolchain
COPY package.json package-lock.json /opt/namla-toolchain/
RUN cd /opt/namla-toolchain \
    && npm ci --ignore-scripts --no-audit --no-fund

# The single writable workspace and trusted auxiliary mount points.
RUN mkdir -p /workspace /namla-probe /src-readonly \
    && chown 10001:10001 /workspace

USER 10001:10001
WORKDIR /workspace

# No ENTRYPOINT: the backend always supplies a fixed argv array.
CMD ["node", "--version"]
