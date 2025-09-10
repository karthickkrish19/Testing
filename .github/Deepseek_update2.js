#!/usr/bin/env node

const fs = require('fs').promises;
const { exec: execCallback } = require('child_process');
const { promisify } = require('util');
const os = require('os');

const execPromise = promisify(execCallback);

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

class PackageUpgrader {
    constructor() {
        this.results = { successful: [], failed: [], skipped: [], newPackages: [] };
        this.packageJsonBackup = '';
        this.packageLockBackup = '';
        this.discoveredPackages = new Map();
        this.upgradeSequence = [];
        this.versionCache = new Map();
        this.concurrency = Math.max(1, os.cpus().length - 1);
    }

    log(message) {
        console.log(`[${new Date().toISOString()}] ${message}`);
    }

    error(message) {
        console.error(`[${new Date().toISOString()}] ERROR: ${message}`);
    }

    async exec(command, options = {}) {
        try {
            const { stdout, stderr } = await execPromise(command, {
                encoding: 'utf8',
                cwd: process.cwd(),
                timeout: options.timeout || 0
            });
            if (stderr && !options.silent) {
                console.error(stderr);
            }
            return stdout;
        } catch (error) {
            if (!options.silent) {
                this.error(`Command failed: ${command}`);
                this.error(error.message);
            }
            throw error;
        }
    }

    async createBackup() {
        this.log('Creating backup of package files...');
        try {
            this.packageJsonBackup = await fs.readFile('package.json', 'utf8');
            if (fs.existsSync('package-lock.json')) {
                this.packageLockBackup = await fs.readFile('package-lock.json', 'utf8');
            }
        } catch (error) {
            this.error(`Backup failed: ${error.message}`);
            throw error;
        }
    }

    async restoreBackup() {
        this.log('Restoring original package files...');
        try {
            if (this.packageJsonBackup) {
                await fs.writeFile('package.json', this.packageJsonBackup);
            }
            if (this.packageLockBackup) {
                await fs.writeFile('package-lock.json', this.packageLockBackup);
            }
        } catch (error) {
            this.error(`Restore failed: ${error.message}`);
            throw error;
        }
    }

    async detectNewPackages() {
        try {
            const packageJson = JSON.parse(await fs.readFile('package.json', 'utf8'));
            const currentPackages = { 
                ...packageJson.dependencies || {}, 
                ...packageJson.devDependencies || {} 
            };
            
            await this.discoverPackages(currentPackages);
            this.buildUpgradeSequence();
        } catch (error) {
            this.error(`Failed to detect packages: ${error.message}`);
            throw error;
        }
    }

    async discoverPackages(currentPackages) {
        this.log('🔍 Step 1: Discovering packages needing upgrades...');

        const packageNames = Object.keys(currentPackages);
        const results = await Promise.allSettled(
            packageNames.map(async (packageName) => {
                const currentVersion = currentPackages[packageName].replace(/[\^~]/, '');
                const latestVersion = await this.getLatestVersion(packageName);

                if (!latestVersion || !this.compareVersions(currentVersion, latestVersion)) {
                    return null;
                }

                const riskLevel = this.assessPackageRisk(packageName, currentVersion, latestVersion);
                const peers = this.getPeerDependencies(packageName);

                return {
                    packageName,
                    currentVersion,
                    latestVersion,
                    riskLevel,
                    peers,
                    needsUpgrade: true
                };
            })
        );

        for (const result of results) {
            if (result.status === 'fulfilled' && result.value) {
                const { packageName, ...packageInfo } = result.value;
                this.discoveredPackages.set(packageName, packageInfo);
            }
        }

        this.log(`📦 Found ${this.discoveredPackages.size} packages needing upgrades`);
    }

    getPeerDependencies(packageName) {
        const sequenceInfo = DEPENDENCY_SEQUENCE[packageName];
        return sequenceInfo ? sequenceInfo.peers : [];
    }

