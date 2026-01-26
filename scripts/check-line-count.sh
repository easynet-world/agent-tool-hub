#!/bin/bash
# Check that no TypeScript files exceed 500 lines

MAX_LINES=500
EXIT_CODE=0

echo "Checking for files exceeding ${MAX_LINES} lines..."

# Find all TypeScript files in src and __tests__ directories
while IFS= read -r file; do
  lines=$(wc -l < "$file" | tr -d ' ')
  if [ "$lines" -gt "$MAX_LINES" ]; then
    echo "❌ ERROR: $file has $lines lines (exceeds limit of $MAX_LINES)"
    EXIT_CODE=1
  fi
done < <(find src __tests__ -name "*.ts" -type f)

if [ $EXIT_CODE -eq 0 ]; then
  echo "✅ All files are within the ${MAX_LINES} line limit"
else
  echo ""
  echo "Please refactor files that exceed ${MAX_LINES} lines into smaller modules."
fi

exit $EXIT_CODE
