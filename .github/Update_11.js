#!/usr/bin/env node

const fs = require('fs');
const { execSync } = require('child_process');

// Package dependency sequencing for smart upgrade order
const DEPENDENCY_SEQUENCE = {
    'react': { order: 1, peers: ['react-dom'] },
    'react-dom': { order: 2, peers: ['react'] },
    'typescript': { order: 3, peers: [] },
    '@mui/material': { order: 4, peers: ['@emotion/react', '@emotion/styled'] },
    '@emotion/react': { order: 5, peers: [] },
    '@emotion/styled': { order: 6, peers: ['@emotion/react'] },
    '@azure/msal-browser': { order: 7, peers: [] },
    '@azure/msal-react': { order: 8, peers: ['@azure/msal-browser', 'react'] },
    'eslint': { order: 9, peers: [] },
    '@typescript-eslint/eslint-plugin': { order: 10, peers: ['typescript', 'eslint'] },
    '@typescript-eslint/parser': { order: 11, peers: ['typescript', 'eslint'] },
    '@types/react': { order: 12, peers: ['react'] },
    '@types/react-dom': { order: 13, peers: ['react-dom', '@types/react'] },
    '@types/jest': { order: 14, peers: [] },
    '@mui/icons-material': { order: 15, peers: ['@mui/material'] },
    '@mui/lab': { order: 16, peers: ['@mui/material'] },
    '@testing-library/react': { order: 17, peers: ['react'] }
};

// Package type classifications for risk assessment
const PACKAGE_TYPES = {
    core_frameworks: ['react', 'vue', 'angular', '@angular/core'],
    build_tools: ['webpack', 'vite', 'rollup', 'parcel', 'typescript'],
    ui_frameworks: ['@mui/material', '@ant-design/core', 'bootstrap'],
    dev_tools: ['eslint', 'prettier', 'jest', '@testing-library/*'],
    utilities: ['axios', 'lodash', 'moment', 'classnames', 'nth-check']
};

// Default coordinated group definitions (used by grouped/transactional upgrade mode)
const GROUP_DEFINITIONS = {
    react_ecosystem: ['react', 'react-dom', '@types/react', '@types/react-dom'],
    material_ui: ['@mui/material', '@mui/icons-material', '@mui/lab', '@mui/x-data-grid', '@emotion/react', '@emotion/styled'],
    msal_ecosystem: ['@azure/msal-browser', '@azure/msal-react'],
    typescript_tooling: ['typescript', 'react-scripts', '@types/jest']
};

class PackageUpgrader {
    constructor() {
        this.results = { successful: [], failed: [], skipped: [], newPackages: [] };
        this.packageJsonBackup = '';
        this.packageLockBackup = '';
        this.discoveredPackages = new Map();
        this.upgradeSequence = [];
        // New properties for grouped mode customization
        this.groupDefinitions = GROUP_DEFINITIONS; // may be overridden via CLI/file
        this.dryRunOnly = false; // if true, grouped mode will only perform dry-run and not write installs
        this.globalValidationMode = 'auto'; // 'auto'|'quick'|'full'|'none' - affects validation behavior
    }

    log(message) {
        console.log(`[${new Date().toISOString()}] ${message}`);
    }

    error(message) {
        console.error(`[${new Date().toISOString()}] ERROR: ${message}`);
    }

    exec(command, options = {}) {
        try {
            return execSync(command, {
                encoding: 'utf8',
                stdio: options.silent ? 'pipe' : 'inherit',
                cwd: process.cwd()
            });
        } catch (error) {
            if (!options.silent) {
                this.error(`Command failed: ${command}`);
                this.error(error.message);
            }
            throw error;
        }
    }

    createBackup() {
        this.log('Creating backup of package files...');
        if (fs.existsSync('package.json')) {
            this.packageJsonBackup = fs.readFileSync('package.json', 'utf8');
        }
        if (fs.existsSync('package-lock.json')) {
            this.packageLockBackup = fs.readFileSync('package-lock.json', 'utf8');
        }
    }

    restoreBackup() {
        this.log('Restoring original package files...');
        if (this.packageJsonBackup) {
            fs.writeFileSync('package.json', this.packageJsonBackup);
        }
        if (this.packageLockBackup) {
            fs.writeFileSync('package-lock.json', this.packageLockBackup);
        }
    }

