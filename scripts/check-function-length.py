#!/usr/bin/env python3
"""
Check that no function exceeds 120 lines.
"""
import re
import sys
from pathlib import Path

MAX_LINES = 120
EXIT_CODE = 0

def count_function_lines(content, start_line):
    """Count lines in a function starting at start_line."""
    lines = content.split('\n')
    brace_count = 0
    in_function = False
    function_start = start_line - 1
    
    for i in range(function_start, len(lines)):
        line = lines[i]
        
        # Count braces
        open_braces = line.count('{')
        close_braces = line.count('}')
        brace_count += open_braces - close_braces
        
        if not in_function:
            in_function = True
        
        # Function ends when brace count returns to 0 or negative
        if in_function and brace_count <= 0 and '}' in line:
            return i - function_start + 1
    
    # If function doesn't end, return remaining lines
    return len(lines) - function_start

def find_functions(file_path):
    """Find all functions in a TypeScript file."""
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    lines = content.split('\n')
    functions = []
    
    # Patterns to match function declarations
    patterns = [
        r'^\s*(export\s+)?(async\s+)?function\s+(\w+)',
        r'^\s*(export\s+)?(async\s+)?(\w+)\s*[:=]\s*(async\s+)?function',
        r'^\s*(public|private|protected)\s+(async\s+)?(\w+)\s*\(',
        r'^\s*(async\s+)?(\w+)\s*\([^)]*\)\s*[:=]\s*\{',
        r'^\s*(async\s+)?(\w+)\s*\([^)]*\)\s*=>\s*\{',
        r'^\s*(\w+)\s*:\s*(async\s+)?function',
    ]
    
    for i, line in enumerate(lines, 1):
        for pattern in patterns:
            match = re.search(pattern, line)
            if match:
                # Extract function name
                func_name = match.group(match.lastindex) if match.lastindex else 'anonymous'
                
                # Count function lines
                func_lines = count_function_lines(content, i)
                
                if func_lines > MAX_LINES:
                    functions.append((i, func_name, func_lines))
                break
    
    return functions

def main():
    global EXIT_CODE
    
    print(f"Checking for functions exceeding {MAX_LINES} lines...")
    print()
    
    src_dir = Path('src')
    if not src_dir.exists():
        print("Error: src directory not found")
        sys.exit(1)
    
    for ts_file in src_dir.rglob('*.ts'):
        functions = find_functions(ts_file)
        for line_num, func_name, func_lines in functions:
            print(f"❌ ERROR: {ts_file}:{line_num} - Function '{func_name}' has {func_lines} lines (exceeds limit of {MAX_LINES})")
            EXIT_CODE = 1
    
    if EXIT_CODE == 0:
        print(f"✅ All functions are within the {MAX_LINES} line limit")
    else:
        print()
        print(f"Please refactor functions that exceed {MAX_LINES} lines into smaller functions.")
    
    sys.exit(EXIT_CODE)

if __name__ == '__main__':
    main()
