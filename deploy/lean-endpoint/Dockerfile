# A Lean 4 + Mathlib server, reachable over a WebSocket.
#
# This is the thing Conjecture talks to when you do not want Lean on your own
# machine. Build it once, run it somewhere with enough memory, and point the app
# at it with --lean-endpoint.
#
# It is deliberately a separate image from the app. Elaboration is the part that
# needs 4 GB and a warm Mathlib cache; the workspace itself needs neither, and
# tying their lifecycles together would mean a 20-minute deploy to fix a typo in
# the UI.

FROM debian:bookworm-slim AS lean

ARG LEAN_VERSION=4.9.0
ARG MATHLIB_REV=master

ENV DEBIAN_FRONTEND=noninteractive \
    ELAN_HOME=/opt/elan \
    PATH=/opt/elan/bin:/usr/local/bin:/usr/bin:/bin

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl git build-essential \
    && rm -rf /var/lib/apt/lists/*

# elan is Lean's toolchain manager. Pinning the version here is what makes the
# receipts this endpoint produces mean anything.
RUN curl -fsSL https://raw.githubusercontent.com/leanprover/elan/master/elan-init.sh \
      -o /tmp/elan-init.sh \
 && sh /tmp/elan-init.sh -y --default-toolchain "leanprover/lean4:v${LEAN_VERSION}" \
 && rm /tmp/elan-init.sh

WORKDIR /workspace

# A project that depends on Mathlib, and nothing else.
RUN mkdir -p ConjectureEndpoint \
 && printf 'leanprover/lean4:v%s\n' "${LEAN_VERSION}" > lean-toolchain \
 && printf 'import Lake\nopen Lake DSL\n\npackage «conjecture-endpoint»\n\nrequire mathlib from git\n  "https://github.com/leanprover-community/mathlib4.git" @ "%s"\n\n@[default_target]\nlean_lib «ConjectureEndpoint»\n' "${MATHLIB_REV}" > lakefile.lean \
 && printf 'import Mathlib\n' > ConjectureEndpoint.lean

# `lake exe cache get` pulls prebuilt Mathlib oleans. Without it this step
# compiles Mathlib from source, which takes hours rather than minutes.
RUN lake update \
 && lake exe cache get \
 && lake build

# ── the server ────────────────────────────────────────────────────────────────
FROM lean AS server

RUN apt-get update && apt-get install -y --no-install-recommends \
      nodejs npm bubblewrap \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt

# lean4web serves `lake serve` over a WebSocket at /websocket/<project>, which
# is the shape RemoteLeanEngine speaks.
RUN git clone --depth 1 --recurse-submodules \
      https://github.com/leanprover-community/lean4web.git \
 && cd lean4web \
 && npm install \
 && npm run build

# Projects are served by directory name. /workspace becomes `mathlib`.
RUN mkdir -p /opt/lean4web/Projects \
 && ln -s /workspace /opt/lean4web/Projects/mathlib

ENV PORT=8080 \
    PROJECTS_BASE_PATH=/opt/lean4web/Projects \
    NODE_ENV=production

EXPOSE 8080

WORKDIR /opt/lean4web

# Bubblewrap sandboxes each Lean process. Anyone who can reach this endpoint can
# run arbitrary elaboration on it, so do not disable it and do not expose this
# to the open internet without something in front.
CMD ["npm", "run", "prod"]
