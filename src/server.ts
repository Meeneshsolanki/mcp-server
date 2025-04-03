import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import * as readline from 'readline';
import * as ts from 'typescript';
import * as net from 'net';

const execAsync = promisify(exec);

interface SearchRequest {
    word: string;
    directory: string;
    searchStrategy?: 'grep' | 'node' | 'typescript' | 'all';
}

interface Location {
    file: string;
    line: number;
    column: number;
    text: string;
    isExactMatch?: boolean;
}

interface TypeScriptSearchOptions {
    word: string;
    directory: string;
    isSymbolSearch?: boolean;
}

interface TypeScriptReference extends Location {
    kind: ts.SyntaxKind;
    symbolName?: string;
    isDefinition?: boolean;
}

interface EnhancedLocation extends Location {
    context?: string;
    fileType: string;
    relativePath: string;
    kind?: ts.SyntaxKind;
    symbolName?: string;
    isDefinition?: boolean;
}

interface GroupedReferences {
    [fileType: string]: EnhancedLocation[];
}

interface FileGroups {
    [key: string]: Location[];
}

interface FileTypes {
    [key: string]: number;
}

interface EnhancedSearchResult {
    references: EnhancedLocation[];
    groupedByFileType: GroupedReferences;
    summary: {
        totalFiles: number;
        totalMatches: number;
        fileTypes: { [key: string]: number };
        definitions?: number;
        references?: number;
        exactMatches: number;
        partialMatches: number;
    };
    metadata: {
        strategy: string;
        searchTime: number;
        searchedWord: string;
        directory: string;
        timestamp: string;
        command?: string;
    };
}

async function checkSearchTools(): Promise<{ripgrep: boolean; grep: boolean}> {
    const tools = {
        ripgrep: false,
        grep: false
    };

    // Check ripgrep in multiple locations
    const rgPaths = [
        '/opt/homebrew/bin/rg',    // M1/M2 Mac Homebrew
        '/usr/local/bin/rg',       // Intel Mac Homebrew
        'rg'                       // System PATH
    ];

    for (const rgPath of rgPaths) {
        try {
            await execAsync(`${rgPath} --version`);
            tools.ripgrep = true;
            console.log(`Found ripgrep at: ${rgPath}`);
            break;
        } catch (e) {
            continue;
        }
    }

    // Check grep
    try {
        await execAsync('grep --version');
        tools.grep = true;
        console.log('Found grep');
    } catch (e) {
        console.log('Grep not found');
    }

    console.log('Available search tools:', tools);
    return tools;
}

async function findAvailablePort(startPort: number, endPort: number = startPort + 1000): Promise<number> {
    for (let port = startPort; port < endPort; port++) {
        try {
            await new Promise((resolve, reject) => {
                const server = net.createServer();
                server.on('error', reject);
                server.listen(port, () => {
                    server.once('close', () => resolve(port));
                    server.close();
                });
            });
            return port;
        } catch (err) {
            // Port is in use, try next port
            continue;
        }
    }
    throw new Error(`No available ports found between ${startPort} and ${endPort}`);
}

