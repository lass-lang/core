#!/bin/bash
# Updates test files to use new --- ... --- format

# This script transforms old format (JS\n---\nCSS) to new format (---\nJS\n---\nCSS)
# It handles various quote styles and multiline strings

set -e

file="$1"
backup="${file}.backup"

if [ ! -f "$file" ]; then
  echo "Usage: $0 <test-file.ts>"
  exit 1
fi

echo "Backing up $file to $backup"
cp "$file" "$backup"

echo "Transforming test patterns..."

# Pattern 1: transpile('const ... \n--- with single quotes
perl -i -pe "s/transpile\\('const /transpile\\('---\\\\nconst /g" "$file"

# Pattern 2: transpile("const ... \n--- with double quotes  
perl -i -pe 's/transpile\("const /transpile\("---\\nconst /g' "$file"

# Pattern 3: Handle empty preamble cases: '---\n to '---\n---\n
perl -i -pe "s/transpile\\('---\\\\n([^c])/transpile\\('---\\\\n---\\\\n\$1/g" "$file"
perl -i -pe 's/transpile\("---\\n([^c])/transpile\("---\\n---\\n$1/g' "$file"

# Pattern 4: Handle whitespace-only preamble
perl -i -pe "s/transpile\\('\\s+\\\\n---/transpile\\('---\\\\n   \\\\n---/g" "$file"

echo "Done! Original saved to $backup"
echo "Run: npm test -- $(basename $file) to verify"
