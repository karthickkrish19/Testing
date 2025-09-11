#!/usr/bin/env node

const fs = require('fs');
const { execSync } = require('child_process');

// Enhanced package dependency sequencing with more comprehensive coverage
const DEPENDENCY_SEQUENCE = {
    'react': { order: 1, peers: ['react-dom', '@types/react'] },
    'react-dom': { order: 2, peers: ['react', '@types/react-dom'] },
    'typescript': { order: 3, peers: [] },
    '@mui/material': { order: 4, peers: ['@emotion/react', '@emotion/styled', '@mui/icons-material'] },
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
    '@testing-library/react': { order: 17, peers: ['react'] },
    'react-scripts': { order: 18, peers: ['react', 'react-dom'] },
    'axios': { order: 19, peers: [] },
    'react-router-dom': { order: 20, peers: ['react'] }
};

// Enhanced package type classifications
const PACKAGE_TYPES = {
    core_frameworks: ['react', 'vue', 'angular', '@angular/core', 'react-dom'],
    build_tools: ['webpack', 'vite', 'rollup', 'parcel', 'typescript', 'react-scripts'],
    ui_frameworks: ['@mui/material', '@ant-design/core', 'bootstrap', '@mui/lab', '@mui/icons-material'],
    dev_tools: ['eslint', 'prettier', 'jest', '@testing-library/*', '@typescript-eslint/*', '@types/*'],
    utilities: ['axios', 'lodash', 'moment', 'classnames', 'nth-check', 'react-router-dom']
};

