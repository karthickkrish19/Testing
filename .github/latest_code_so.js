#!/usr/bin/env node

const fs = require('fs').promises;
const fsSync = require('fs');
const { exec: execCallback } = require('child_process');
const { promisify } = require('util');
const os = require('os');
const path = require('path');

const execPromise = promisify(execCallback);

// Enhanced package dependency sequencing with more ecosystems
const DEPENDENCY_SEQUENCE = {
    'react': { order: 1, peers: ['react-dom'], ecosystem: 'react' },
    'react-dom': { order: 2, peers: ['react'], ecosystem: 'react' },
    'react-router-dom': { order: 3, peers: ['react'], ecosystem: 'routing' }, // Move routing earlier
    '@types/react-router-dom': { order: 4, peers: ['react-router-dom'], ecosystem: 'types' },
    'typescript': { order: 5, peers: [], ecosystem: 'build' },
    '@mui/material': { order: 6, peers: ['@emotion/react', '@emotion/styled'], ecosystem: 'mui' },
    '@emotion/react': { order: 7, peers: [], ecosystem: 'mui' },
    '@emotion/styled': { order: 8, peers: ['@emotion/react'], ecosystem: 'mui' },
    '@azure/msal-browser': { order: 9, peers: [], ecosystem: 'azure' },
    '@azure/msal-react': { order: 10, peers: ['@azure/msal-browser', 'react'], ecosystem: 'azure' },
    'eslint': { order: 11, peers: [], ecosystem: 'lint' },
    '@typescript-eslint/eslint-plugin': { order: 12, peers: ['typescript', 'eslint'], ecosystem: 'lint' },
    '@typescript-eslint/parser': { order: 13, peers: ['typescript', 'eslint'], ecosystem: 'lint' },
    '@types/react': { order: 14, peers: ['react'], ecosystem: 'types' },
    '@types/react-dom': { order: 15, peers: ['react-dom', '@types/react'], ecosystem: 'types' },
    '@types/jest': { order: 16, peers: [], ecosystem: 'types' },
    '@mui/icons-material': { order: 17, peers: ['@mui/material'], ecosystem: 'mui' },
    '@mui/lab': { order: 18, peers: ['@mui/material'], ecosystem: 'mui' },
    '@testing-library/react': { order: 19, peers: ['react'], ecosystem: 'test' },
    '@testing-library/jest-dom': { order: 20, peers: [], ecosystem: 'test' },
    '@fontsource/roboto': { order: 21, peers: [], ecosystem: 'fonts' },
    '@microsoft/applicationinsights-react-js': { order: 22, peers: [], ecosystem: 'monitoring' },
    '@mui/x-data-grid': { order: 23, peers: [], ecosystem: 'mui' },
    'axios': { order: 24, peers: [], ecosystem: 'utilities' },
    'cronstrue': { order: 25, peers: [], ecosystem: 'utilities' },
    'react-h5-audio-player': { order: 26, peers: [], ecosystem: 'react-components' },
    'react-js-cron': { order: 27, peers: [], ecosystem: 'react-components' },
    'web-vitals': { order: 28, peers: [], ecosystem: 'performance' },
    'cross-env': { order: 29, peers: [], ecosystem: 'build' },
    'eslint-plugin-unused-imports': { order: 30, peers: [], ecosystem: 'lint' },
    'husky': { order: 31, peers: [], ecosystem: 'git' },
    'postcss-preset-env': { order: 32, peers: [], ecosystem: 'build' },
    'prettier': { order: 33, peers: [], ecosystem: 'formatting' }
};

// Package type classifications for risk assessment
const PACKAGE_TYPES = {
    core_frameworks: ['react', 'vue', 'angular', '@angular/core', 'react-router-dom'],
    build_tools: ['webpack', 'vite', 'rollup', 'parcel', 'typescript'],
    ui_frameworks: ['@mui/material', '@ant-design/core', 'bootstrap'],
    dev_tools: ['eslint', 'prettier', 'jest', '@testing-library/*'],
    utilities: ['axios', 'lodash', 'moment', 'classnames', 'nth-check'],
    routing: ['react-router-dom', '@reach/router', 'next/router']
};

class PackageUpgrader {
    constructor() {
        this.results = { successful: [], failed: [], skipped: [], newPackages: [] };
        this.packageJsonBackup = '';
        this.packageLockBackup = '';
        this.discoveredPackages = new Map();
        this.upgradeSequence = [];
        this.versionCache = new Map();
        this.concurrency = Math.max(1, os.cpus().length - 1);
        this.ecosystemMap = new Map();
        this.startTime = Date.now();
        this.upgradedEcosystems = new Set();
        this.retryCount = 3;
        this.maxTimeout = 600000; // 10 minutes
        this.backupDir = path.join(process.cwd(), '.upgrade-backups');
        this.criticalPackages = ['react', 'react-dom', 'react-router-dom', '@types/react', '@types/react-dom', '@types/react-router-dom'];
    }