async function findReferencesWithTypeScript(options: TypeScriptSearchOptions): Promise<TypeScriptReference[]> {
    const references: TypeScriptReference[] = [];
    const processedFiles = new Set<string>();

    const configPath = ts.findConfigFile(
        options.directory,
        ts.sys.fileExists,
        "tsconfig.json"
    );

    if (!configPath) {
        console.log("No tsconfig.json found, using default settings");
        return searchWithoutConfig(options);
    }

    const { config } = ts.readConfigFile(configPath, ts.sys.readFile);
    const { options: compilerOptions } = ts.parseJsonConfigFileContent(
        config,
        ts.sys,
        path.dirname(configPath)
    );

    const program = ts.createProgram({
        rootNames: await findTypeScriptFiles(options.directory),
        options: compilerOptions
    });

    const services = ts.createLanguageService(
        {
            getScriptFileNames: () => [...program.getRootFileNames()],
            getScriptVersion: () => "0",
            getScriptSnapshot: (fileName) => {
                if (!fs.existsSync(fileName)) {
                    return undefined;
                }
                return ts.ScriptSnapshot.fromString(fs.readFileSync(fileName).toString());
            },
            getCurrentDirectory: () => process.cwd(),
            getCompilationSettings: () => compilerOptions,
            getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
            fileExists: ts.sys.fileExists,
            readFile: ts.sys.readFile,
            readDirectory: ts.sys.readDirectory,
        },
        ts.createDocumentRegistry()
    );

    const typeChecker = program.getTypeChecker();

    for (const sourceFile of program.getSourceFiles()) {
        if (sourceFile.fileName.includes('node_modules')) continue;

        processedFiles.add(sourceFile.fileName);

        ts.forEachChild(sourceFile, function visit(node: ts.Node) {
            if (ts.isIdentifier(node) && node.text === options.word) {
                const symbol = typeChecker.getSymbolAtLocation(node);

                if (symbol) {
                    const declaration = symbol.declarations?.[0];
                    const isDefinition = declaration && declaration.pos === node.pos;

                    references.push({
                        file: sourceFile.fileName,
                        line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
                        column: sourceFile.getLineAndCharacterOfPosition(node.getStart()).character + 1,
                        text: node.getFullText(),
                        kind: node.kind,
                        symbolName: symbol.getName(),
                        isDefinition
                    });

                    if (isDefinition && options.isSymbolSearch) {
                        const refs = services.findReferences(
                            sourceFile.fileName,
                            node.getStart()
                        );

                        if (refs) {
                            refs.forEach((referenceEntry: ts.ReferencedSymbol) => {
                                referenceEntry.references.forEach((ref: ts.ReferenceEntry) => {
                                    const refSourceFile = program.getSourceFile(ref.fileName);
                                    if (refSourceFile && !ref.isWriteAccess) {
                                        const pos = refSourceFile.getLineAndCharacterOfPosition(ref.textSpan.start);
                                        references.push({
                                            file: ref.fileName,
                                            line: pos.line + 1,
                                            column: pos.character + 1,
                                            text: refSourceFile.text.slice(ref.textSpan.start, ref.textSpan.start + ref.textSpan.length),
                                            kind: node.kind,
                                            symbolName: symbol.getName(),
                                            isDefinition: false
                                        });
                                    }
                                });
                            });
                        }
                    }
                }
            }
            ts.forEachChild(node, visit);
        });
    }

    return references;
}

async function findTypeScriptFiles(directory: string): Promise<string[]> {
    const files: string[] = [];

    async function walk(dir: string) {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);

            if (entry.isDirectory()) {
                if (entry.name !== 'node_modules' && entry.name !== '.git') {
                    await walk(fullPath);
                }
            } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
                files.push(fullPath);
            }
        }
    }

    await walk(directory);
    return files;
}

async function searchWithoutConfig(options: TypeScriptSearchOptions): Promise<TypeScriptReference[]> {
    const references: TypeScriptReference[] = [];
    const files = await findTypeScriptFiles(options.directory);

    for (const file of files) {
        const content = await fs.promises.readFile(file, 'utf-8');
        const sourceFile = ts.createSourceFile(
            file,
            content,
            ts.ScriptTarget.Latest,
            true
        );

        ts.forEachChild(sourceFile, function visit(node: ts.Node) {
            if (ts.isIdentifier(node) && node.text === options.word) {
                references.push({
                    file,
                    line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
                    column: sourceFile.getLineAndCharacterOfPosition(node.getStart()).character + 1,
                    text: node.getFullText(),
                    kind: node.kind
                });
            }
            ts.forEachChild(node, visit);
        });
    }

    return references;
}

async function findReferencesWithGrep(word: string, directory: string): Promise<Location[]> {
    try {
        const tools = await checkSearchTools();
        console.log('Search tools available:', tools);

        if (tools.ripgrep) {
            console.log('Using ripgrep for search...');

            // Get all matches first (without word boundaries)
            const allMatches = await searchWithRipgrep(word, directory, false);
            console.log(`Found ${allMatches.length} total matches`);

            // Then get exact matches
            const exactMatches = await searchWithRipgrep(word, directory, true);
            console.log(`Found ${exactMatches.length} exact matches`);

            // Create a set of exact match identifiers
            const exactMatchSet = new Set(
                exactMatches.map(match => `${match.file}:${match.line}:${match.text}`)
            );

            // Filter all matches to get partial matches only
            const partialMatches = allMatches.filter(match => {
                const matchKey = `${match.file}:${match.line}:${match.text}`;
                // Check if this is not an exact match and contains our search term
                const isPartial = !exactMatchSet.has(matchKey) &&
                    match.text.toLowerCase().includes(word.toLowerCase());
                return isPartial;
            }).map(match => ({ ...match, isExactMatch: false }));

            console.log(`After filtering, found ${partialMatches.length} partial matches`);

            // Return exact matches first, then partial matches
            return [...exactMatches, ...partialMatches];
        } else {
            return fallbackToGrep(word, directory);
        }
    } catch (error) {
        console.error('Search failed:', error);
        console.log('Falling back to Node.js search...');
        return findReferencesWithNode(word, directory);
    }
}

