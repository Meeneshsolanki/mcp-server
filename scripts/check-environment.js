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

function installWithBrew(package) {
    console.log(`\n📦 Installing ${package} with Homebrew...`);
    try {
        console.log(`Running: brew install ${package}`);
        execSync(`brew install ${package}`, { stdio: 'inherit' });
        console.log(`✅ Successfully installed ${package}`);
        return true;
    } catch (error) {
        console.error(`❌ Failed to install ${package}:`, error.message);
        return false;
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
    const nodeVersion = executeCommand('node --version');

    if (!nodeVersion) {
        console.log('❌ Node.js is not installed');
        console.log('🔄 Installing Node.js...');
        return installWithBrew('node');
    }

    const currentVersion = nodeVersion.match(/^v(\d+)/)[1];
    console.log(`Current Node.js version: ${nodeVersion.trim()}`);

    if (parseInt(currentVersion) < requiredVersion) {
        console.log(`❌ Node.js version ${requiredVersion} or higher is required`);
        console.log('🔄 Updating Node.js...');
        return installWithBrew('node');
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
    console.log('🔄 Reinstalling Node.js to fix npm...');
    return installWithBrew('node');
}

function checkRipgrep() {
    console.log('\n=== Checking ripgrep Installation ===');
    const rgVersion = executeCommand('rg --version');

    if (!rgVersion) {
        console.log('❌ ripgrep is not installed');
        console.log('🔄 Installing ripgrep...');
        return installWithBrew('ripgrep');
    }

    console.log(`✅ ripgrep is installed (${rgVersion.split('\n')[0]})`);
    return true;
}

function checkDirectory() {
    console.log('\n=== Checking Working Directory ===');
    const currentDir = process.cwd();
    const requiredPath = path.join('mcp-server');

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

async function runChecks() {
    console.log('=== Environment Setup Check ===');

    const checks = [
        { name: 'Homebrew', check: checkHomebrew, required: true },
        { name: 'Homebrew PATH', check: checkBrewPath, required: true },
        { name: 'Node.js', check: checkNodeVersion, required: true },
        { name: 'npm', check: checkNpm, required: true },
        { name: 'ripgrep', check: checkRipgrep, required: true }, // Changed to required: true
        { name: 'Directory', check: checkDirectory, required: true }
    ];

    let allPassed = true;
    const results = [];

    for (const { name, check, required } of checks) {
        const passed = await check();
        if (!passed && required) {
            allPassed = false;
        }
        results.push({ name, passed, required });
    }

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
(async () => {
    try {
        if (!await runChecks()) {
            process.exit(1);
        }
    } catch (error) {
        console.error('\n❌ An unexpected error occurred:', error.message);
        process.exit(1);
    }
})();