    log(message) {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] ${message}`;
        console.log(logMessage);
        this.writeToLogFile(logMessage);
    }

    error(message, error = null) {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] ERROR: ${message}`;
        console.error(logMessage);
        if (error && error.stack) {
            console.error(error.stack);
            this.writeToLogFile(`${logMessage}\n${error.stack}`);
        } else {
            this.writeToLogFile(logMessage);
        }
    }

    writeToLogFile(message) {
        try {
            const logFile = path.join(process.cwd(), 'upgrade.log');
            fsSync.appendFileSync(logFile, `${message}\n`, 'utf8');
        } catch (err) {
            // Silently fail if we can't write to log file
        }
    }

    async exec(command, options = {}) {
        const maxRetries = options.retries || this.retryCount;
        let lastError;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                this.log(`Executing: ${command} (attempt ${attempt}/${maxRetries})`);
                
                const { stdout, stderr } = await execPromise(command, {
                    encoding: 'utf8',
                    cwd: process.cwd(),
                    timeout: options.timeout || this.maxTimeout,
                    maxBuffer: 1024 * 1024 * 10 // 10MB buffer
                });

                if (stderr && !options.silent) {
                    this.log(`STDERR: ${stderr}`);
                }

                return stdout;
            } catch (error) {
                lastError = error;
                this.error(`Command failed (attempt ${attempt}/${maxRetries}): ${command}`, error);
                
                // Don't retry for certain types of errors
                if (this.isNonRetryableError(error)) {
                    break;
                }

                // Wait before retrying (exponential backoff)
                if (attempt < maxRetries) {
                    const delay = Math.min(1000 * Math.pow(2, attempt - 1), 30000);
                    this.log(`Waiting ${delay}ms before retry...`);
                    await this.sleep(delay);
                }
            }
        }

        if (!options.silent) {
            this.error(`Command failed after ${maxRetries} attempts: ${command}`);
        }
        throw lastError;
    }

    isNonRetryableError(error) {
        const message = error.message.toLowerCase();
        return message.includes('permission denied') ||
               message.includes('eacces') ||
               message.includes('not found') ||
               message.includes('invalid package name');
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async checkCriticalPackages() {
        this.log('🔍 Checking critical packages...');
        const packageJson = JSON.parse(await fs.readFile('package.json', 'utf8'));
        const allDeps = { ...packageJson.dependencies, ...packageJson.devDependencies };
        
        const missingCritical = [];
        
        for (const pkg of this.criticalPackages) {
            if (!allDeps[pkg]) {
                missingCritical.push(pkg);
            }
        }
        
        if (missingCritical.length > 0) {
            this.log(`⚠️  Missing critical packages: ${missingCritical.join(', ')}`);
            
            // Automatically install missing critical packages
            for (const pkg of missingCritical) {
                try {
                    if (pkg.startsWith('@types/')) {
                        this.log(`📦 Installing missing dev dependency: ${pkg}`);
                        await this.exec(`npm install --save-dev ${pkg}`, { timeout: 120000 });
                    } else {
                        this.log(`📦 Installing missing dependency: ${pkg}`);
                        await this.exec(`npm install ${pkg}`, { timeout: 120000 });
                    }
                    this.log(`✅ Successfully installed ${pkg}`);
                } catch (error) {
                    this.error(`Failed to install critical package ${pkg}: ${error.message}`);
                }
            }
        } else {
            this.log('✅ All critical packages are present');
        }
    }

    async createBackup() {
        this.log('Creating comprehensive backup of package files...');
        try {
            // Create backup directory
            await fs.mkdir(this.backupDir, { recursive: true });
            
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupSubDir = path.join(this.backupDir, `backup-${timestamp}`);
            await fs.mkdir(backupSubDir, { recursive: true });

            // Backup package.json
            this.packageJsonBackup = await fs.readFile('package.json', 'utf8');
            await fs.writeFile(path.join(backupSubDir, 'package.json'), this.packageJsonBackup);

            // Backup package-lock.json if it exists
            if (fsSync.existsSync('package-lock.json')) {
                this.packageLockBackup = await fs.readFile('package-lock.json', 'utf8');
                await fs.writeFile(path.join(backupSubDir, 'package-lock.json'), this.packageLockBackup);
            }

            // Backup node_modules package.json files for critical packages
            const criticalPackages = ['react', 'react-dom', 'react-router-dom', '@mui/material', 'typescript'];
            for (const pkg of criticalPackages) {
                try {
                    const pkgPath = path.join('node_modules', pkg, 'package.json');
                    if (fsSync.existsSync(pkgPath)) {
                        const pkgJson = await fs.readFile(pkgPath, 'utf8');
                        await fs.writeFile(path.join(backupSubDir, `${pkg.replace('/', '-')}-package.json`), pkgJson);
                    }
                } catch (err) {
                    this.log(`Warning: Could not backup ${pkg} package.json: ${err.message}`);
                }
            }

            this.currentBackupDir = backupSubDir;
            this.log(`Backup created successfully at: ${backupSubDir}`);
        } catch (error) {
            this.error(`Backup failed: ${error.message}`, error);
            throw error;
        }
    }

    async restoreBackup() {
        this.log('Restoring original package files...');
        try {
            if (this.packageJsonBackup) {
                await fs.writeFile('package.json', this.packageJsonBackup);
                this.log('Restored package.json');
            }
            if (this.packageLockBackup) {
                await fs.writeFile('package-lock.json', this.packageLockBackup);
                this.log('Restored package-lock.json');
            }

            // Clear npm cache to ensure clean state
            try {
                await this.exec('npm cache clean --force', { silent: true, timeout: 60000 });
            } catch (err) {
                this.log('Warning: Could not clear npm cache');
            }

            // Reinstall packages
            try {
                this.log('Reinstalling packages after restore...');
                await this.exec('npm install', { timeout: 300000 });
                this.log('Packages reinstalled successfully');
            } catch (err) {
                this.error('Failed to reinstall packages after restore', err);
            }

        } catch (error) {
            this.error(`Restore failed: ${error.message}`, error);
            throw error;
        }
    }

    async detectNewPackages() {
        try {
            this.log('🔍 Detecting packages that need upgrades...');
            
            // First check and install critical packages if missing
            await this.checkCriticalPackages();
            
            const packageJson = JSON.parse(await fs.readFile('package.json', 'utf8'));
            const currentPackages = { 
                ...packageJson.dependencies || {}, 
                ...packageJson.devDependencies || {} 
            };
            
            await this.discoverPackages(currentPackages);
            this.buildUpgradeSequence();
        } catch (error) {
            this.error(`Failed to detect packages: ${error.message}`, error);
            throw error;
        }
    }

    async discoverPackages(currentPackages) {
        this.log('🔍 Step 1: Discovering packages needing upgrades...');

        const packageNames = Object.keys(currentPackages);
        const batchSize = 10; // Process in batches to avoid overwhelming npm registry
        
        for (let i = 0; i < packageNames.length; i += batchSize) {
            const batch = packageNames.slice(i, i + batchSize);
            this.log(`Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(packageNames.length/batchSize)}: ${batch.join(', ')}`);
            
            const results = await Promise.allSettled(
                batch.map(async (packageName) => {
                    try {
                        const currentVersion = currentPackages[packageName].replace(/[\^~]/, '');
                        const latestVersion = await this.getLatestVersion(packageName);

                        if (!latestVersion || !this.compareVersions(currentVersion, latestVersion)) {
                            return null;
                        }

                        const riskLevel = this.assessPackageRisk(packageName, currentVersion, latestVersion);
                        const peers = this.getPeerDependencies(packageName);
                        const ecosystem = this.getEcosystem(packageName);

                        return {
                            packageName,
                            currentVersion,
                            latestVersion,
                            riskLevel,
                            peers,
                            ecosystem,
                            needsUpgrade: true
                        };
                    } catch (error) {
                        this.error(`Error discovering package ${packageName}: ${error.message}`);
                        return null;
                    }
                })
            );

            for (const result of results) {
                if (result.status === 'fulfilled' && result.value) {
                    const { packageName, ...packageInfo } = result.value;
                    this.discoveredPackages.set(packageName, packageInfo);
                    
                    // Map packages to ecosystems
                    if (packageInfo.ecosystem) {
                        if (!this.ecosystemMap.has(packageInfo.ecosystem)) {
                            this.ecosystemMap.set(packageInfo.ecosystem, []);
                        }
                        this.ecosystemMap.get(packageInfo.ecosystem).push(packageName);
                    }
                }
            }

            // Small delay between batches to be gentle on npm registry
            if (i + batchSize < packageNames.length) {
                await this.sleep(1000);
            }
        }

        this.log(`📦 Found ${this.discoveredPackages.size} packages needing upgrades`);
    }

    getPeerDependencies(packageName) {
        const sequenceInfo = DEPENDENCY_SEQUENCE[packageName];
        return sequenceInfo ? sequenceInfo.peers : [];
    }

    getEcosystem(packageName) {
        const sequenceInfo = DEPENDENCY_SEQUENCE[packageName];
        return sequenceInfo ? sequenceInfo.ecosystem : null;
    }

    buildUpgradeSequence() {
        this.log('🔄 Step 2: Building smart upgrade sequence...');

        // Group packages by ecosystem first
        const ecosystemGroups = {};
        
        Array.from(this.discoveredPackages.entries()).forEach(([name, info]) => {
            const ecosystem = info.ecosystem || 'other';
            if (!ecosystemGroups[ecosystem]) {
                ecosystemGroups[ecosystem] = [];
            }
            
            const sequenceInfo = DEPENDENCY_SEQUENCE[name];
            ecosystemGroups[ecosystem].push({
                name,
                order: sequenceInfo ? sequenceInfo.order : 999,
                peers: sequenceInfo ? sequenceInfo.peers : [],
                riskLevel: info.riskLevel,
                ecosystem
            });
        });

        // Sort each ecosystem group
        Object.keys(ecosystemGroups).forEach(ecosystem => {
            ecosystemGroups[ecosystem].sort((a, b) => a.order - b.order);
        });

        // Build final sequence: ecosystems in logical order
        this.upgradeSequence = [];
        
        const ecosystemOrder = ['react', 'routing', 'types', 'mui', 'azure', 'lint', 'test', 'build', 'utilities', 
                               'fonts', 'monitoring', 'formatting', 'git', 'react-components', 'performance', 'other'];
        
        ecosystemOrder.forEach(ecosystem => {
            if (ecosystemGroups[ecosystem]) {
                this.upgradeSequence.push(...ecosystemGroups[ecosystem]);
            }
        });

        this.log(`📋 Upgrade sequence determined (${this.upgradeSequence.length} packages):`);
        this.upgradeSequence.forEach((pkg, index) => {
            const packageInfo = this.discoveredPackages.get(pkg.name);
            this.log(`  ${index + 1}. ${pkg.name}: ${packageInfo.currentVersion} → ${packageInfo.latestVersion} (${pkg.riskLevel})`);
        });
    }

    compareVersions(current, latest) {
        if (current === latest) return false;
        
        const currentParts = current.split('-');
        const latestParts = latest.split('-');
        
        return currentParts[0] !== latestParts[0];
    }

    assessPackageRisk(packageName, currentVersion, latestVersion) {
        try {
            const versionDiff = this.calculateVersionDiff(currentVersion, latestVersion);

            if (versionDiff.major > 0) return 'high-risk';
            if (this.isCoreFramework(packageName)) return 'high-risk';
            if (this.isRoutingPackage(packageName)) return 'high-risk';
            if (this.isBuildTool(packageName) && versionDiff.minor > 0) return 'medium-risk';
            if (this.isDevTool(packageName)) return 'low-risk';
            if (versionDiff.major === 0 && versionDiff.minor === 0) return 'safe';

            return 'low-risk';
        } catch (error) {
            this.error(`Error assessing risk for ${packageName}: ${error.message}`);
            return 'medium-risk'; // Default to medium risk on error
        }
    }

    calculateVersionDiff(current, latest) {
        const parseVersion = (version) => {
            const cleanVersion = version.split('-')[0]; // Remove pre-release identifiers
            return cleanVersion.split('.').map(n => parseInt(n) || 0);
        };

        const currentParts = parseVersion(current);
        const latestParts = parseVersion(latest);

        return {
            major: (latestParts[0] || 0) - (currentParts[0] || 0),
            minor: (latestParts[1] || 0) - (currentParts[1] || 0),
            patch: (latestParts[2] || 0) - (currentParts[2] || 0)
        };
    }

    isCoreFramework(packageName) {
        return PACKAGE_TYPES.core_frameworks.some(pattern =>
            pattern.includes('*') ? packageName.startsWith(pattern.replace('*', '')) : packageName === pattern
        );
    }

    isRoutingPackage(packageName) {
        return PACKAGE_TYPES.routing.includes(packageName);
    }

    isBuildTool(packageName) {
        return PACKAGE_TYPES.build_tools.includes(packageName);
    }

    isDevTool(packageName) {
        return PACKAGE_TYPES.dev_tools.some(pattern =>
            pattern.includes('*') ? packageName.startsWith(pattern.replace('*', '')) : packageName === pattern
        );
    }

    async getLatestVersion(packageName) {
        if (this.versionCache.has(packageName)) {
            return this.versionCache.get(packageName);
        }

        try {
            const result = await this.exec(`npm view ${packageName} version`, { 
                silent: true, 
                timeout: 30000,
                retries: 2 
            });
            const version = result.trim();
            this.versionCache.set(packageName, version);
            return version;
        } catch (error) {
            this.error(`Failed to get latest version for ${packageName}: ${error.message}`);
            return null;
        }
    }

    async getCurrentVersion(packageName) {
        try {
            const packageJson = JSON.parse(await fs.readFile('package.json', 'utf8'));
            const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
            const version = deps[packageName];
            return version ? version.replace(/[\^~]/, '') : null;
        } catch (error) {
            this.error(`Error getting current version for ${packageName}: ${error.message}`);
            return null;
        }
    }

    async validateUpgrade(ecosystem = null) {
        this.log(`🔍 Validating upgrade${ecosystem ? ` for ${ecosystem} ecosystem` : ''}...`);
        
        const validationSteps = [
            { 
                name: 'Installing dependencies', 
                command: 'npm install', 
                timeout: 300000,
                critical: true 
            },
            { 
                name: 'Type checking', 
                command: 'npx tsc --noEmit', 
                timeout: 120000,
                critical: false 
            }
        ];

        // For full validation after all upgrades
        if (ecosystem === 'final') {
            validationSteps.push({
                name: 'Running tests', 
                command: 'npm test -- --bail --detectOpenHandles --runInBand --passWithNoTests', 
                timeout: 600000,
                critical: false
            });
        }

        const results = {};

        for (const step of validationSteps) {
            try {
                this.log(`  ${step.name}...`);
                await this.exec(step.command, { 
                    silent: true, 
                    timeout: step.timeout,
                    retries: step.critical ? 2 : 1
                });
                this.log(`  ✅ ${step.name} passed`);
                results[step.name] = { success: true };
            } catch (error) {
                this.error(`  ❌ ${step.name} failed: ${error.message}`);
                results[step.name] = { success: false, error: error.message };
                
                if (step.critical) {
                    return { 
                        success: false, 
                        failedStep: step.name, 
                        error: error.message,
                        results 
                    };
                }
            }
        }

        return { success: true, results };
    }

    isPeerDependencyConflict(errorMessage) {
        const peerDependencyPatterns = [
            /ERESOLVE unable to resolve dependency tree/,
            /Could not resolve dependency:/,
            /peer dependency/i,
            /peer .* from .* requires/i,
            /Fix the upstream dependency conflict/,
            /conflicting peer dependency/i,
            /npm ERR! peer dep missing/i
        ];

        return peerDependencyPatterns.some(pattern => pattern.test(errorMessage));
    }

    extractPeerDependencyInfo(errorMessage) {
        const peerMatches = errorMessage.match(/peer ([^@]+)@"([^"]+)" from ([^@]+)@([^\s]+)/);
        if (peerMatches) {
            return `Peer dependency conflict: ${peerMatches[3]} requires ${peerMatches[1]}@${peerMatches[2]}`;
        }

        const reactMatch = errorMessage.match(/Found: react@([^\s]+).*peer react@"([^"]+)"/);
        if (reactMatch) {
            return `React version conflict: current React ${reactMatch[1]}, requires React ${reactMatch[2]}`;
        }

        if (errorMessage.includes('react-router-dom')) {
            return 'React Router ecosystem upgrade required - coordinated upgrade needed';
        }

        if (errorMessage.includes('@mui/') || errorMessage.includes('material')) {
            return 'Material UI ecosystem upgrade required - coordinated upgrade needed';
        }

        if (errorMessage.includes('@azure/msal')) {
            return 'Azure MSAL ecosystem upgrade required - coordinated upgrade needed';
        }

        if (errorMessage.includes('@types/react')) {
            return 'React types ecosystem upgrade required - coordinated upgrade needed';
        }

        return 'Peer dependency conflict detected - manual intervention required';
    }

    async upgradeEcosystemPackages(ecosystem, packages) {
        // Skip if we've already upgraded this ecosystem
        if (this.upgradedEcosystems.has(ecosystem)) {
            this.log(`⏭️  Skipping ${ecosystem} ecosystem (already upgraded)`);
            return true;
        }

        this.log(`\n🌐 Upgrading ${ecosystem} ecosystem packages together: ${packages.join(', ')}`);
        
        let backupCreated = false;
        
        try {
            // Create ecosystem-specific backup
            await this.createBackup();
            backupCreated = true;
            
            // Build install command for all packages in ecosystem
            const installCommands = packages.map(pkg => {
                const info = this.discoveredPackages.get(pkg);
                return `${pkg}@${info.latestVersion}`;
            });
            
            // Try dry run first
            try {
                this.log(`  🧪 Running dry-run for ${ecosystem} ecosystem...`);
                await this.exec(`npm install ${installCommands.join(' ')} --dry-run`, { 
                    silent: true, 
                    timeout: 60000,
                    retries: 1 
                });
                this.log(`  ✅ Dry-run passed for ${ecosystem} ecosystem`);
            } catch (dryRunError) {
                if (this.isPeerDependencyConflict(dryRunError.message)) {
                    const conflictReason = this.extractPeerDependencyInfo(dryRunError.message);
                    this.log(`  ⚠️  ${ecosystem} ecosystem has peer dependency conflict: ${conflictReason}`);
                    this.log(`  🔄 Will attempt upgrade anyway and handle conflicts...`);
                } else {
                    this.error(`  ❌ Dry-run failed for ${ecosystem} ecosystem: ${dryRunError.message}`);
                }
            }
            
            // Install all packages together
            this.log(`  📦 Installing ${ecosystem} ecosystem packages...`);
            await this.exec(`npm install ${installCommands.join(' ')}`, { 
                silent: false, 
                timeout: 300000,
                retries: 2 
            });
            
            // Validate the upgrade (only for high-risk ecosystems)
            const ecosystemRisk = packages.some(pkg => {
                const info = this.discoveredPackages.get(pkg);
                return info && (info.riskLevel === 'high-risk' || this.criticalPackages.includes(pkg));
            });
            
            let validation = { success: true };
            if (ecosystemRisk) {
                validation = await this.validateUpgrade(ecosystem);
            }
            
            if (validation.success) {
                this.log(`✅ ${ecosystem} ecosystem upgraded successfully!`);
                
                // Mark all packages as successful
                packages.forEach(pkg => {
                    const info = this.discoveredPackages.get(pkg);
                    if (info) {
                        this.results.successful.push({
                            name: pkg,
                            oldVersion: info.currentVersion,
                            newVersion: info.latestVersion,
                            category: info.riskLevel,
                            ecosystem: ecosystem
                        });
                    }
                });
                
                this.upgradedEcosystems.add(ecosystem);
                return true;
            } else {
                this.error(`${ecosystem} ecosystem upgrade failed validation: ${validation.failedStep}`);
                if (backupCreated) {
                    await this.restoreBackup();
                }
                
                // Mark all packages as failed
                packages.forEach(pkg => {
                    const info = this.discoveredPackages.get(pkg);
                    if (info) {
                        this.results.failed.push({
                            name: pkg,
                            oldVersion: info.currentVersion,
                            targetVersion: info.latestVersion,
                            reason: `Ecosystem validation failed: ${validation.failedStep}`,
                            category: info.riskLevel,
                            ecosystem: ecosystem
                        });
                    }
                });
                
                return false;
            }
        } catch (error) {
            this.error(`${ecosystem} ecosystem upgrade failed: ${error.message}`, error);
            if (backupCreated) {
                try {
                    await this.restoreBackup();
                } catch (restoreError) {
                    this.error(`Failed to restore backup after ecosystem upgrade failure: ${restoreError.message}`);
                }
            }
            
            // Mark all packages as failed
            packages.forEach(pkg => {
                const info = this.discoveredPackages.get(pkg);
                if (info) {
                    this.results.failed.push({
                        name: pkg,
                        oldVersion: info.currentVersion,
                        targetVersion: info.latestVersion,
                        reason: `Ecosystem upgrade failed: ${error.message}`,
                        category: info.riskLevel,
                        ecosystem: ecosystem
                    });
                }
            });
            
            return false;
        }
    }

    async upgradePackage(packageName, targetVersion) {
        const currentVersion = await this.getCurrentVersion(packageName);

        if (!currentVersion) {
            this.log(`${packageName} not found in package.json`);
            return false;
        }

        if (currentVersion === targetVersion) {
            this.log(`${packageName} is already up to date`);
            this.results.skipped.push({
                name: packageName,
                currentVersion,
                reason: 'Already up to date'
            });
            return true;
        }

        let backupCreated = false;

        try {
            this.log(`\n⬆️  Upgrading ${packageName}: ${currentVersion} → ${targetVersion}...`);

            // Create individual backup for this package
            await this.createBackup();
            backupCreated = true;

            // Pre-check for peer dependency conflicts with dry-run
            try {
                this.log(`  🧪 Running dry-run for ${packageName}...`);
                await this.exec(`npm install ${packageName}@${targetVersion} --dry-run`, { 
                    silent: true, 
                    timeout: 30000,
                    retries: 1 
                });
                this.log(`  ✅ Dry-run passed for ${packageName}`);
            } catch (dryRunError) {
                if (this.isPeerDependencyConflict(dryRunError.message)) {
                    const conflictReason = this.extractPeerDependencyInfo(dryRunError.message);
                    this.log(`  ⚠️  ${packageName} has peer dependency conflict: ${conflictReason}`);
                    this.log(`  🔄 Will attempt upgrade anyway and handle conflicts...`);
                } else {
                    this.error(`  ❌ Dry-run failed for ${packageName}: ${dryRunError.message}`);
                }
            }

            // Install the package
            this.log(`  📦 Installing ${packageName}@${targetVersion}...`);
            await this.exec(`npm install ${packageName}@${targetVersion}`, { 
                silent: false, 
                timeout: 180000,
                retries: 2 
            });

            // Validate for high-risk packages or critical packages
            const packageInfo = this.discoveredPackages.get(packageName);
            let validation = { success: true };
            
            if ((packageInfo && packageInfo.riskLevel === 'high-risk') || this.criticalPackages.includes(packageName)) {
                validation = await this.validateUpgrade();
            }

            if (validation.success) {
                this.log(`✅ ${packageName} upgraded successfully!`);
                this.results.successful.push({
                    name: packageName,
                    oldVersion: currentVersion,
                    newVersion: targetVersion,
                    category: this.getPackageCategory(packageName)
                });
                return true;
            } else {
                this.error(`${packageName} upgrade failed validation: ${validation.failedStep}`);
                if (backupCreated) {
                    await this.restoreBackup();
                }
                this.results.failed.push({
                    name: packageName,
                    oldVersion: currentVersion,
                    targetVersion: targetVersion,
                    reason: `Validation failed: ${validation.failedStep}`,
                    category: this.getPackageCategory(packageName)
                });
                return false;
            }
        } catch (error) {
            this.error(`${packageName} upgrade failed: ${error.message}`, error);
            
            if (backupCreated) {
                try {
                    await this.restoreBackup();
                } catch (restoreError) {
                    this.error(`Failed to restore backup after package upgrade failure: ${restoreError.message}`);
                }
            }

            if (this.isPeerDependencyConflict(error.message)) {
                const conflictReason = this.extractPeerDependencyInfo(error.message);
                this.log(`⚠️  ${packageName} skipped: ${conflictReason}`);
                this.results.failed.push({
                    name: packageName,
                    oldVersion: currentVersion,
                    targetVersion: targetVersion,
                    reason: conflictReason,
                    category: this.getPackageCategory(packageName),
                    conflictType: 'peer-dependency'
                });
            } else {
                this.results.failed.push({
                    name: packageName,
                    oldVersion: currentVersion,
                    targetVersion: targetVersion,
                    reason: error.message,
                    category: this.getPackageCategory(packageName)
                });
            }
            return false;
        }
    }

    async upgradePackageWithPeerHandling(packageName, targetVersion) {
        const packageInfo = this.discoveredPackages.get(packageName);
        if (!packageInfo) {
            this.error(`Package info not found for ${packageName}`);
            return false;
        }
        
        const peers = packageInfo.peers || [];

        // Check if this package is part of an ecosystem
        const ecosystem = packageInfo.ecosystem;
        if (ecosystem && this.ecosystemMap.has(ecosystem)) {
            const ecosystemPackages = this.ecosystemMap.get(ecosystem);
            const needsUpgrade = ecosystemPackages.filter(pkg => 
                this.discoveredPackages.has(pkg) && 
                !this.results.successful.some(r => r.name === pkg) &&
                !this.results.failed.some(r => r.name === pkg)
            );
            
            if (needsUpgrade.length > 1) {
                // Upgrade the entire ecosystem together
                return await this.upgradeEcosystemPackages(ecosystem, needsUpgrade);
            }
        }

        // Check if any peers need upgrading first
        const peersToUpgrade = peers.filter(peer => this.discoveredPackages.has(peer));

        if (peersToUpgrade.length > 0) {
            this.log(`🔗 ${packageName} has peer dependencies that need upgrading first: ${peersToUpgrade.join(', ')}`);

            // Try to upgrade peers first
            for (const peer of peersToUpgrade) {
                const peerInfo = this.discoveredPackages.get(peer);

                // Skip if peer is already processed
                if (this.results.successful.some(p => p.name === peer) || 
                    this.results.failed.some(p => p.name === peer)) {
                    this.log(`⏭️  Peer ${peer} already processed`);
                    continue;
                }

                this.log(`  🔗 Upgrading peer dependency: ${peer}`);
                const peerSuccess = await this.upgradePackage(peer, peerInfo.latestVersion);

                if (!peerSuccess) {
                    this.log(`⚠️  Peer ${peer} failed, but continuing with ${packageName}...`);
                }
            }
        }

        // Now upgrade the main package
        return await this.upgradePackage(packageName, targetVersion);
    }

    async upgradeSequentially() {
        if (this.upgradeSequence.length === 0) {
            this.log('✅ No packages need upgrades!');
            return;
        }

        this.log(`\n🚀 Step 3: Starting sequential package upgrades...`);
        this.log(`📦 Will upgrade ${this.upgradeSequence.length} packages in dependency order\n`);

        let successCount = 0;
        let failureCount = 0;
        const processedPackages = new Set();

        for (let i = 0; i < this.upgradeSequence.length; i++) {
            const packageInfo = this.upgradeSequence[i];
            const packageData = this.discoveredPackages.get(packageInfo.name);

            if (!packageData) {
                this.error(`Package data not found for ${packageInfo.name}`);
                continue;
            }

            // Skip if already processed
            if (processedPackages.has(packageInfo.name)) {
                this.log(`⏭️  Skipping ${packageInfo.name} (already processed in this run)`);
                continue;
            }

            this.log(`\n🔄 Package ${i + 1}/${this.upgradeSequence.length}: ${packageInfo.name}`);
            this.log(`  Current: ${packageData.currentVersion} → Target: ${packageData.latestVersion} (${packageData.riskLevel})`);

            try {
                const success = await this.upgradePackageWithPeerHandling(packageInfo.name, packageData.latestVersion);
                processedPackages.add(packageInfo.name);

                if (success) {
                    successCount++;
                    this.log(`✅ Progress: ${successCount} successful, ${failureCount} failed`);
                } else {
                    failureCount++;
                    this.log(`❌ Progress: ${successCount} successful, ${failureCount} failed`);
                }

                // Small delay between packages to avoid overwhelming the system
                await this.sleep(500);

            } catch (error) {
                this.error(`Unexpected error upgrading ${packageInfo.name}: ${error.message}`, error);
                failureCount++;
                processedPackages.add(packageInfo.name);
            }
        }

        // Final validation after all upgrades
        this.log(`\n🔍 Running final validation after all upgrades...`);
        try {
            const finalValidation = await this.validateUpgrade('final');
            if (!finalValidation.success) {
                this.error(`Final validation failed: ${finalValidation.failedStep}`);
                // Log but don't fail the entire process
            } else {
                this.log(`✅ Final validation passed successfully!`);
            }
        } catch (error) {
            this.error(`Final validation error: ${error.message}`, error);
        }

        this.log(`\n📊 Sequential upgrade complete:`);
        this.log(`✅ Successful: ${successCount}`);
        this.log(`❌ Failed: ${failureCount}`);
        
        const totalAttempted = successCount + failureCount;
        if (totalAttempted > 0) {
            this.log(`📈 Success Rate: ${Math.round((successCount / totalAttempted) * 100)}%`);
        }
        this.log(`⏱️  Total Time: ${Math.round((Date.now() - this.startTime) / 60000)} minutes`);
    }

    getPackageCategory(packageName) {
        const packageInfo = this.discoveredPackages.get(packageName);
        return packageInfo ? packageInfo.riskLevel : 'unknown';
    }

    generateEmailReport() {
        const totalAttempted = this.results.successful.length + this.results.failed.length;
        const successRate = totalAttempted > 0 ? Math.round((this.results.successful.length / totalAttempted) * 100) : 0;

        let emailContent = `<h2>🚀 Automated React Package Upgrade Report</h2>
        <p><strong>Packages Analyzed:</strong> ${this.discoveredPackages.size} total packages discovered which need upgrading</p>  
        <p><strong>Success Rate:</strong> ${successRate}% (${this.results.successful.length}/${this.discoveredPackages.size} packages)</p>
        <p><strong>Total Time:</strong> ${Math.round((Date.now() - this.startTime) / 60000)} minutes</p>
        <p><strong>Backup Location:</strong> ${this.currentBackupDir || 'N/A'}</p>
      `;

        if (this.results.successful.length > 0) {
            // Group successful upgrades by ecosystem
            const successByEcosystem = {};
            this.results.successful.forEach(pkg => {
                const ecosystem = pkg.ecosystem || 'other';
                if (!successByEcosystem[ecosystem]) {
                    successByEcosystem[ecosystem] = [];
                }
                successByEcosystem[ecosystem].push(pkg);
            });

            emailContent += `
      <h3>✅ Successfully Upgraded (${this.results.successful.length} packages)</h3>
      <table style="border-collapse: collapse;font-family: Arial,sans-serif;font-size:13px;width:80%" cellpadding="3" cellspacing="0" border="1">
        <tr style="background-color: #28a745; color: white;">
          <th>Package</th><th>Old Version</th><th>New Version</th><th>Category</th><th>Ecosystem</th>
        </tr>`;

            this.results.successful.forEach(pkg => {
                emailContent += `
        <tr>
          <td>${pkg.name}</td><td>${pkg.oldVersion}</td><td>${pkg.newVersion}</td><td>${pkg.category}</td><td>${pkg.ecosystem || 'N/A'}</td>
        </tr>`;
            });
            emailContent += `
      </table><br>`;
        }

        if (this.results.failed.length > 0) {
            emailContent += `
            <h3>❌ Failed Upgrades (${this.results.failed.length} packages)</h3>
            <p><em>Includes peer dependency conflicts and other upgrade failures:</em></p>
            <table style="border-collapse: collapse;font-family: Arial,sans-serif;font-size:13px;width:80%" cellpadding="3" cellspacing="0" border="1">
            <tr style="background-color: #dc3545; color: white;">
            <th>Package</th><th>Current Version</th><th>Target Version</th><th>Failure Reason</th><th>Category</th><th>Ecosystem</th>
        </tr>`;

            this.results.failed.forEach(pkg => {
                emailContent += `
            <tr>
            <td>${pkg.name}</td><td>${pkg.oldVersion}</td><td>${pkg.targetVersion}</td><td>${pkg.reason}</td><td>${pkg.category}</td><td>${pkg.ecosystem || 'N/A'}</td>
            </tr>`;
            });
            emailContent += `
    </table><br>`;
        }

        if (this.results.skipped.length > 0) {
            emailContent += `
      <h3>⏭️ Skipped Packages (${this.results.skipped.length})</h3>
      <p><strong>Packages that were already up to date:</strong> ${this.results.skipped.map(p => p.name).join(', ')}</p><br>`;
        }

        if (this.results.newPackages.length > 0) {
            emailContent += `
      <h3>🆕 New Packages Detected (${this.results.newPackages.length})</h3>
      <p><strong>Please add to sequence:</strong> ${this.results.newPackages.join(', ')}</p><br>`;
        }

        // Add recommendations based on results
        emailContent += this.generateRecommendations();

        return emailContent;
    }

    generateRecommendations() {
        let recommendations = '<h3>💡 Recommendations</h3><ul>';

        if (this.results.failed.length > 0) {
            const peerConflicts = this.results.failed.filter(pkg => pkg.conflictType === 'peer-dependency').length;
            const ecosystemFailures = this.results.failed.filter(pkg => pkg.ecosystem).length;

            if (peerConflicts > 0) {
                recommendations += '<li>Plan coordinated ecosystem upgrades for peer dependency conflicts</li>';
            }

            if (ecosystemFailures > 0) {
                recommendations += '<li>Consider grouping React, React Router, Material UI, or MSAL packages together for coordinated upgrades</li>';
            }

            recommendations += '<li>Review peer dependency requirements for major version planning</li>';
            recommendations += '<li>Check for breaking changes in major version upgrades</li>';
        }

        if (this.results.successful.length > 0) {
            recommendations += '<li>Test the upgraded packages thoroughly in your development environment</li>';
            recommendations += '<li>Update your CI/CD pipelines if any build tools were upgraded</li>';
        }

        recommendations += '<li>Consider running the upgrade in smaller batches for better control</li>';
        recommendations += '</ul>';

        return recommendations;
    }

    removeDuplicates(packages) {
        const seen = new Set();
        return packages.filter(pkg => {
            const key = `${pkg.name}@${pkg.oldVersion}->${pkg.newVersion || pkg.targetVersion}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    async saveResults() {
        try {
            // Remove duplicates from successful and failed lists
            this.results.successful = this.removeDuplicates(this.results.successful);
            this.results.failed = this.removeDuplicates(this.results.failed);

            const results = {
                timestamp: new Date().toISOString(),
                summary: {
                    successful: this.results.successful.length,
                    failed: this.results.failed.length,
                    skipped: this.results.skipped.length,
                    newPackages: this.results.newPackages.length,
                    totalTime: `${Math.round((Date.now() - this.startTime) / 60000)} minutes`,
                    backupLocation: this.currentBackupDir
                },
                details: this.results,
                metadata: {
                    nodeVersion: process.version,
                    platform: os.platform(),
                    arch: os.arch(),
                    cwd: process.cwd(),
                    upgradeSequence: this.upgradeSequence.map(pkg => ({
                        name: pkg.name,
                        order: pkg.order,
                        ecosystem: pkg.ecosystem
                    }))
                }
            };

            const resultsFile = path.join(process.cwd(), 'upgrade_results.json');
            await fs.writeFile(resultsFile, JSON.stringify(results, null, 2));

            const emailContent = this.generateEmailReport();
            
            // Use GitHub Actions environment file for outputs
            const githubOutput = process.env.GITHUB_OUTPUT;
            if (githubOutput) {
                try {
                    fsSync.appendFileSync(githubOutput, `email_content<<EOF\n${emailContent}\nEOF\n`);
                    fsSync.appendFileSync(githubOutput, `total_packages=${this.results.successful.length + this.results.failed.length}\n`);
                    fsSync.appendFileSync(githubOutput, `successful_count=${this.results.successful.length}\n`);
                    fsSync.appendFileSync(githubOutput, `failed_count=${this.results.failed.length}\n`);
                    const successRate = this.results.successful.length + this.results.failed.length > 0
                        ? Math.round((this.results.successful.length / (this.results.successful.length + this.results.failed.length)) * 100)
                        : 0;
                    fsSync.appendFileSync(githubOutput, `success_rate=${successRate}\n`);
                    fsSync.appendFileSync(githubOutput, `backup_location=${this.currentBackupDir || 'N/A'}\n`);
                } catch (error) {
                    this.error('Failed to write GitHub Actions outputs', error);
                }
            }
            
            this.log(`Results saved to ${resultsFile}`);
        } catch (error) {
            this.error(`Failed to save results: ${error.message}`, error);
        }
    }

    printSummary() {
        this.log('\n📊 UPGRADE SUMMARY');
        this.log('==================');
        this.log(`✅ Successful: ${this.results.successful.length}`);
        this.log(`❌ Failed Upgrades: ${this.results.failed.length}`);
        this.log(`⏭️  Skipped: ${this.results.skipped.length}`);
        this.log(`🆕 New packages detected: ${this.results.newPackages.length}`);
        this.log(`⏱️  Total Time: ${Math.round((Date.now() - this.startTime) / 60000)} minutes`);
        this.log(`💾 Backup Location: ${this.currentBackupDir || 'N/A'}`);

        if (this.results.successful.length > 0) {
            this.log('\n✅ SUCCESSFUL UPGRADES:');
            this.results.successful.forEach(pkg => {
                this.log(`  ${pkg.name}: ${pkg.oldVersion} → ${pkg.newVersion} (${pkg.ecosystem || 'N/A'})`);
            });
        }

        if (this.results.failed.length > 0) {
            this.log('\n❌ FAILED UPGRADES:');
            this.results.failed.forEach(pkg => {
                this.log(`  ${pkg.name}: ${pkg.oldVersion} → ${pkg.targetVersion}`);
                this.log(`    Reason: ${pkg.reason}`);
                this.log(`    Ecosystem: ${pkg.ecosystem || 'N/A'}`);
            });
        }

        if (this.results.failed.length > 0) {
            this.log('\n💡 RECOMMENDATIONS:');
            this.log('  • Plan coordinated ecosystem upgrades for conflicted packages');
            this.log('  • Consider grouping React, React Router, Material UI, or MSAL packages together');
            this.log('  • Review peer dependency requirements for major version planning');
            this.log('  • Test upgraded packages thoroughly in development environment');
        }
    }

    async cleanup() {
        try {
            // Clear version cache
            this.versionCache.clear();
            
            // Clean up temporary files if any were created
            this.log('Cleanup completed successfully');
        } catch (error) {
            this.error('Error during cleanup', error);
        }
    }
}

async function main() {
    const upgrader = new PackageUpgrader();
    
    // Set up graceful shutdown handlers
    const cleanup = async (signal) => {
        upgrader.log(`\n⚠️  Received ${signal}. Performing cleanup...`);
        try {
            await upgrader.restoreBackup();
            await upgrader.cleanup();
        } catch (error) {
            upgrader.error('Error during cleanup', error);
        }
        process.exit(1);
    };

    process.on('SIGINT', () => cleanup('SIGINT'));
    process.on('SIGTERM', () => cleanup('SIGTERM'));
    process.on('uncaughtException', (error) => {
        upgrader.error('Uncaught Exception', error);
        cleanup('uncaughtException');
    });
    process.on('unhandledRejection', (reason, promise) => {
        upgrader.error('Unhandled Rejection', new Error(`Promise: ${promise}, Reason: ${reason}`));
        cleanup('unhandledRejection');
    });

    try {
        const args = process.argv.slice(2);
        const categoryArg = args.find(arg => arg.startsWith('--category='));
        const category = categoryArg ? categoryArg.split('=')[1] : 'safe';

        const validCategories = ['safe', 'low-risk', 'medium-risk', 'high-risk', 'all', 'all-safe'];
        if (!validCategories.includes(category)) {
            upgrader.error(`Invalid category: ${category}`);
            upgrader.log(`Valid categories: ${validCategories.join(', ')}`);
            process.exit(1);
        }

        upgrader.log(`🚀 Starting sequential package upgrade for category: ${category}`);
        upgrader.log(`📍 Working directory: ${process.cwd()}`);
        upgrader.log(`📅 Start time: ${new Date().toISOString()}`);

        await upgrader.createBackup();
        await upgrader.detectNewPackages();

        if (upgrader.discoveredPackages.size === 0) {
            upgrader.log('✅ No packages need upgrades!');
            await upgrader.saveResults();
            process.exit(0);
        }

        if (category === 'all') {
            await upgrader.upgradeSequentially();
        } else {
            const filteredSequence = upgrader.upgradeSequence.filter(pkg => {
                const packageInfo = upgrader.discoveredPackages.get(pkg.name);
                if (!packageInfo) return false;
                if (category === 'all-safe') return ['safe', 'low-risk'].includes(packageInfo.riskLevel);
                return packageInfo.riskLevel === category;
            });

            if (filteredSequence.length === 0) {
                upgrader.log(`No packages found for category: ${category}`);
                await upgrader.saveResults();
                process.exit(0);
            }

            upgrader.log(`📋 Filtered ${filteredSequence.length} packages for category: ${category}`);
            const originalSequence = upgrader.upgradeSequence;
            upgrader.upgradeSequence = filteredSequence;
            await upgrader.upgradeSequentially();
            upgrader.upgradeSequence = originalSequence;
        }

        await upgrader.saveResults();
        upgrader.printSummary();

        const totalPackages = upgrader.results.successful.length + upgrader.results.failed.length;

        if (upgrader.results.successful.length > 0) {
            upgrader.log(`\n🎉 Package upgrade completed! ${upgrader.results.successful.length} packages upgraded successfully.`);
            if (upgrader.results.failed.length > 0) {
                upgrader.log(`⚠️  ${upgrader.results.failed.length} packages had conflicts (peer dependencies or build issues) - this is normal.`);
            }
            await upgrader.cleanup();
            process.exit(0);
        } else if (totalPackages === 0) {
            upgrader.log('\n✅ All packages are already up to date!');
            await upgrader.cleanup();
            process.exit(0);
        } else {
            upgrader.log('\n⚠️ All packages failed to upgrade - manual intervention required.');
            upgrader.log('🔧 Workflow will continue to send email notification for manual review.');
            upgrader.log(`📁 Backup available at: ${upgrader.currentBackupDir}`);
            await upgrader.cleanup();
            process.exit(0);
        }

    } catch (error) {
        upgrader.error(`Fatal error in main function: ${error.message}`, error);
        
        // Attempt to restore backup on fatal error
        try {
            await upgrader.restoreBackup();
            upgrader.log('Backup restored successfully after fatal error');
        } catch (restoreError) {
            upgrader.error('Failed to restore backup after fatal error', restoreError);
        }
        
        await upgrader.cleanup();
        process.exit(1);
    }
}

if (require.main === module) {
    main().catch((error) => {
        console.error('Unhandled error in main:', error);
        process.exit(1);
    });
}

module.exports = { PackageUpgrader };