async function searchWithRipgrep(word: string, directory: string, exactMatch: boolean): Promise<Location[]> {
    return new Promise((resolve, reject) => {
        const rgPath = '/opt/homebrew/bin/rg';
        const rgArgs = [
            '-n',                // line numbers
            '--no-heading',      // don't group by file
            '--with-filename',   // show file names
            '-i',               // case insensitive
            '--hidden',         // search hidden files
            '--no-ignore',      // don't respect ignore files
            '--type-add', 'custom:*.{ts,js,tsx,jsx,json,html,css,md,yaml,yml}',  // define custom type
            '--type', 'custom',  // use our custom type
        ];

        // Add ignore patterns
        const ignorePatterns = [
            '**/node_modules/**',
            '**/.git/**',
            '**/dist/**',
            '**/build/**',
            '**/out/**',
            '**/.next/**',
            '**/coverage/**',
            '**/.cache/**'
        ];

        // Add each ignore pattern separately
        ignorePatterns.forEach(pattern => {
            rgArgs.push('--glob', `!${pattern}`);
        });

        if (exactMatch) {
            rgArgs.push('-w');
        }

        rgArgs.push(word);
        rgArgs.push(directory);

        console.log('Executing ripgrep command:', rgArgs.join(' ')); // Debug log

        const rgProcess = spawn(rgPath, rgArgs);

        let output = '';
        let errorOutput = '';

        rgProcess.stdout.on('data', (data) => {
            output += data.toString();
        });

        rgProcess.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });

        rgProcess.on('close', (code) => {
            if (code !== 0 && code !== 1) {
                if (errorOutput) {
                    console.error('ripgrep stderr:', errorOutput);
                }
                resolve([]);
                return;
            }
            const results = parseGrepOutput(output, exactMatch)
                .filter(result => !result.file.includes('node_modules')); // Additional safety check
            console.log(`Found ${results.length} ${exactMatch ? 'exact' : 'all'} matches`);
            resolve(results);
        });

        rgProcess.on('error', (error) => {
            console.error('ripgrep spawn error:', error);
            resolve([]);
        });

        const timeout = setTimeout(() => {
            rgProcess.kill();
            resolve([]);
        }, 30000);

        rgProcess.on('close', () => clearTimeout(timeout));
    });
}

// Helper function for grep fallback
async function fallbackToGrep(word: string, directory: string): Promise<Location[]> {
    try {
        console.log('Attempting grep search...');
        const excludeDirs = [
            '--exclude-dir=node_modules',
            '--exclude-dir=.git',
            '--exclude-dir=dist',
            '--exclude-dir=build',
            '--exclude-dir=out',
            '--exclude-dir=.next',
            '--exclude-dir=coverage',
            '--exclude-dir=.cache'
        ].join(' ');

        const includeFiles = [
            '--include=*.ts',
            '--include=*.js',
            '--include=*.tsx',
            '--include=*.jsx',
            '--include=*.json',
            '--include=*.html',
            '--include=*.css',
            '--include=*.md',
            '--include=*.yaml',
            '--include=*.yml'
        ].join(' ');

        // First search for exact matches
        const exactCommand = `grep -r -n -w -i ${excludeDirs} ${includeFiles} "${word}" "${directory}"`;

        // Then search for partial matches
        const partialCommand = `grep -r -n -i ${excludeDirs} ${includeFiles} "${word}" "${directory}"`;

        const [exactOutput, partialOutput] = await Promise.all([
            execAsync(exactCommand, { timeout: 30000 }).catch(() => ({ stdout: '' })),
            execAsync(partialCommand, { timeout: 30000 }).catch(() => ({ stdout: '' }))
        ]);

        const exactMatches = parseGrepOutput(exactOutput.stdout, true);
        let partialMatches = parseGrepOutput(partialOutput.stdout, false);

        // Filter out exact matches from partial matches
        const exactMatchSet = new Set(
            exactMatches.map(match => `${match.file}:${match.line}:${match.text}`)
        );

        partialMatches = partialMatches.filter(
            match => !exactMatchSet.has(`${match.file}:${match.line}:${match.text}`)
        );

        return [...exactMatches, ...partialMatches];
    } catch (error) {
        console.error('Grep search failed:', error);
        console.log('Falling back to Node.js search...');
        return findReferencesWithNode(word, directory);
    }
}

