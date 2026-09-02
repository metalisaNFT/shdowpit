#!/bin/bash
# rebuild dist and (re)start the preview server on :4173
cd "$(dirname "$0")/.."
pid=$(lsof -ti tcp:4173 2>/dev/null); [ -n "$pid" ] && kill $pid 2>/dev/null; sleep 0.5
npx vite build 2>&1 | grep -E "error|✓ built"
nohup npx vite preview --port 4173 > /tmp/preview.log 2>&1 &
for i in $(seq 1 30); do sleep 0.5; curl -s -o /dev/null http://localhost:4173/ && break; done
echo preview up