    detectNewPackages() {
        try {
            const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
            const currentPackages = { ...packageJson.dependencies || {}, ...packageJson.devDependencies || {} };

            this.log('🔍 Step 1: Discovering packages needing upgrades (using npm outdated)...');

            // Use npm outdated once to get current/latest info for all packages (much faster than npm view per package)
            let outdated = {};
            try {
                const out = this.exec('npm outdated --json', { silent: true });
                outdated = out ? JSON.parse(out) : {};
            } catch (err) {
                // npm outdated exits non-zero when there are outdated packages; still returns JSON on stdout in many npm versions
                try {
                    // Try to read stdout from error (some npm versions print JSON to stderr)
                    const out2 = err && err.stdout ? err.stdout.toString() : null;
                    outdated = out2 ? JSON.parse(out2) : {};
                } catch (parseErr) {
                    // fallback: continue with per-package check
                    this.error('npm outdated parse failed, falling back to per-package checks');
                    outdated = {};
                }
            }

            // Build discoveredPackages using outdated data when available
            for (const [packageName, currentVersionSpec] of Object.entries(currentPackages)) {
                const cleanVersion = currentVersionSpec.replace(/[\^~]/, '');
                let latestVersion = null;

                if (outdated && outdated[packageName] && outdated[packageName].latest) {
                    latestVersion = outdated[packageName].latest;
                } else {
                    // fallback to previous method for packages not returned by npm outdated
                    latestVersion = this.getLatestVersion(packageName);
                }

                // Special-case: if project uses react-scripts (CRA), do NOT target TypeScript 5.x
                // react-scripts@5 expects typescript ^3.x || ^4.x; locking to latest 4.x avoids ERESOLVE failures.
                if (packageName === 'typescript') {
                    const hasCRA = (packageJson.dependencies && packageJson.dependencies['react-scripts']) ||
                                   (packageJson.devDependencies && packageJson.devDependencies['react-scripts']);
                    if (hasCRA) {
                        try {
                            const latest4 = this.exec('npm view typescript@4.x version', { silent: true }).trim();
                            if (latest4 && latest4.startsWith('4.')) {
                                this.log(`🔒 Locking typescript target to latest 4.x (${latest4}) because react-scripts is present`);
                                latestVersion = latest4;
                            }
                        } catch (err) {
                            // ignore and keep previously resolved latestVersion
                        }
                    }
                }

                if (!latestVersion || !this.compareVersions(cleanVersion, latestVersion)) continue;

                const riskLevel = this.assessPackageRisk(packageName, cleanVersion, latestVersion);
                const peers = this.getPeerDependencies(packageName);

                this.discoveredPackages.set(packageName, {
                    currentVersion: cleanVersion,
                    latestVersion,
                    riskLevel,
                    peers,
                    needsUpgrade: true
                });
            }

            this.log(`📦 Found ${this.discoveredPackages.size} packages needing upgrades`);
            this.buildUpgradeSequence();
        } catch (error) {
            this.error(`Failed to detect packages: ${error.message}`);
        }
    }

    getPeerDependencies(packageName) {
        const sequenceInfo = DEPENDENCY_SEQUENCE[packageName];
        return sequenceInfo ? sequenceInfo.peers : [];
    }

    buildUpgradeSequence() {
        this.log('🔄 Step 2: Building smart upgrade sequence...');

        const packagesWithOrder = Array.from(this.discoveredPackages.keys()).map(packageName => {
            const sequenceInfo = DEPENDENCY_SEQUENCE[packageName];
            return {
                name: packageName,
                order: sequenceInfo ? sequenceInfo.order : 999,
                peers: sequenceInfo ? sequenceInfo.peers : []
            };
        });

        packagesWithOrder.sort((a, b) => a.order - b.order);
        this.upgradeSequence = packagesWithOrder;

        this.log(`📋 Upgrade sequence determined (${this.upgradeSequence.length} packages):`);
        this.upgradeSequence.forEach((pkg, index) => {
            const packageInfo = this.discoveredPackages.get(pkg.name);
            this.log(`  ${index + 1}. ${pkg.name}: ${packageInfo.currentVersion} → ${packageInfo.latestVersion}`);
        });
    }

    compareVersions(current, latest) {
        return current !== latest;
    }

    assessPackageRisk(packageName, currentVersion, latestVersion) {
        const versionDiff = this.calculateVersionDiff(currentVersion, latestVersion);

        if (versionDiff.major > 0) return 'high-risk';
        if (this.isCoreFramework(packageName)) return 'high-risk';
        if (this.isBuildTool(packageName) && versionDiff.minor > 0) return 'medium-risk';
        if (this.isDevTool(packageName)) return 'low-risk';
        if (versionDiff.major === 0 && versionDiff.minor === 0) return 'safe';

        return 'low-risk';
    }

