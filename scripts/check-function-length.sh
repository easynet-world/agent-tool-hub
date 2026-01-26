#!/bin/bash
# Check that no function exceeds 120 lines

MAX_LINES=120
EXIT_CODE=0

echo "Checking for functions exceeding ${MAX_LINES} lines..."

check_file() {
  local file="$1"
  local in_function=0
  local function_start=0
  local function_name=""
  local brace_count=0
  local line_num=0
  
  while IFS= read -r line; do
    ((line_num++))
    
    # Detect function start (various patterns)
    if [[ "$line" =~ ^[[:space:]]*(export[[:space:]]+)?(async[[:space:]]+)?function[[:space:]]+[a-zA-Z_][a-zA-Z0-9_]* ]] || \
       [[ "$line" =~ ^[[:space:]]*(export[[:space:]]+)?(async[[:space:]]+)?[a-zA-Z_][a-zA-Z0-9_]*[[:space:]]*=[[:space:]]*(async[[:space:]]+)?function ]] || \
       [[ "$line" =~ ^[[:space:]]*(export[[:space:]]+)?(public|private|protected)[[:space:]]+(async[[:space:]]+)?[a-zA-Z_][a-zA-Z0-9_]*[[:space:]]*\( ]] || \
       [[ "$line" =~ ^[[:space:]]*(async[[:space:]]+)?[a-zA-Z_][a-zA-Z0-9_]*[[:space:]]*:[[:space:]]*(async[[:space:]]+)?function ]] || \
       [[ "$line" =~ ^[[:space:]]*(async[[:space:]]+)?[a-zA-Z_][a-zA-Z0-9_]*[[:space:]]*\([^)]*\)[[:space:]]*\{[[:space:]]*$ ]] || \
       [[ "$line" =~ ^[[:space:]]*(async[[:space:]]+)?[a-zA-Z_][a-zA-Z0-9_]*[[:space:]]*\([^)]*\)[[:space:]]*=>[[:space:]]*\{ ]]; then
      
      if [ $in_function -eq 1 ]; then
        # Previous function ended, check its length
        local func_length=$((line_num - function_start))
        if [ $func_length -gt $MAX_LINES ]; then
          echo "❌ ERROR: $file:$function_start - Function '$function_name' has $func_length lines (exceeds limit of $MAX_LINES)"
          EXIT_CODE=1
        fi
      fi
      
      in_function=1
      function_start=$line_num
      function_name=$(echo "$line" | sed 's/^[[:space:]]*//' | cut -d'(' -f1 | sed 's/function[[:space:]]*//' | sed 's/async[[:space:]]*//' | sed 's/export[[:space:]]*//' | sed 's/const[[:space:]]*//' | sed 's/let[[:space:]]*//' | sed 's/var[[:space:]]*//' | sed 's/:[[:space:]]*$//' | sed 's/=[[:space:]]*$//' | awk '{print $NF}')
      brace_count=0
    fi
    
    # Count braces to detect function end
    if [ $in_function -eq 1 ]; then
      local open_braces=$(echo "$line" | grep -o '{' | wc -l)
      local close_braces=$(echo "$line" | grep -o '}' | wc -l)
      brace_count=$((brace_count + open_braces - close_braces))
      
      # Function ends when brace count returns to 0
      if [ $brace_count -le 0 ] && [[ "$line" =~ } ]]; then
        local func_length=$((line_num - function_start + 1))
        if [ $func_length -gt $MAX_LINES ]; then
          echo "❌ ERROR: $file:$function_start - Function '$function_name' has $func_length lines (exceeds limit of $MAX_LINES)"
          EXIT_CODE=1
        fi
        in_function=0
        function_name=""
        brace_count=0
      fi
    fi
  done < "$file"
  
  # Check last function if file ends while in function
  if [ $in_function -eq 1 ]; then
    local func_length=$((line_num - function_start + 1))
    if [ $func_length -gt $MAX_LINES ]; then
      echo "❌ ERROR: $file:$function_start - Function '$function_name' has $func_length lines (exceeds limit of $MAX_LINES)"
      EXIT_CODE=1
    fi
  fi
}

# Find all TypeScript files in src directory
while IFS= read -r file; do
  check_file "$file"
done < <(find src -name "*.ts" -type f)

if [ $EXIT_CODE -eq 0 ]; then
  echo "✅ All functions are within the ${MAX_LINES} line limit"
else
  echo ""
  echo "Please refactor functions that exceed ${MAX_LINES} lines into smaller functions."
fi

exit $EXIT_CODE
