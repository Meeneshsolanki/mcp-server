const { execSync } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

function executeCommand(command) {
    try {
        return execSync(command, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
        return null;
    }
}

function checkHomebrew() {
    console.log('\n=== Checking Homebrew Installation ===');
    const brewVersion = executeCommand('brew --version');

    if (brewVersion) {
        console.log(`✅ Homebrew is installed (${brewVersion.split('\n')[0]})`);
        return true;
    }

    console.log('❌ Homebrew is not installed');
    console.log('\nTo install Homebrew:');
    console.log('1. Run the installation script:');
    console.log('/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"');
    console.log('\n2. Follow the on-screen instructions');
    console.log('\n3. Add Homebrew to your PATH:');
    console.log('echo \'eval "$(/opt/homebrew/bin/brew shellenv)"\' >> ~/.zprofile');
    console.log('eval "$(/opt/homebrew/bin/brew shellenv)"');
    console.log('\nNote: For Intel Macs, the path might be /usr/local/bin instead of /opt/homebrew/bin');
    return false;
}

function checkBrewPath() {
    console.log('\n=== Checking Homebrew PATH Configuration ===');
    const shell = process.env.SHELL || '/bin/zsh';
    const isZsh = shell.includes('zsh');
    const rcFile = isZsh ? '.zprofile' : '.bash_profile';

    try {
        const homeDir = os.homedir();
        const rcPath = path.join(homeDir, rcFile);

        if (!fs.existsSync(rcPath)) {
            console.log(`⚠️  ${rcFile} does not exist. Creating it...`);
            return false;
        }

        const rcContent = fs.readFileSync(rcPath, 'utf8');
        if (!rcContent.includes('brew shellenv')) {
            console.log('❌ Homebrew PATH is not configured');
            console.log(`\nAdd Homebrew to your ${rcFile}:`);
            console.log(`echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/${rcFile}`);
            console.log('eval "$(/opt/homebrew/bin/brew shellenv)"');
            return false;
        }

        console.log('✅ Homebrew PATH is properly configured');
        return true;
    } catch (error) {
        console.log(`⚠️  Could not verify ${rcFile} configuration:`, error.message);
        return false;
    }
}

function checkNodeVersion() {
    console.log('\n=== Checking Node.js Installation ===');
    const requiredVersion = 14;
    const currentVersion = process.version.match(/^v(\d+)/)[1];

    console.log(`Current Node.js version: ${process.version}`);

    if (parseInt(currentVersion) < requiredVersion) {
        console.log(`❌ Node.js version ${requiredVersion} or higher is required`);
        if (os.platform() === 'darwin') {
            console.log('\nTo install/update Node.js on macOS:');
            if (executeCommand('brew --version')) {
                console.log('\nUsing Homebrew:');
                console.log('brew install node@14');
                console.log('brew link node@14');
            } else {
                console.log('\nUsing nvm (Node Version Manager):');
                console.log('1. Install nvm:');
                console.log('curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash');
                console.log('\n2. Restart your terminal and install Node.js:');
                console.log('nvm install 14');
                console.log('nvm use 14');
            }
        } else if (os.platform() === 'linux') {
            console.log('\nOn Ubuntu/Debian:');
            console.log('curl -fsSL https://deb.nodesource.com/setup_14.x | sudo -E bash -');
            console.log('sudo apt-get install -y nodejs');
        } else if (os.platform() === 'win32') {
            console.log('\nOn Windows:');
            console.log('1. Download Node.js installer from: https://nodejs.org/');
            console.log('2. Run the installer');
        }
        return false;
    }
    console.log('✅ Node.js version is compatible');
    return true;
}

function checkNpm() {
    console.log('\n=== Checking npm Installation ===');
    const npmVersion = executeCommand('npm --version');

    if (npmVersion) {
        console.log(`✅ npm is installed (version ${npmVersion.trim()})`);
        return true;
    }

    console.log('❌ npm is not installed properly');
    console.log('Please reinstall Node.js which includes npm');
    return false;
}

function checkRipgrep() {
    console.log('\n=== Checking ripgrep Installation ===');
    const rgVersion = executeCommand('rg --version');

    if (rgVersion) {
        console.log(`✅ ripgrep is installed (${rgVersion.split('\n')[0]})`);
        return true;
    }

    console.log('❌ ripgrep is not installed');

    switch (os.platform()) {
        case 'darwin':
            if (executeCommand('brew --version')) {
                console.log('\nTo install ripgrep using Homebrew:');
                console.log('brew install ripgrep');
            } else {
                console.log('\nPlease install Homebrew first, then run:');
                console.log('brew install ripgrep');
            }
            break;

        case 'linux':
            console.log('\nOn Ubuntu/Debian:');
            console.log('sudo apt-get update && sudo apt-get install ripgrep');
            console.log('\nOn Fedora:');
            console.log('sudo dnf install ripgrep');
            break;

        case 'win32':
            console.log('\nOn Windows:');
            console.log('Using Chocolatey:');
            console.log('choco install ripgrep');
            console.log('\nOr using Scoop:');
            console.log('scoop install ripgrep');
            break;

        default:
            console.log('\nPlease visit: https://github.com/BurntSushi/ripgrep#installation');
    }

    return false;
}

function checkDirectory() {
    console.log('\n=== Checking Working Directory ===');
    const currentDir = process.cwd();
    const requiredPath = path.join('src', 'mcp-server', 'v1');

    console.log(`Current directory: ${currentDir}`);
    console.log(`Required path should end with: ${requiredPath}`);

    if (!currentDir.endsWith(requiredPath)) {
        console.log('\n❌ You are in the wrong directory!');
        console.log('Please navigate to the correct directory:');
        console.log(`cd path/to/${requiredPath}`);
        return false;
    }

    console.log('✅ Working directory is correct');
    return true;
}

function printStartupInstructions() {
    console.log('\n=== MCP Server Startup Instructions ===');
    console.log('1. Install dependencies:');
    console.log('   npm install');
    console.log('\n2. Build the project:');
    console.log('   npm run build');
    console.log('\n3. Start the server:');
    console.log('   npm run start');
    console.log('\nFor development with hot reload:');
    console.log('   npm run dev');
    console.log('\nThe server will be available at:');
    console.log('   http://localhost:3000');
}

function runChecks() {
    console.log('=== Environment Setup Check ===');

    const checks = [
        { name: 'Homebrew', check: checkHomebrew, required: true },
        { name: 'Homebrew PATH', check: checkBrewPath, required: true },
        { name: 'Node.js', check: checkNodeVersion, required: true },
        { name: 'npm', check: checkNpm, required: true },
        { name: 'ripgrep', check: checkRipgrep, required: false },
        { name: 'Directory', check: checkDirectory, required: true }
    ];

    let allPassed = true;
    const results = checks.map(({ name, check, required }) => {
        const passed = check();
        if (!passed && required) {
            allPassed = false;
        }
        return { name, passed, required };
    });

    console.log('\n=== Installation Summary ===');
    results.forEach(({ name, passed, required }) => {
        const status = passed ? '✅' : (required ? '❌' : '⚠️');
        const requiredText = required ? '(required)' : '(optional)';
        console.log(`${status} ${name} ${!passed ? requiredText : ''}`);
    });

    if (allPassed) {
        console.log('\n✅ Environment is ready!');
        printStartupInstructions();
        return true;
    } else {
        console.log('\n❌ Please fix the above issues before proceeding');
        console.log('\nAfter making the necessary installations, run:');
        console.log('npm run start');
        return false;
    }
}

// Handle errors gracefully
process.on('uncaughtException', (error) => {
    console.error('\n❌ An unexpected error occurred:', error.message);
    process.exit(1);
});

// Run all checks and exit with appropriate code
if (!runChecks()) {
    process.exit(1);
}