    calculateVersionDiff(current, latest) {
        const currentParts = current.split('.').map(n => parseInt(n) || 0);
        const latestParts = latest.split('.').map(n => parseInt(n) || 0);

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

    isBuildTool(packageName) {
        return PACKAGE_TYPES.build_tools.includes(packageName);
    }

    isDevTool(packageName) {
        return PACKAGE_TYPES.dev_tools.some(pattern =>
            pattern.includes('*') ? packageName.startsWith(pattern.replace('*', '')) : packageName === pattern
        );
    }

    async upgradePackageWithPeerHandling(packageName, targetVersion) {
        const packageInfo = this.discoveredPackages.get(packageName);
        const peers = packageInfo.peers || [];

        // Step 3a: Check if any peers need upgrading first
        const peersToUpgrade = peers.filter(peer => this.discoveredPackages.has(peer));

        if (peersToUpgrade.length > 0) {
            this.log(`🔗 ${packageName} has peer dependencies that need upgrading first: ${peersToUpgrade.join(', ')}`);

            // Try to upgrade peers first
            for (const peer of peersToUpgrade) {
                const peerInfo = this.discoveredPackages.get(peer);

                // Skip if peer is already processed or up to date
                if (this.results.successful.some(p => p.name === peer)) {
                    this.log(`✅ Peer ${peer} already upgraded`);
                    continue;
                }

                this.log(`Upgrading peer dependency: ${peer}`);
                const peerSuccess = await this.upgradePackage(peer, peerInfo.latestVersion);

                if (!peerSuccess) {
                    this.log(`⚠️  Peer ${peer} failed, but continuing with ${packageName}...`);
                }
            }
        }

        // Step 3b: Now upgrade the main package
        return await this.upgradePackage(packageName, targetVersion);
    }

    getLatestVersion(packageName) {
        try {
            const result = this.exec(`npm view ${packageName} version`, { silent: true });
            return result.trim();
        } catch (error) {
            this.error(`Failed to get latest version for ${packageName}: ${error.message}`);
            return null;
        }
    }

    getCurrentVersion(packageName) {
        try {
            const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
            const deps = { ...(packageJson.dependencies || {}), ...(packageJson.devDependencies || {}) };
            const version = deps[packageName];
            return version ? version.replace(/^[\^~]/, '') : null;
        } catch (error) {
            return null;
        }
    }

    async validateUpgrade(packageName, riskLevel) {
        // Faster validation rules:
        // - For safe and low-risk: only run npm install (fast) to refresh lockfile; skip tsc/tests
        // - For medium/high-risk: run full validation (install, tsc, tests)
        try {
            if (riskLevel === 'safe' || riskLevel === 'low-risk') {
                this.log(`Quick validation for ${packageName} (risk: ${riskLevel}): Installing dependencies only...`);
                this.exec('npm install --package-lock-only', { silent: true });
                return { success: true };
            }

            // Full validation for medium/high-risk packages
            const validationSteps = [
                { name: 'Installing dependencies', command: 'npm install' },
                { name: 'Type checking', command: 'npx tsc --noEmit' },
                { name: 'Running tests', command: 'npm run test -- --bail --detectOpenHandles --runInBand', timeout: 300000 }
            ];

            for (const step of validationSteps) {
                this.log(`${step.name}...`);
                if (step.timeout) {
                    execSync(step.command, { encoding: 'utf8', stdio: 'pipe', timeout: step.timeout });
                } else {
                    this.exec(step.command, { silent: true });
                }
                this.log(`${step.name} passed`);
            }

            return { success: true };
        } catch (error) {
            this.error(`Validation failed: ${error.message}`);
            return { success: false, failedStep: 'Validation', error: error.message };
        }
    }

    isPeerDependencyConflict(errorMessage) {
        const peerDependencyPatterns = [
            /ERESOLVE unable to resolve dependency tree/,
            /Could not resolve dependency:/,
            /peer dependency/i,
            /peer .* from .* requires/i,
            /Fix the upstream dependency conflict/
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

    async upgradePackage(packageName, targetVersion) {
        const currentVersion = this.getCurrentVersion(packageName);

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

        try {
            this.log(`\n⬆️  Upgrading ${packageName}: ${currentVersion} → ${targetVersion}...`);

            // Create individual backup for this package
            this.createBackup();

            // Pre-check for peer dependency conflicts with dry-run
            try {
                this.exec(`npm install ${packageName}@${targetVersion} --dry-run`, { silent: true });
            } catch (dryRunError) {
                if (this.isPeerDependencyConflict(dryRunError.message)) {
                    const conflictReason = this.extractPeerDependencyInfo(dryRunError.message);
                    this.log(`⚠️  ${packageName} has peer dependency conflict: ${conflictReason}`);
                    this.log(`🔍 Skipping actual install due to peer dependency conflict to avoid repeated failures.`);

                    // Record failed due to peer dependency conflict and restore backup
                    this.restoreBackup();
                    this.results.failed.push({
                        name: packageName,
                        oldVersion: currentVersion,
                        targetVersion: targetVersion,
                        reason: conflictReason,
                        category: this.getPackageCategory(packageName),
                        conflictType: 'peer-dependency-dry-run'
                    });

                    return false;
                }
                // If dry-run error wasn't a peer dependency conflict, continue and attempt install normally
            }

            // Install the package
            this.exec(`npm install ${packageName}@${targetVersion}`, { silent: true });

            // Validate with build check
            const validation = await this.validateUpgrade(packageName, this.getPackageCategory(packageName));

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
                this.log(`🔄 Reverting ${packageName}...`);
                this.restoreBackup();
                this.results.failed.push({
                    name: packageName,
                    oldVersion: currentVersion,
                    targetVersion: targetVersion,
                    reason: validation.failedStep,
                    category: this.getPackageCategory(packageName)
                });
                return false;
            }
        } catch (error) {
            // Check if this is a peer dependency conflict
            if (this.isPeerDependencyConflict(error.message)) {
                const conflictReason = this.extractPeerDependencyInfo(error.message);
                this.log(`⚠️  ${packageName} skipped: ${conflictReason}`);
                this.restoreBackup();
                this.results.failed.push({
                    name: packageName,
                    oldVersion: currentVersion,
                    targetVersion: targetVersion,
                    reason: conflictReason,
                    category: this.getPackageCategory(packageName),
                    conflictType: 'peer-dependency'
                });
                return false;
            }

            this.error(`${packageName} upgrade failed: ${error.message}`);
            this.log(`🔄 Reverting ${packageName}...`);
            this.restoreBackup();
            this.results.failed.push({
                name: packageName,
                oldVersion: currentVersion,
                targetVersion: targetVersion,
                reason: error.message,
                category: this.getPackageCategory(packageName)
            });
            return false;
        }
    }

    async upgradeSequentially(concurrency = 1) {
        if (this.upgradeSequence.length === 0) {
            this.log('✅ No packages need upgrades!');
            return;
        }

        this.log(`\n🚀 Step 3: Starting package upgrades (concurrency=${concurrency})...`);
        this.log(`📦 Will upgrade ${this.upgradeSequence.length} packages in dependency order\n`);

        // Separate sequential (medium/high-risk) and concurrent (safe/low-risk) items
        const sequentialItems = [];
        const concurrentItems = [];

        for (let i = 0; i < this.upgradeSequence.length; i++) {
            const packageInfo = this.upgradeSequence[i];
            const packageData = this.discoveredPackages.get(packageInfo.name);
            if (!packageData) continue;
            if (['safe', 'low-risk'].includes(packageData.riskLevel)) {
                concurrentItems.push({ packageInfo, packageData, index: i });
            } else {
                sequentialItems.push({ packageInfo, packageData, index: i });
            }
        }

        // Worker for sequential (risky) upgrades - keep existing per-package behavior
        const sequentialWorker = async (item) => {
            const { packageInfo, packageData, index } = item;
            if (this.results.successful.some(p => p.name === packageInfo.name) || this.results.failed.some(p => p.name === packageInfo.name)) {
                this.log(`⏭️  Skipping ${packageInfo.name} (already processed)`);
                return true;
            }
            this.log(`\n🔄 Package ${index + 1}/${this.upgradeSequence.length}: ${packageInfo.name} (risk: ${packageData.riskLevel})`);
            const success = await this.upgradePackageWithPeerHandling(packageInfo.name, packageData.latestVersion);
            const succ = this.results.successful.length;
            const fail = this.results.failed.length;
            this.log(success ? `✅ Progress: ${succ} successful, ${fail} failed\n` : `❌ Progress: ${succ} successful, ${fail} failed\n`);
            return success;
        };

        // Run sequential items one-by-one
        for (const item of sequentialItems) {
            await sequentialWorker(item);
        }

        // Batch concurrent safe/low-risk packages to reduce npm installs
        if (concurrentItems.length > 0) {
            this.log(`\n⚡ Batching ${concurrentItems.length} safe/low-risk packages with concurrency=${concurrency} to reduce npm installs`);
            const batchSize = Math.max(1, concurrency);
            for (let i = 0; i < concurrentItems.length; i += batchSize) {
                const batch = concurrentItems.slice(i, i + batchSize);
                // Filter out already processed
                const toProcess = batch.filter(item => !this.results.successful.some(p => p.name === item.packageInfo.name) && !this.results.failed.some(p => p.name === item.packageInfo.name));
                if (toProcess.length === 0) continue;

                // Build package targets for single install command and update package.json atomically
                const pkgTargets = {};
                for (const item of toProcess) {
                    pkgTargets[item.packageInfo.name] = item.packageData.latestVersion;
                }

                this.createBackup();
                let packageJsonObj;
                try {
                    packageJsonObj = JSON.parse(fs.readFileSync('package.json', 'utf8'));
                } catch (err) {
                    this.error(`Failed to read package.json for batch install: ${err.message}`);
                    // mark batch as failed
                    for (const item of toProcess) {
                        const oldV = this.getCurrentVersion(item.packageInfo.name) || item.packageData.currentVersion || null;
                        this.results.failed.push({ name: item.packageInfo.name, oldVersion: oldV, targetVersion: pkgTargets[item.packageInfo.name], reason: 'package.json read error', category: this.getPackageCategory(item.packageInfo.name) });
                    }
                    this.restoreBackup();
                    continue;
                }

                this.applyPackageVersionBumps(packageJsonObj, pkgTargets);

                try {
                    fs.writeFileSync('package.json', JSON.stringify(packageJsonObj, null, 2));
                } catch (err) {
                    this.error(`Failed to write package.json for batch: ${err.message}`);
                    for (const item of toProcess) {
                        const oldV = this.getCurrentVersion(item.packageInfo.name) || item.packageData.currentVersion || null;
                        this.results.failed.push({ name: item.packageInfo.name, oldVersion: oldV, targetVersion: pkgTargets[item.packageInfo.name], reason: 'package.json write error', category: this.getPackageCategory(item.packageInfo.name) });
                    }
                    this.restoreBackup();
                    continue;
                }

                // Run a single install for the whole batch with faster flags
                try {
                    this.log(`Installing batch: ${Object.entries(pkgTargets).map(([p, v]) => `${p}@${v}`).join(' ')}`);
                    // use --no-audit --no-fund to speed up installs
                    this.exec('npm install --no-audit --no-fund', { silent: true });

                    // Quick validation for safe/low-risk batch: refresh lockfile only
                    try {
                        this.exec('npm install --package-lock-only', { silent: true });
                        // mark success for each package in batch
                        for (const item of toProcess) {
                            const oldV = this.getCurrentVersion(item.packageInfo.name) || item.packageData.currentVersion || null;
                            this.results.successful.push({ name: item.packageInfo.name, oldVersion: oldV, newVersion: pkgTargets[item.packageInfo.name], category: this.getPackageCategory(item.packageInfo.name) });
                            this.log(`✅ ${item.packageInfo.name} upgraded in batch to ${pkgTargets[item.packageInfo.name]}`);
                        }
                    } catch (valErr) {
                        // validation failed for batch: restore and mark failures
                        const msg = valErr && valErr.message ? valErr.message : String(valErr);
                        this.error(`Batch validation failed: ${msg}`);
                        for (const item of toProcess) {
                            const oldV = this.getCurrentVersion(item.packageInfo.name) || item.packageData.currentVersion || null;
                            this.results.failed.push({ name: item.packageInfo.name, oldVersion: oldV, targetVersion: pkgTargets[item.packageInfo.name], reason: 'Validation', details: msg, category: this.getPackageCategory(item.packageInfo.name) });
                        }
                        this.restoreBackup();
                    }
                } catch (installErr) {
                    const msg = installErr && installErr.message ? installErr.message : String(installErr);
                    if (this.isPeerDependencyConflict(msg)) {
                        const reason = this.extractPeerDependencyInfo(msg);
                        this.log(`⚠️  Batch install detected peer dependency conflicts: ${reason}`);
                        for (const item of toProcess) {
                            const oldV = this.getCurrentVersion(item.packageInfo.name) || item.packageData.currentVersion || null;
                            this.results.failed.push({ name: item.packageInfo.name, oldVersion: oldV, targetVersion: pkgTargets[item.packageInfo.name], reason, category: this.getPackageCategory(item.packageInfo.name), conflictType: 'peer-dependency-batch' });
                        }
                    } else {
                        this.error(`Batch install failed: ${msg}`);
                        for (const item of toProcess) {
                            const oldV = this.getCurrentVersion(item.packageInfo.name) || item.packageData.currentVersion || null;
                            this.results.failed.push({ name: item.packageInfo.name, oldVersion: oldV, targetVersion: pkgTargets[item.packageInfo.name], reason: msg, category: this.getPackageCategory(item.packageInfo.name) });
                        }
                    }
                    this.restoreBackup();
                }
            }
        }

        const finalSuccess = this.results.successful.length;
        const finalFailure = this.results.failed.length;

        this.log(`\n📊 Sequential upgrade complete:`);
        this.log(`✅ Successful: ${finalSuccess}`);
        this.log(`❌ Failed: ${finalFailure}`);
        const denom = (finalSuccess + finalFailure) || 1;
        this.log(`Success Rate: ${Math.round((finalSuccess / denom) * 100)}%`);
    }

    async upgradeCategory(category) {
        // Filter packages by category for sequential upgrade
        const filteredSequence = this.upgradeSequence.filter(pkg => {
            const packageInfo = this.discoveredPackages.get(pkg.name);
            if (category === 'all') return true;
            if (category === 'all-safe') return ['safe', 'low-risk'].includes(packageInfo.riskLevel);
            return packageInfo.riskLevel === category;
        });

        if (filteredSequence.length === 0) {
            this.log(`No packages found for category: ${category}`);
            return;
        }

        this.log(`\n🎯 Upgrading ${category} packages (${filteredSequence.length} packages)`);

        // Temporarily update sequence for this category
        const originalSequence = this.upgradeSequence;
        this.upgradeSequence = filteredSequence;

        // Use concurrency for safe/low-risk to speed up (default 4)
        const concurrency = (category === 'safe' || category === 'low-risk' || category === 'all-safe') ? 4 : 1;
        await this.upgradeSequentially(concurrency);

        // Restore original sequence
        this.upgradeSequence = originalSequence;
    }

    getPackageCategory(packageName) {
        const packageInfo = this.discoveredPackages.get(packageName);
        return packageInfo ? packageInfo.riskLevel : 'unknown';
    }

    generateEmailReport() {
        const totalAttempted = this.results.successful.length + this.results.failed.length;
        const successRate = totalAttempted > 0 ? Math.round((this.results.successful.length / totalAttempted) * 100) : 0;

        // Use all failed packages instead
        const allFailures = this.results.failed;

        let emailContent = `<h2>🚀 Automated React Package Upgrade Report</h2>
        <p><strong>Packages Analyzed:</strong> ${this.discoveredPackages.size} total packages discovered which need upgrading</p>  
        <p><strong>Success Rate:</strong> ${successRate}% (${this.results.successful.length}/${this.discoveredPackages.size} packages)</p>
      `;

        if (this.results.successful.length > 0) {
            emailContent += `
      <h3>✅ Successfully Upgraded (${this.results.successful.length} packages)</h3>
      <table style="border-collapse: collapse;font-family: Arial,sans-serif;font-size:13px;width:80%" cellpadding="3" cellspacing="0" border="1">
        <tr style="background-color: #28a745; color: white;">
          <th>Package</th><th>Old Version</th><th>New Version</th>
        </tr>`;

            this.results.successful.forEach(pkg => {
                emailContent += `
        <tr>
          <td>${pkg.name}</td><td>${pkg.oldVersion}</td><td>${pkg.newVersion}</td>
        </tr>`;
            });
            emailContent += `
      </table><br>`;
        }

        // Single Failed Upgrades section (combining both peer dependency conflicts and other failures)
        if (allFailures.length > 0) {
            emailContent += `
            <h3>❌ Failed Upgrades (${allFailures.length} packages)</h3>
            <p><em>Includes peer dependency conflicts and other upgrade failures:</em></p>
            <table style="border-collapse: collapse;font-family: Arial,sans-serif;font-size:13px;width:80%" cellpadding="3" cellspacing="0" border="1">
            <tr style="background-color: #dc3545; color: white;">
            <th>Package</th><th>Current Version</th><th>Target Version</th><th>Failure Reason</th><th>Category</th>
        </tr>`;

            allFailures.forEach(pkg => {
                emailContent += `
            <tr>
            <td>${pkg.name}</td><td>${pkg.oldVersion}</td><td>${pkg.targetVersion}</td><td>${pkg.reason}</td><td>${pkg.category}</td>
            </tr>`;
            });
            emailContent += `
    </table><br>`;
        }

        if (this.results.newPackages.length > 0) {
            emailContent += `
      <h3>🆕 New Packages Detected (${this.results.newPackages.length})</h3>
      <p><strong>Please add to sequence:</strong> ${this.results.newPackages.join(', ')}</p><br>`;
        }

        return emailContent;
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

    saveResults() {
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
                    newPackages: this.results.newPackages.length
                },
                details: this.results
            };

            fs.writeFileSync('upgrade_results.json', JSON.stringify(results, null, 2));

            const emailContent = this.generateEmailReport();
            // Use GitHub Actions environment file for outputs
            const githubOutput = process.env.GITHUB_OUTPUT;
            if (githubOutput) {
                fs.appendFileSync(githubOutput, `email_content<<EOF\n${emailContent}\nEOF\n`);
                fs.appendFileSync(githubOutput, `total_packages=${this.results.successful.length + this.results.failed.length}\n`);
                fs.appendFileSync(githubOutput, `successful_count=${this.results.successful.length}\n`);
                fs.appendFileSync(githubOutput, `failed_count=${this.results.failed.length}\n`);
                const successRate = this.results.successful.length + this.results.failed.length > 0
                    ? Math.round((this.results.successful.length / (this.results.successful.length + this.results.failed.length)) * 100)
                    : 0;
                fs.appendFileSync(githubOutput, `success_rate=${successRate}\n`);
            }
            this.log('Results saved to upgrade_results.json');
        } catch (error) {
            this.error(`Failed to save results: ${error.message}`);
        }
    }