function parseGrepOutput(output: string, isExactMatch: boolean): Location[] {
    const locations: Location[] = [];
    const lines = output.split('\n').filter(line => line.trim());

    for (const line of lines) {
        const match = line.match(/^(.+):(\d+):(.*)$/);
        if (match) {
            const [, file, lineNum, text] = match;
            // Skip if the file is in node_modules
            if (file.includes('node_modules')) {
                continue;
            }
            locations.push({
                file,
                line: parseInt(lineNum, 10),
                column: text.indexOf(text.trim()) + 1,
                text: text.trim(),
                isExactMatch
            });
        }
    }

    return locations;
}

function combineSearchResults(exactMatches: Location[], partialMatches: Location[]): Location[] {
    // Create a Set of unique identifiers for exact matches
    const exactMatchSet = new Set(
        exactMatches.map(match => `${match.file}:${match.line}:${match.column}`)
    );

    // Filter out partial matches that are already in exact matches
    const uniquePartialMatches = partialMatches.filter(
        match => !exactMatchSet.has(`${match.file}:${match.line}:${match.column}`)
    );

    // Combine exact matches first, then partial matches
    return [...exactMatches, ...uniquePartialMatches];
}

async function findReferencesWithNode(word: string, baseDir: string): Promise<Location[]> {
    const locations: Location[] = [];
    const processedFiles = new Set<string>();
    const exactMatches = new Set<string>();

    // Define directories to ignore
    const ignoreDirs = new Set([
        'node_modules',
        '.git',
        'dist',
        'build',
        'out',
        '.next',
        'coverage',
        '.cache'
    ]);

    const supportedExtensions = new Set([
        '.ts', '.js', '.tsx', '.jsx',
        '.json', '.html', '.css',
        '.md', '.yaml', '.yml'
    ]);

    async function searchInDirectory(dir: string) {
        const files = await fs.promises.readdir(dir);

        for (const file of files) {
            const filePath = path.join(dir, file);

            if (processedFiles.has(filePath)) continue;
            processedFiles.add(filePath);

            const stat = await fs.promises.stat(filePath);

            if (stat.isDirectory()) {
                if (ignoreDirs.has(file)) {
                    continue;
                }
                await searchInDirectory(filePath);
            } else if (supportedExtensions.has(path.extname(file))) {
                try {
                    const content = await fs.promises.readFile(filePath, 'utf-8');
                    const lines = content.split('\n');

                    for (let i = 0; i < lines.length; i++) {
                        const line = lines[i];

                        // Search for exact matches first
                        const exactRegex = new RegExp(`\\b${word}\\b`, 'gi');
                        let match;

                        while ((match = exactRegex.exec(line)) !== null) {
                            const key = `${filePath}:${i + 1}:${match.index + 1}:${line.trim()}`;
                            exactMatches.add(key);
                            locations.push({
                                file: filePath,
                                line: i + 1,
                                column: match.index + 1,
                                text: line.trim(),
                                isExactMatch: true
                            });
                        }

                        // Then search for partial matches
                        const partialRegex = new RegExp(word, 'gi');
                        while ((match = partialRegex.exec(line)) !== null) {
                            const key = `${filePath}:${i + 1}:${match.index + 1}:${line.trim()}`;
                            // Only add if it's not an exact match
                            if (!exactMatches.has(key)) {
                                locations.push({
                                    file: filePath,
                                    line: i + 1,
                                    column: match.index + 1,
                                    text: line.trim(),
                                    isExactMatch: false
                                });
                            }
                        }
                    }
                } catch (error) {
                    console.error(`Error reading file ${filePath}:`, error);
                }
            }
        }
    }

    await searchInDirectory(baseDir);
    return locations;
}

function enhanceLocation(location: Location | TypeScriptReference, baseDir: string): EnhancedLocation {
    const relativePath = path.relative(baseDir, location.file);
    const fileType = path.extname(location.file).slice(1);

    const enhanced: EnhancedLocation = {
        ...location,
        relativePath,
        fileType,
        context: location.text
    };

    if ('kind' in location) {
        enhanced.kind = location.kind;
        enhanced.symbolName = location.symbolName;
        enhanced.isDefinition = location.isDefinition;
    }

    return enhanced;
}

