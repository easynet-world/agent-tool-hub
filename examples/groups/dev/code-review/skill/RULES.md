# Language-Specific Rules

## JavaScript / TypeScript

- No `console.log` in production code
- Prefer `const` over `let`; avoid `var`
- Functions should not exceed 50 lines
- Avoid deeply nested callbacks (max 3 levels)

## Python

- No `print()` in production code
- Functions should not exceed 40 lines
- Use type hints for function signatures
- Avoid mutable default arguments

## Go

- No `fmt.Println` in production code
- Functions should not exceed 60 lines
- Always handle returned errors
- Use `context.Context` as first parameter