    printSummary() {
        // Use all failed packages instead of separating them
        const allFailures = this.results.failed;

        this.log('\n📊 UPGRADE SUMMARY');
        this.log('==================');
        this.log(`✅ Successful: ${this.results.successful.length}`);
        this.log(`❌ Failed Upgrades: ${allFailures.length}`);
        this.log(`⏭️  Skipped: ${this.results.skipped.length}`);
        this.log(`🆕 New packages detected: ${this.results.newPackages.length}`);


        if (this.results.successful.length > 0) {
            this.log('\n✅ SUCCESSFUL UPGRADES:');
            this.results.successful.forEach(pkg => {
                this.log(`  ${pkg.name}: ${pkg.oldVersion} → ${pkg.newVersion}`);
            });
        }

        if (allFailures.length > 0) {
            this.log('\n❌ FAILED UPGRADES:');
            allFailures.forEach(pkg => {
                this.log(`  ${pkg.name}: ${pkg.oldVersion} → ${pkg.targetVersion}`);
                this.log(`    Reason: ${pkg.reason}`);
            });
        }

        if (allFailures.length > 0) {
            this.log('\n💡 RECOMMENDATIONS:');
            this.log('  • Plan coordinated ecosystem upgrades for conflicted packages');
            this.log('  • Consider grouping React, Material UI, or MSAL packages together');
            this.log('  • Review peer dependency requirements for major version planning');
        }
    }