function groupReferencesByFileType(references: EnhancedLocation[]): GroupedReferences {
    return references.reduce((acc, ref) => {
        const fileType = ref.fileType;
        if (!acc[fileType]) {
            acc[fileType] = [];
        }
        acc[fileType].push(ref);
        return acc;
    }, {} as GroupedReferences);
}

function startTerminalInterface() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    async function promptSearch() {
        try {
            const tools = await checkSearchTools();
            const word = await new Promise<string>((resolve) => {
                rl.question('Enter search term (or "exit" to quit): ', resolve);
            });

            if (word.toLowerCase() === 'exit') {
                rl.close();
                process.exit(0);
                return;
            }

            console.log(`Searching for "${word}"...`);
            if (!tools.ripgrep && !tools.grep) {
                console.log('Note: Using slower Node.js search (install ripgrep for faster searches)');
            }

            const startTime = Date.now();
            const references = await findReferencesWithGrep(word, '/Users/MacBook/IdeaProjects/Sourcegraph');
            const duration = Date.now() - startTime;

            const fileTypes: FileTypes = {};
            references.forEach(ref => {
                const ext = path.extname(ref.file).slice(1);
                fileTypes[ext] = (fileTypes[ext] || 0) + 1;
            });

            console.log('\nSearch Results:');
            console.log('==============');
            console.log(`Found ${references.length} matches in ${new Set(references.map(r => r.file)).size} files`);
            console.log(`Search time: ${duration}ms`);
            console.log('\nMatches by file type:', fileTypes);
            console.log('\nMatches:');

            const fileGroups: FileGroups = {};
            references.forEach(ref => {
                if (!fileGroups[ref.file]) {
                    fileGroups[ref.file] = [];
                }
                fileGroups[ref.file].push(ref);
            });

            Object.entries(fileGroups).forEach(([file, refs]) => {
                console.log(`\n${file}:`);
                refs.forEach(ref => {
                    console.log(`  Line ${ref.line}: ${ref.text}`);
                });
            });

        } catch (error) {
            console.error('Search error:', error);
        }

        console.log('\n');
        promptSearch();
    }

    console.log('Code Reference Search Terminal Interface');
    console.log('======================================');
    promptSearch();
}

