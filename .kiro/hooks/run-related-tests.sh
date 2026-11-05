#!/bin/sh
# Extract file path from Kiro hook session context JSON on STDIN

# Check if packages exist and package.json exists (scaffold created)
if [ ! -d "packages" ] || [ ! -f "package.json" ]; then
  exit 0
fi

json_input=$(cat)

# Try multiple possible JSON keys for the file path
file_path=$(printf '%s' "$json_input" | node -e '
const data = JSON.parse(require("fs").readFileSync(0, "utf-8"));
const path = data.file || data.path || data.filePath || data.file_path || 
             (data.tool_input && (data.tool_input.path || data.tool_input.file_path));
if (path) console.log(path);
' 2>/dev/null)

# Check if we extracted a valid path
if [ -z "$file_path" ]; then
  echo "No file path found in hook context; running all workspace tests as fallback" >&2
  exec npm test --workspaces --if-present
fi

# Run vitest on the related file
exec npx vitest related --run "$file_path"