    // Load group definitions from an external JSON file or package.json "upgradeGroups" property
    loadGroupDefinitions(filePath) {
        // If CLI provided file, try to read and parse it
        if (filePath) {
            try {
                this.log(`Loading group definitions from ${filePath}...`);
                const raw = fs.readFileSync(filePath, 'utf8');
                const parsed = JSON.parse(raw);
                // Support two shapes: { groupName: [pkg,...] } or { groupName: { packages: [...], validation: 'full' } }
                this.groupDefinitions = parsed;
                this.log('Custom group definitions loaded from file');
                return;
            } catch (err) {
                this.error(`Failed to load group definitions file: ${err.message}. Falling back to defaults.`);
            }
        }

        // If not provided or failed, try to read from package.json.upgradeGroups
        try {
            const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
            if (pkg && pkg.upgradeGroups) {
                this.groupDefinitions = pkg.upgradeGroups;
                this.log('Loaded group definitions from package.json.upgradeGroups');
            }
        } catch (err) {
            // ignore - keep defaults
        }
    }

    // Build groups to attempt coordinated upgrades — only include packages discovered as needing upgrades
    buildCoordinatedGroups() {
        this.log('🔗 Building coordinated upgrade groups...');
        const groups = {};

        for (const [groupName, def] of Object.entries(this.groupDefinitions)) {
            // def may be an array of package names or an object { packages: [...], validation: 'full' }
            let pkgList = [];
            let validationForGroup = null;

            if (Array.isArray(def)) {
                pkgList = def;
            } else if (def && typeof def === 'object' && Array.isArray(def.packages)) {
                pkgList = def.packages;
                if (def.validation) validationForGroup = def.validation;
            }

            const present = pkgList.filter(p => this.discoveredPackages.has(p));
            if (present.length > 0) {
                groups[groupName] = { packages: present, validation: validationForGroup };
            }
        }

        // Also include any remaining packages as 'others' group
        const groupedPkgs = Object.values(groups).flatMap(g => g.packages);
        const remaining = Array.from(this.discoveredPackages.keys()).filter(k => !groupedPkgs.includes(k));
        if (remaining.length > 0) {
            groups['others'] = { packages: remaining, validation: null };
        }

        this.log(`🔎 Coordinated groups found: ${Object.keys(groups).join(', ')}`);
        return groups;
    }