class PackageUpgrader {
    constructor() {
        this.results = { successful: [], failed: [], skipped: [], newPackages: [] };
        this.packageJsonBackup = '';
        this.packageLockBackup = '';
        this.discoveredPackages = new Map();
        this.upgradeSequence = [];
        this.versionCache = new Map(); // Cache for version lookups
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
                cwd: process.cwd(),
                timeout: options.timeout || 300000 // 5-minute default timeout
            });
        } catch (error) {
            if (!options.silent) {
                this.error(`Command failed: ${command}`);
                if (error.stderr) this.error(error.stderr.toString());
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

    async detectNewPackages() {
        try {
            const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
            const currentPackages = { ...packageJson.dependencies || {}, ...packageJson.devDependencies || {} };
            await this.discoverPackages(currentPackages);
            this.buildUpgradeSequence();
        } catch (error) {
            this.error(`Failed to detect packages: ${error.message}`);
        }
    }

    async discoverPackages(currentPackages) {
        this.log('🔍 Step 1: Discovering packages needing upgrades...');

        // Batch version checking to reduce npm calls
        const packagesToCheck = Object.entries(currentPackages);
        const batchSize = 5;
        
        for (let i = 0; i < packagesToCheck.length; i += batchSize) {
            const batch = packagesToCheck.slice(i, i + batchSize);
            
            await Promise.all(batch.map(async ([packageName, currentVersion]) => {
                const cleanVersion = currentVersion.replace(/[\^~]/, '');
                const latestVersion = await this.getLatestVersion(packageName);

                if (!latestVersion || !this.compareVersions(cleanVersion, latestVersion)) return;

                const riskLevel = this.assessPackageRisk(packageName, cleanVersion, latestVersion);
                const peers = this.getPeerDependencies(packageName);

                this.discoveredPackages.set(packageName, {
                    currentVersion: cleanVersion,
                    latestVersion,
                    riskLevel,
                    peers,
                    needsUpgrade: true
                });
            }));
        }

        this.log(`📦 Found ${this.discoveredPackages.size} packages needing upgrades`);
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

                this.log(`  Upgrading peer dependency: ${peer}`);
                const peerSuccess = await this.upgradePackage(peer, peerInfo.latestVersion);

                if (!peerSuccess) {
                    this.log(`⚠️  Peer ${peer} failed, but continuing with ${packageName}...`);
                }
            }
        }

        // Step 3b: Now upgrade the main package
        return await this.upgradePackage(packageName, targetVersion);
    }

    async getLatestVersion(packageName) {
        // Check cache first
        if (this.versionCache.has(packageName)) {
            return this.versionCache.get(packageName);
        }

        try {
            const result = this.exec(`npm view ${packageName} version`, { silent: true });
            const version = result.trim();
            this.versionCache.set(packageName, version);
            return version;
        } catch (error) {
            this.error(`Failed to get latest version for ${packageName}: ${error.message}`);
            return null;
        }
    }

    getCurrentVersion(packageName) {
        try {
            const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
            const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
            const version = deps[packageName];
            return version ? version.replace(/[\^~]/, '') : null;
        } catch (error) {
            return null;
        }
    }

    async validateUpgrade(packageName) {
        const packageInfo = this.discoveredPackages.get(packageName);
        const isSafe = ['safe', 'low-risk'].includes(packageInfo.riskLevel);
        
        const validationSteps = [
            { name: 'Installing dependencies', command: 'npm install' }
        ];
        
        // Skip type checking for safe packages to save time
        if (!isSafe) {
            validationSteps.push({ name: 'Type checking', command: 'npx tsc --noEmit' });
        }
        
        // Only run tests for high-risk packages
        if (packageInfo.riskLevel === 'high-risk') {
            validationSteps.push({ 
                name: 'Running tests', 
                command: 'npm run test -- --bail --detectOpenHandles --runInBand', 
                timeout: 120000 // 2-minute timeout for tests
            });
        }

        for (const step of validationSteps) {
            try {
                this.log(`${step.name}...`);
                if (step.timeout) {
                    execSync(step.command, { encoding: 'utf8', stdio: 'pipe', timeout: step.timeout });
                } else {
                    this.exec(step.command, { silent: true });
                }
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
                    this.log(`🔄 Will attempt upgrade anyway and handle conflicts...`);
                }
            }

            // Install the package
            this.exec(`npm install ${packageName}@${targetVersion}`, { silent: true });

            // Validate with appropriate level of checks
            const validation = await this.validateUpgrade(packageName);

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

            // Skip if already processed (e.g., as a peer dependency)
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

        // Optional batch install logic for safe/low-risk packages
        if (category === 'all-safe') {
            const batch = filteredSequence
                .map(pkg => {
                    const info = this.discoveredPackages.get(pkg.name);
                    return info ? `${pkg.name}@${info.latestVersion}` : null;
                })
                .filter(Boolean);

            if (batch.length > 0) {
                this.log(`🚀 Attempting batch install for ${batch.length} safe/low-risk packages...`);
                try {
                    this.exec(`npm install ${batch.join(' ')} --no-audit --no-fund`, { silent: true });
                    this.log('✅ Batch install successful');
                    
                    // Validate the batch installation with lighter checks
                    this.log('Validating batch installation...');
                    const validation = await this.validateUpgrade('batch-safe');
                    
                    if (validation.success) {
                        batch.forEach(pkg => {
                            const [name] = pkg.split('@');
                            this.results.successful.push({
                                name,
                                oldVersion: this.getCurrentVersion(name),
                                newVersion: this.discoveredPackages.get(name).latestVersion,
                                category: 'safe'
                            });
                        });
                        return;
                    } else {
                        this.log('❌ Batch validation failed. Falling back to individual installs...');
                    }
                } catch (error) {
                    this.log('❌ Batch install failed. Falling back to individual installs...');
                }
            }
        }

        await this.upgradeSequentially();

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

        // Step 1: Discover packages needing upgrades
        await upgrader.detectNewPackages();

        if (upgrader.discoveredPackages.size === 0) {
            upgrader.log('✅ No packages need upgrades!');
            process.exit(0);
        }

        // Step 2 & 3: Execute upgrades in smart sequence
        if (category === 'all') {
            await upgrader.upgradeSequentially();
        } else {
            await upgrader.upgradeCategory(category);
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
