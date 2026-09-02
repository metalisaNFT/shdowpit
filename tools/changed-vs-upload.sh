#!/bin/bash
# list files that differ from the pristine staged copy of the user's tree
U=/mnt/user-data/uploads/ShdowPit
cd "$(dirname "$0")/.."
for f in $(git ls-files -mo --exclude-standard | grep -v "^node_modules\|^dist/\|-shots/\|^\.vercel"); do
  if [ ! -f "$U/$f" ]; then echo "NEW $f"; elif ! cmp -s "$f" "$U/$f"; then echo "MOD $f"; fi
done
for f in $(cd $U && find . -type f | sed 's|^\./||'); do [ -f "$f" ] || echo "DEL $f"; done