    // Helper to set target versions in package.json for a set of packages
    applyPackageVersionBumps(packageJsonObj, pkgTargets) {
        for (const [pkg, ver] of Object.entries(pkgTargets)) {
            if (packageJsonObj.dependencies && Object.prototype.hasOwnProperty.call(packageJsonObj.dependencies, pkg)) {
                packageJsonObj.dependencies[pkg] = `^${ver}`;
            } else if (packageJsonObj.devDependencies && Object.prototype.hasOwnProperty.call(packageJsonObj.devDependencies, pkg)) {
                packageJsonObj.devDependencies[pkg] = `^${ver}`;
            } else {
                packageJsonObj.dependencies = packageJsonObj.dependencies || {};
                packageJsonObj.dependencies[pkg] = `^${ver}`;
                this.results.newPackages.push(pkg);
            }
        }
    }

    // Perform grouped upgrades: for each group, update package.json for all packages atomically, run dry-run, install, validate, and commit or restore
    async upgradeGrouped() {
        const groups = this.buildCoordinatedGroups();

        for (const [groupName, groupDef] of Object.entries(groups)) {
            const pkgs = groupDef.packages || [];
            const groupValidationOverride = groupDef.validation || null;

            this.log(`\n🔄 Attempting coordinated upgrade group: ${groupName} -> [${pkgs.join(', ')}]`);

            // Prepare package targets from discoveredPackages
            const pkgTargets = {};
            let highestRisk = 'safe';
            for (const p of pkgs) {
                const info = this.discoveredPackages.get(p);
                if (!info) continue;
                pkgTargets[p] = info.latestVersion;
                if (info.riskLevel === 'high-risk') highestRisk = 'high-risk';
                else if (info.riskLevel === 'medium-risk' && highestRisk !== 'high-risk') highestRisk = 'medium-risk';
                else if (info.riskLevel === 'low-risk' && highestRisk === 'safe') highestRisk = 'low-risk';
            }

            // Backup files
            this.createBackup();

            // Load package.json and apply bumps
            let packageJsonObj;
            try {
                packageJsonObj = JSON.parse(fs.readFileSync('package.json', 'utf8'));
            } catch (err) {
                this.error(`Failed to read package.json: ${err.message}`);
                continue;
            }

            this.applyPackageVersionBumps(packageJsonObj, pkgTargets);

            // Write modified package.json
            try {
                fs.writeFileSync('package.json', JSON.stringify(packageJsonObj, null, 2));
            } catch (err) {
                this.error(`Failed to write modified package.json: ${err.message}`);
                this.restoreBackup();
                continue;
            }

            // If dryRunOnly is set, run dry-run and record results but do not perform installs
            if (this.dryRunOnly) {
                try {
                    this.log(`Dry-run-only mode: running npm install --dry-run for group ${groupName}...`);
                    this.exec('npm install --dry-run', { silent: true });
                    this.log(`✅ Dry-run passed for group ${groupName} (no install performed)`);
                    for (const p of pkgs) {
                        const info = this.discoveredPackages.get(p) || {};
                        this.results.skipped.push({ name: p, oldVersion: info.currentVersion || null, targetVersion: pkgTargets[p], reason: 'dry-run-only' });
                    }
                    this.restoreBackup();
                    continue;
                } catch (dryErr) {
                    const msg = dryErr && dryErr.message ? dryErr.message : String(dryErr);
                    if (this.isPeerDependencyConflict(msg)) {
                        const reason = this.extractPeerDependencyInfo(msg);
                        this.log(`⚠️  Group ${groupName} dry-run detected peer dependency conflicts: ${reason}`);
                        for (const p of pkgs) {
                            const oldV = this.getCurrentVersion(p) || this.discoveredPackages.get(p).currentVersion || null;
                            this.results.failed.push({ name: p, oldVersion: oldV, targetVersion: pkgTargets[p], reason, category: this.getPackageCategory(p), conflictType: 'peer-dependency-group-dry-run' });
                        }
                    } else {
                        this.log(`⚠️  Group ${groupName} dry-run failed (non-peer): ${msg}`);
                        for (const p of pkgs) {
                            const oldV = this.getCurrentVersion(p) || this.discoveredPackages.get(p).currentVersion || null;
                            this.results.failed.push({ name: p, oldVersion: oldV, targetVersion: pkgTargets[p], reason: msg, category: this.getPackageCategory(p) });
                        }
                    }
                    this.restoreBackup();
                    continue;
                }
            }

            // Run npm install dry-run to detect ERESOLVE / peer conflicts early
            try {
                this.exec('npm install --dry-run', { silent: true });
            } catch (dryErr) {
                const msg = dryErr && dryErr.message ? dryErr.message : String(dryErr);
                if (this.isPeerDependencyConflict(msg)) {
                    const reason = this.extractPeerDependencyInfo(msg);
                    this.log(`⚠️  Group ${groupName} has peer dependency conflicts: ${reason}`);
                    // Record failures for each package in group and restore
                    for (const p of pkgs) {
                        const oldV = this.getCurrentVersion(p) || this.discoveredPackages.get(p).currentVersion || null;
                        this.results.failed.push({ name: p, oldVersion: oldV, targetVersion: pkgTargets[p], reason, category: this.getPackageCategory(p), conflictType: 'peer-dependency-group-dry-run' });
                    }
                    this.restoreBackup();
                    continue; // skip this group
                }
                // Non peer error on dry-run: treat as warning and attempt full install
                this.log(`⚠️  Dry-run failed for group ${groupName} (non-peer); attempting full install: ${msg}`);
            }

            // Attempt real install for the group
            try {
                this.exec('npm install', { silent: true });
            } catch (installErr) {
                const msg = installErr && installErr.message ? installErr.message : String(installErr);
                if (this.isPeerDependencyConflict(msg)) {
                    const reason = this.extractPeerDependencyInfo(msg);
                    this.log(`⚠️  Group ${groupName} failed install due to peer conflicts: ${reason}`);
                    for (const p of pkgs) {
                        const oldV = this.getCurrentVersion(p) || this.discoveredPackages.get(p).currentVersion || null;
                        this.results.failed.push({ name: p, oldVersion: oldV, targetVersion: pkgTargets[p], reason, category: this.getPackageCategory(p), conflictType: 'peer-dependency-group' });
                    }
                    this.restoreBackup();
                    continue; // next group
                }

                // Other install error: revert and mark failed
                this.error(`Group ${groupName} install failed: ${msg}`);
                for (const p of pkgs) {
                    const oldV = this.getCurrentVersion(p) || this.discoveredPackages.get(p).currentVersion || null;
                    this.results.failed.push({ name: p, oldVersion: oldV, targetVersion: pkgTargets[p], reason: installErr.message, category: this.getPackageCategory(p) });
                }
                this.restoreBackup();
                continue;
            }

            // Determine validation mode for this group: prefer per-group override, then globalValidationMode, then auto based on risk
            let validationMode = 'auto';
            if (groupValidationOverride) validationMode = groupValidationOverride;
            else if (this.globalValidationMode && this.globalValidationMode !== 'auto') validationMode = this.globalValidationMode;

            // Validation step: for grouped upgrades, run type-check and tests if highestRisk is medium/high or validationMode === 'full'
            try {
                if (validationMode === 'none') {
                    this.log(`Skipping validation for group ${groupName} (validationMode=none)`);
                } else if (validationMode === 'quick' || (validationMode === 'auto' && (highestRisk === 'safe' || highestRisk === 'low-risk'))) {
                    this.log(`Quick validation for group ${groupName} (risk: ${highestRisk}) - refreshing lockfile only...`);
                    this.exec('npm install --package-lock-only', { silent: true });
                } else {
                    this.log(`Full validation for group ${groupName} (risk: ${highestRisk})...`);
                    this.exec('npx tsc --noEmit', { silent: true });
                    this.exec('npm run test -- --bail --detectOpenHandles --runInBand', { silent: true });
                }

                // If validation passed, mark each package as successful
                for (const p of pkgs) {
                    const info = this.discoveredPackages.get(p) || {};
                    this.results.successful.push({ name: p, oldVersion: info.currentVersion || null, newVersion: info.latestVersion || pkgTargets[p], category: this.getPackageCategory(p) });
                }
                this.log(`✅ Group ${groupName} upgraded successfully: [${pkgs.join(', ')}]`);
            } catch (validationErr) {
                const msg = validationErr && validationErr.message ? validationErr.message : String(validationErr);
                this.error(`Group ${groupName} validation failed: ${msg}`);
                for (const p of pkgs) {
                    const oldV = this.getCurrentVersion(p) || this.discoveredPackages.get(p).currentVersion || null;
                    this.results.failed.push({ name: p, oldVersion: oldV, targetVersion: pkgTargets[p], reason: 'Validation', details: msg, category: this.getPackageCategory(p) });
                }
                this.restoreBackup();
                continue;
            }
        }

        // After groups done, print aggregated progress
        const finalSuccess = this.results.successful.length;
        const finalFailure = this.results.failed.length;
        this.log(`\n📊 Coordinated upgrade complete: ${finalSuccess} successful, ${finalFailure} failed`);
    }
}