const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Add OPTIONS handler
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    // Add handler for serving the HTML page
    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
        try {
            const htmlPath = path.join(__dirname, '..', 'public', 'index.html');
            const content = await fs.promises.readFile(htmlPath, 'utf-8');
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(content);
            return;
        } catch (error) {
            console.error('Error serving index.html:', error);
            res.writeHead(500);
            res.end('Error loading web interface');
            return;
        }
    }

    if (req.method === 'POST' && req.url === '/find-references') {
        let body = '';

        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', async () => {
            try {
                const request: SearchRequest = JSON.parse(body);
                console.log('Received search request:', request);

                if (!request.word || !request.directory) {
                    res.writeHead(400);
                    res.end(JSON.stringify({
                        error: 'Missing required fields',
                        details: {
                            word: !request.word ? 'Missing search term' : undefined,
                            directory: !request.directory ? 'Missing directory' : undefined
                        }
                    }));
                    return;
                }

                if (!fs.existsSync(request.directory)) {
                    res.writeHead(400);
                    res.end(JSON.stringify({
                        error: 'Invalid directory',
                        details: `Directory does not exist: ${request.directory}`
                    }));
                    return;
                }

                const startTime = Date.now();
                let references: (Location | TypeScriptReference)[] = [];
                let strategy = request.searchStrategy || 'all';

                if (strategy === 'all' || strategy === 'typescript') {
                    console.log('Starting TypeScript-aware search...');
                    try {
                        const tsResults = await findReferencesWithTypeScript({
                            word: request.word,
                            directory: request.directory,
                            isSymbolSearch: true
                        });
                        console.log(`TypeScript search found ${tsResults.length} results`);
                        references = [...references, ...tsResults];
                    } catch (error) {
                        console.error('TypeScript search failed:', error);
                    }
                }

                if (strategy === 'all' || strategy === 'grep') {
                    console.log('Starting grep search...');
                    try {
                        const grepResults = await findReferencesWithGrep(request.word, request.directory);
                        console.log(`Grep search found ${grepResults.length} results`);
                        references = [...references, ...grepResults];
                    } catch (error) {
                        console.error('Grep search failed:', error);
                    }
                }

                if ((strategy === 'all' && references.length === 0) || strategy === 'node') {
                    console.log('Starting Node.js search...');
                    try {
                        const nodeResults = await findReferencesWithNode(request.word, request.directory);
                        console.log(`Node.js search found ${nodeResults.length} results`);
                        references = [...references, ...nodeResults];
                    } catch (error) {
                        console.error('Node.js search failed:', error);
                    }
                }

                const enhancedReferences = references.map(ref =>
                    enhanceLocation(ref, request.directory)
                );

                const uniqueRefs = Array.from(new Map(
                    enhancedReferences.map(ref => [`${ref.relativePath}:${ref.line}:${ref.column}`, ref])
                ).values());

                const groupedRefs = groupReferencesByFileType(uniqueRefs);

                const uniqueFiles = new Set(uniqueRefs.map(ref => ref.file)).size;
                const fileTypeCounts = Object.entries(groupedRefs).reduce((acc, [type, refs]) => {
                    acc[type] = refs.length;
                    return acc;
                }, {} as { [key: string]: number });

                const definitions = uniqueRefs.filter(ref => ref.isDefinition).length;
                const referenceCount = uniqueRefs.filter(ref => !ref.isDefinition).length;

                const result: EnhancedSearchResult = {
                    references: uniqueRefs,
                    groupedByFileType: groupReferencesByFileType(uniqueRefs),
                    summary: {
                        totalFiles: uniqueFiles,
                        totalMatches: uniqueRefs.length,
                        exactMatches: uniqueRefs.filter(ref => ref.isExactMatch).length,
                        partialMatches: uniqueRefs.filter(ref => !ref.isExactMatch).length,
                        fileTypes: fileTypeCounts,
                        definitions,
                        references: referenceCount
                    },
                    metadata: {
                        strategy,
                        searchTime: Date.now() - startTime,
                        searchedWord: request.word,
                        directory: request.directory,
                        timestamp: new Date().toISOString()
                    }
                };

                res.writeHead(200);
                res.end(JSON.stringify(result, null, 2));
            } catch (error) {
                console.error('Error processing request:', error);
                res.writeHead(500);
                res.end(JSON.stringify({
                    error: 'Internal server error',
                    details: error instanceof Error ? error.message : 'Unknown error occurred'
                }));
            }
        });
    } else {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not found' }));
    }
});

const DEFAULT_PORT = 3000;

async function startServer() {
    try {
        const port = await findAvailablePort(DEFAULT_PORT);
        const tools = await checkSearchTools();

        server.listen(port, () => {
            console.log('\n=== MCP Reference Search Server ===');
            console.log(`Web interface running at http://localhost:${port}`);
            console.log('Open in your browser to use the web interface');

            // Add search tool status
            console.log('\nSearch Tools Status:');
            console.log('-------------------');
            console.log(`ripgrep (fastest): ${tools.ripgrep ? '✅ Available' : '❌ Not found'}`);
            console.log(`grep (fallback): ${tools.grep ? '✅ Available' : '❌ Not found'}`);
            if (!tools.ripgrep) {
                console.log('\nTip: Install ripgrep for faster searches:');
                console.log('- macOS: brew install ripgrep');
                console.log('- Ubuntu/Debian: sudo apt-get install ripgrep');
                console.log('- Windows: choco install ripgrep');
            }

            console.log('\nTerminal interface is also available below:');
            console.log('=======================================\n');
            startTerminalInterface();
        });

        server.on('error', (error: NodeJS.ErrnoException) => {
            if (error.code === 'EADDRINUSE') {
                console.error(`Port ${port} is already in use. Trying another port...`);
                server.close();
                startServer(); // Recursively try again
            } else {
                console.error('Server error:', error);
            }
        });

    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

process.on('SIGINT', () => {
    console.log('\nReceived SIGINT. Shutting down gracefully...');
    server.close(() => {
        console.log('Server shutdown complete');
        process.exit(0);
    });
});

process.on('SIGTERM', () => {
    console.log('\nReceived SIGTERM. Shutting down gracefully...');
    server.close(() => {
        console.log('Server shutdown complete');
        process.exit(0);
    });
});

startServer().catch(error => {
    console.error('Failed to start server:', error);
    process.exit(1);
});