#!/bin/bash

# Build script for agent-tool-hub
# This script builds the package and creates a zip file for distribution

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get version from package.json
VERSION=$(node -p "require('./package.json').version")
PACKAGE_NAME=$(node -p "require('./package.json').name")
ZIP_NAME="${PACKAGE_NAME}-${VERSION}.zip"
BUILD_DIR="build"
TEMP_DIR="${BUILD_DIR}/package"

echo -e "${GREEN}Building ${PACKAGE_NAME} v${VERSION}...${NC}"

# Clean previous builds
echo -e "${YELLOW}Cleaning previous builds...${NC}"
rm -rf "${BUILD_DIR}"
rm -f "${ZIP_NAME}"
npm run clean

# Build the project
echo -e "${YELLOW}Building TypeScript...${NC}"
npm run build

# Verify build output
if [ ! -d "dist" ]; then
    echo -e "${RED}Error: dist directory not found after build${NC}"
    exit 1
fi

# Create temporary package directory
echo -e "${YELLOW}Preparing package...${NC}"
mkdir -p "${TEMP_DIR}"

# Copy necessary files
echo -e "${YELLOW}Copying files...${NC}"
cp -r dist "${TEMP_DIR}/"
cp README.md "${TEMP_DIR}/"
cp toolhub.yaml "${TEMP_DIR}/" 2>/dev/null || true
cp -r examples "${TEMP_DIR}/" 2>/dev/null || true
mkdir -p "${TEMP_DIR}/scripts"
cp scripts/dump-tools.mjs "${TEMP_DIR}/scripts/" 2>/dev/null || true

# Create a modified package.json for distribution (dump:tools doesn't need to build)
# Copy package.json first, then modify the dump:tools script
cp package.json "${TEMP_DIR}/package.json"
# Use node to modify the package.json
node -e "const fs=require('fs');const p=fs.readFileSync('${TEMP_DIR}/package.json','utf8');const j=JSON.parse(p);j.scripts=j.scripts||{};j.scripts['dump:tools']='node scripts/dump-tools.mjs';fs.writeFileSync('${TEMP_DIR}/package.json',JSON.stringify(j,null,2)+'\n');"

# Create package.json for installation (optional: could include install instructions)
cat > "${TEMP_DIR}/INSTALL.md" << 'EOF'
# Installation Instructions

## Important: Extract First!

**npm cannot install directly from zip files.** You must extract the zip file first.

## Installation Steps

### Option 1: Local Installation (Recommended)

1. **Extract the zip file:**
   ```bash
   unzip agent-tool-hub-0.0.1.zip
   ```

2. **Navigate to the extracted directory:**
   ```bash
   cd package
   ```

3. **Install dependencies:**
   ```bash
   npm install
   ```

4. **Install peer dependencies (if needed):**
   ```bash
   npm install @langchain/core @modelcontextprotocol/sdk
   ```

### Option 2: Global Installation

1. **Extract the zip file:**
   ```bash
   unzip agent-tool-hub-0.0.1.zip
   ```

2. **Install globally from the extracted directory:**
   ```bash
   npm install -g ./package
   ```

   Or if you're already in the extracted `package` directory:
   ```bash
   npm install -g .
   ```

### Option 3: Install as Dependency in Another Project

1. **Extract the zip file to a location of your choice**

2. **In your project, install from the extracted path:**
   ```bash
   npm install /path/to/extracted/package
   ```

## Dependencies

This package requires:
- Node.js >= 18.0.0
- Optional peer dependencies:
  - `@langchain/core` (>=0.3.0) - for LangChain tool support
  - `@modelcontextprotocol/sdk` (>=1.0.0) - for MCP tool support

Install peer dependencies as needed:
```bash
npm install @langchain/core @modelcontextprotocol/sdk
```

## Usage

See README.md for usage instructions and examples.

## Available Scripts

After installation, you can use:

- `npm run dump:tools` - Dump all discovered tools to JSON (requires toolhub.yaml in the current directory)

**Note:** Make sure you're in the extracted `package/` directory when running npm scripts.
EOF

# Create zip file
echo -e "${YELLOW}Creating zip file: ${ZIP_NAME}...${NC}"
cd "${BUILD_DIR}"
zip -r "../${ZIP_NAME}" package -q
cd ..

# Clean up temporary directory
rm -rf "${BUILD_DIR}"

# Display results
FILE_SIZE=$(du -h "${ZIP_NAME}" | cut -f1)
echo -e "${GREEN}✓ Build complete!${NC}"
echo -e "${GREEN}  Package: ${ZIP_NAME}${NC}"
echo -e "${GREEN}  Size: ${FILE_SIZE}${NC}"
echo ""
echo -e "${YELLOW}Package contents:${NC}"
echo "  - dist/ (compiled JavaScript)"
echo "  - package.json"
echo "  - README.md"
echo "  - toolhub.yaml (example config)"
echo "  - examples/ (example tools)"
echo "  - scripts/ (utility scripts)"
echo "  - INSTALL.md (installation instructions)"
echo ""
echo -e "${GREEN}Installation Instructions:${NC}"
echo ""
echo -e "${YELLOW}⚠️  IMPORTANT: npm cannot install directly from zip files!${NC}"
echo -e "${YELLOW}   You must extract the zip file first.${NC}"
echo ""
echo -e "${GREEN}To install:${NC}"
echo "  1. Extract: unzip ${ZIP_NAME}"
echo "  2. Navigate: cd package"
echo "  3. Install: npm install"
echo "  4. (Optional) Install peers: npm install @langchain/core @modelcontextprotocol/sdk"
echo ""
echo -e "${GREEN}For global installation:${NC}"
echo "  1. Extract: unzip ${ZIP_NAME}"
echo "  2. Install: npm install -g ./package"
echo ""
echo -e "${YELLOW}See INSTALL.md in the package for detailed instructions.${NC}"