async function main() {
    const args = process.argv.slice(2);
    const categoryArg = args.find(arg => arg.startsWith('--category='));
    const category = categoryArg ? categoryArg.split('=')[1] : 'safe';
    const groupedFlag = args.includes('--grouped');
    // New CLI flags
    const groupDefsArg = args.find(arg => arg.startsWith('--group-defs='));
    const groupDefsPath = groupDefsArg ? groupDefsArg.split('=')[1] : null;
    const dryRunOnlyFlag = args.includes('--dry-run-only');
    const validationArg = args.find(arg => arg.startsWith('--validation-mode='));
    const validationMode = validationArg ? validationArg.split('=')[1] : null;

    const validCategories = ['safe', 'low-risk', 'medium-risk', 'high-risk', 'all', 'all-safe'];
    if (!validCategories.includes(category)) {
        console.error(`Invalid category: ${category}`);
        console.error(`Valid categories: ${validCategories.join(', ')}`);
        process.exit(1);
    }

    const upgrader = new PackageUpgrader();

    try {
        upgrader.log(`🚀 Starting sequential package upgrade for category: ${category}`);

        // Apply CLI-driven grouped options if provided
        if (groupDefsPath) {
            upgrader.loadGroupDefinitions(groupDefsPath);
        } else {
            // allow loading from package.json.upgradeGroups if present
            upgrader.loadGroupDefinitions();
        }

        if (dryRunOnlyFlag) {
            upgrader.dryRunOnly = true;
            upgrader.log('⚠️  Dry-run-only mode enabled (--dry-run-only) - no installs will be performed for grouped upgrades');
        }

        if (validationMode) {
            upgrader.globalValidationMode = validationMode;
            upgrader.log(`⚙️  Global validation mode set to: ${validationMode}`);
        }

        // Step 1: Discover packages needing upgrades
        upgrader.detectNewPackages();

        if (upgrader.discoveredPackages.size === 0) {
            upgrader.log('✅ No packages need upgrades!');
            process.exit(0);
        }

        // If grouped mode requested, perform coordinated upgrades first
        if (groupedFlag) {
            upgrader.log('⚙️  Grouped/transactional upgrade mode enabled (--grouped)');
            await upgrader.upgradeGrouped();
        } else {
            // Step 2 & 3: Execute upgrades in smart sequence
            if (category === 'all') {
                await upgrader.upgradeSequentially();
            } else {
                await upgrader.upgradeCategory(category);
            }
        }

        upgrader.saveResults();
        upgrader.printSummary();

        // Calculate success metrics
        const totalPackages = upgrader.results.successful.length + upgrader.results.failed.length;

        if (upgrader.results.successful.length > 0) {
            upgrader.log(`\n🎉 Package upgrade completed! ${upgrader.results.successful.length} packages upgraded successfully.`);
            if (upgrader.results.failed.length > 0) {
                upgrader.log(`⚠️  ${upgrader.results.failed.length} packages had conflicts (peer dependencies or build issues) - this is normal.`);
            }
            process.exit(0); // Success if ANY packages were upgraded
        } else if (totalPackages === 0) {
            upgrader.log('\n✅ All packages are already up to date!');
            process.exit(0);
        } else {
            upgrader.log('\n⚠️ All packages failed to upgrade - manual intervention required.');
            upgrader.log('🔧 Workflow will continue to send email notification for manual review.');
            process.exit(0); // Continue workflow for email notification
        }

    } catch (error) {
        upgrader.error(`Fatal error: ${error.message}`);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}