    buildUpgradeSequence() {
        this.log('🔄 Step 2: Building smart upgrade sequence...');

        const packagesWithOrder = Array.from(this.discoveredPackages.entries())
            .map(([name, info]) => {
                const sequenceInfo = DEPENDENCY_SEQUENCE[name];
                return {
                    name,
                    order: sequenceInfo ? sequenceInfo.order : 999,
                    peers: sequenceInfo ? sequenceInfo.peers : [],
                    riskLevel: info.riskLevel
                };
            });

        packagesWithOrder.sort((a, b) => a.order - b.order);
        this.upgradeSequence = packagesWithOrder;

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

    async getLatestVersion(packageName) {
        if (this.versionCache.has(packageName)) {
            return this.versionCache.get(packageName);
        }

        try {
            const result = await this.exec(`npm view ${packageName} version`, { silent: true });
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
            return null;
        }
    }

    async validateUpgrade() {
        const validationSteps = [
            { name: 'Installing dependencies', command: 'npm install', timeout: 300000 },
            { name: 'Type checking', command: 'npx tsc --noEmit', timeout: 120000 },
            { name: 'Running tests', command: 'npm test -- --bail --detectOpenHandles --runInBand', timeout: 600000 }
        ];

        for (const step of validationSteps) {
            try {
                this.log(`${step.name}...`);
                await this.exec(step.command, { silent: true, timeout: step.timeout });
                this.log(`${step.name} passed`);
            } catch (error) {
                this.error(`${step.name} failed`);
                return { success: false, failedStep: step.name, error: error.message };
            }
        }

        return { success: true };
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

        try {
            this.log(`\n⬆️  Upgrading ${packageName}: ${currentVersion} → ${targetVersion}...`);

            // Pre-check for peer dependency conflicts with dry-run
            try {
                await this.exec(`npm install ${packageName}@${targetVersion} --dry-run`, { silent: true });
            } catch (dryRunError) {
                if (this.isPeerDependencyConflict(dryRunError.message)) {
                    const conflictReason = this.extractPeerDependencyInfo(dryRunError.message);
                    this.log(`⚠️  ${packageName} has peer dependency conflict: ${conflictReason}`);
                    this.log(`🔄 Will attempt upgrade anyway and handle conflicts...`);
                }
            }

            // Install the package
            await this.exec(`npm install ${packageName}@${targetVersion}`, { silent: true });

            // Validate with build check
            const validation = await this.validateUpgrade();

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
                await this.restoreBackup();
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
            if (this.isPeerDependencyConflict(error.message)) {
                const conflictReason = this.extractPeerDependencyInfo(error.message);
                this.log(`⚠️  ${packageName} skipped: ${conflictReason}`);
                await this.restoreBackup();
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
            await this.restoreBackup();
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

    async upgradePackageWithPeerHandling(packageName, targetVersion) {
        const packageInfo = this.discoveredPackages.get(packageName);
        const peers = packageInfo.peers || [];

        const peersToUpgrade = peers.filter(peer => this.discoveredPackages.has(peer));

        if (peersToUpgrade.length > 0) {
            this.log(`🔗 ${packageName} has peer dependencies that need upgrading first: ${peersToUpgrade.join(', ')}`);

            for (const peer of peersToUpgrade) {
                const peerInfo = this.discoveredPackages.get(peer);

                if (this.results.successful.some(p => p.name === peer)) {
                    this.log(`✅ Peer ${peer} already upgraded`);
                    continue;
                }

                this.log(`  Upgrading peer dependency: ${peer}`);
                const peerSuccess = await this.upgradePackage(peer, peerInfo.latestVersion);

                if (!peerSuccess) {
                    this.log(`⚠️  Peer ${peer} failed, but continuing with ${packageName}...`);
                }
            }
        }

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

        for (let i = 0; i < this.upgradeSequence.length; i++) {
            const packageInfo = this.upgradeSequence[i];
            const packageData = this.discoveredPackages.get(packageInfo.name);

            if (this.results.successful.some(p => p.name === packageInfo.name)) {
                this.log(`⏭️  Skipping ${packageInfo.name} (already upgraded as peer dependency)`);
                continue;
            }

            if (this.results.failed.some(p => p.name === packageInfo.name)) {
                this.log(`⏭️  Skipping ${packageInfo.name} (already failed as peer dependency)`);
                continue;
            }

            this.log(`\n🔄 Package ${i + 1}/${this.upgradeSequence.length}: ${packageInfo.name}`);

            const success = await this.upgradePackageWithPeerHandling(packageInfo.name, packageData.latestVersion);

            if (success) {
                successCount++;
                this.log(`✅ Progress: ${successCount} successful, ${failureCount} failed\n`);
            } else {
                failureCount++;
                this.log(`❌ Progress: ${successCount} successful, ${failureCount} failed\n`);
            }
        }

        this.log(`\n📊 Sequential upgrade complete:`);
        this.log(`✅ Successful: ${successCount}`);
        this.log(`❌ Failed: ${failureCount}`);
        this.log(`  Success Rate: ${Math.round((successCount / (successCount + failureCount)) * 100)}%`);
    }

    getPackageCategory(packageName) {
        const packageInfo = this.discoveredPackages.get(packageName);
        return packageInfo ? packageInfo.riskLevel : 'unknown';
    }

    async saveResults() {
        try {
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

            await fs.writeFile('upgrade_results.json', JSON.stringify(results, null, 2));
            this.log('Results saved to upgrade_results.json');
        } catch (error) {
            this.error(`Failed to save results: ${error.message}`);
        }
    }

    printSummary() {
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
}

async function main() {
    const args = process.argv.slice(2);
    const categoryArg = args.find(arg => arg.startsWith('--category='));
    const category = categoryArg ? categoryArg.split('=')[1] : 'safe';

    const validCategories = ['safe', 'low-risk', 'medium-risk', 'high-risk', 'all', 'all-safe'];
    if (!validCategories.includes(category)) {
        console.error(`Invalid category: ${category}`);
        console.error(`Valid categories: ${validCategories.join(', ')}`);
        process.exit(1);
    }

    const upgrader = new PackageUpgrader();

    try {
        upgrader.log(`🚀 Starting sequential package upgrade for category: ${category}`);

        await upgrader.createBackup();
        await upgrader.detectNewPackages();

        if (upgrader.discoveredPackages.size === 0) {
            upgrader.log('✅ No packages need upgrades!');
            process.exit(0);
        }

        if (category === 'all') {
            await upgrader.upgradeSequentially();
        } else {
            const filteredSequence = upgrader.upgradeSequence.filter(pkg => {
                const packageInfo = upgrader.discoveredPackages.get(pkg.name);
                if (category === 'all-safe') return ['safe', 'low-risk'].includes(packageInfo.riskLevel);
                return packageInfo.riskLevel === category;
            });

            if (filteredSequence.length === 0) {
                upgrader.log(`No packages found for category: ${category}`);
                process.exit(0);
            }

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
            process.exit(0);
        } else if (totalPackages === 0) {
            upgrader.log('\n✅ All packages are already up to date!');
            process.exit(0);
        } else {
            upgrader.log('\n⚠️ All packages failed to upgrade - manual intervention required.');
            upgrader.log('🔧 Workflow will continue to send email notification for manual review.');
            process.exit(0);
        }

    } catch (error) {
        upgrader.error(`Fatal error: ${error.message}`);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}
