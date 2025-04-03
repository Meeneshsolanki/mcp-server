# MCP Server (Language Server Protocol)

A TypeScript-based Language Server Protocol implementation for code reference searching with support for multiple search strategies.

## Features

- 🔍 Fast code reference search using ripgrep
- 🌐 Web interface for easy searching
- 💻 Terminal interface for command-line usage
- 📊 Grouped results by file type
- 🔄 Fallback search mechanisms
- 🔥 Hot reload support for development

## Prerequisites

Before you begin, ensure you have the following installed:
- Node.js (v14 or higher)
- npm (comes with Node.js)
- Homebrew (for macOS users)
- ripgrep (recommended for faster searches)

## Installation

### 1. Clone the Repository
```bash
git clone <your-repository-url>
cd <repository-name>/src/mcp-server/v1
```

### 2. Install Homebrew (macOS only)
```bash
# Install Homebrew
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Add Homebrew to PATH (follow the instructions shown after installation)
# Usually these commands:
(echo; echo 'eval "$(/opt/homebrew/bin/brew shellenv)"') >> ~/.zprofile
eval "$(/opt/homebrew/bin/brew shellenv)"

# Restart your terminal or run
source ~/.zprofile
```

### 3. Install ripgrep
```bash
# macOS (using Homebrew)
brew install ripgrep

# Ubuntu/Debian
sudo apt-get update && sudo apt-get install ripgrep

# Fedora
sudo dnf install ripgrep

# Windows (using Chocolatey)
choco install ripgrep
```

### 4. Install Dependencies
```bash
npm install
```

## Usage

### Building the Project
```bash
npm run build
```

### Starting the Server

#### Production Mode
```bash
npm run start
```

#### Development Mode (with hot reload)
```bash
npm run dev
```

### Accessing the Interfaces

1. **Web Interface**
   - Open your browser and navigate to: `http://localhost:3000`
   - Enter your search term and directory
   - View results grouped by file type

2. **Terminal Interface**
   - The terminal interface starts automatically with the server
   - Follow the prompts to enter search terms
   - Results will be displayed in the terminal

## Search Strategies

The server uses multiple search strategies in the following order:

1. **ripgrep** (fastest)
   - Uses regular expressions for exact and partial matches
   - Excludes common directories (node_modules, .git, etc.)
   - Provides line numbers and context

2. **grep** (fallback)
   - Used if ripgrep is not available
   - Similar functionality but slower

3. **Node.js** (final fallback)
   - Pure JavaScript implementation
   - Used if neither ripgrep nor grep is available


## Configuration

### Environment Requirements
- The server automatically checks for required software
- Provides installation instructions if anything is missing
- Verifies correct working directory

### TypeScript Configuration
- Target: ES2020
- Module: CommonJS
- Strict type checking enabled
- Source maps generated for debugging

## Troubleshooting

### Common Issues

1. **Wrong Directory**
   - Ensure you're in the `src/mcp-server/v1` directory
   - Check the path shown in the environment check

2. **Homebrew Installation**
   - If Homebrew commands fail, ensure PATH is configured
   - Check `~/.zprofile` for Homebrew configuration

3. **ripgrep Not Found**
   - Verify Homebrew is installed and in PATH
   - Try reinstalling: `brew reinstall ripgrep`

4. **Port Already in Use**
   - The server will automatically find an available port
   - Default port is 3000

### Error Messages

If you see these errors, try the following:

1. `command not found: brew`
   - Reinstall Homebrew
   - Reconfigure PATH

2. `command not found: rg`
   - Install ripgrep: `brew install ripgrep`
   - Verify PATH configuration

3. `EADDRINUSE`
   - Port is in use
   - Server will automatically try another port

## Development

### Available Scripts

- `npm run build`: Build the project
- `npm run start`: Start in production mode
- `npm run dev`: Start with hot reload
- `npm run clean`: Clean build output

### Adding New Features

1. Modify `server.ts` for core functionality
2. Update `index.html` for web interface changes
3. Run in dev mode to test changes
4. Build and restart to apply
