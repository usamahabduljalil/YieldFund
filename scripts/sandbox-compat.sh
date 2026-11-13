#!/usr/bin/env bash
# Optional loader for Ubuntu 22.04 hosts. Only this process uses the extracted libc.
set -euo pipefail
: "${YIELDFUND_SANDBOX_BIN:?Set the absolute path to the official Sandbox 2.14.0 binary}"
: "${YIELDFUND_GLIBC_DIR:?Set the root of an extracted Ubuntu 24.04 libc6 package}"
lib="$YIELDFUND_GLIBC_DIR/usr/lib/x86_64-linux-gnu"
exec "$lib/ld-linux-x86-64.so.2" --library-path "$lib" "$YIELDFUND_SANDBOX_BIN" "$@"
