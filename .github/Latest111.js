#!/usr/bin/env node

const fs = require('fs').promises;
const fsSync = require('fs');
const { exec: execCallback } = require('child_process');
const { promisify } = require('util');
const os = require('os');
const path = require('path');

const execPromise = promisify(execCallback);

// Enhanced package dependency sequencing with react-router-dom as priority
const DEPENDENCY_SEQUENCE = {
    'react': { order: 1, peers: ['react-dom'], ecosystem: 'react' },
    'react-dom': { order: 2, peers: ['react'], ecosystem: 'react' },
    'react-router-dom': { order: 3, peers: ['react'], ecosystem: 'routing' }, // Higher priority
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

    // ... (rest of the class methods remain the same until the upgradeSequentially method)

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

        // First, ensure react-router-dom is upgraded early in the process
        const routerIndex = this.upgradeSequence.findIndex(pkg => pkg.name === 'react-router-dom');
        if (routerIndex > 0) {
            // Move react-router-dom to the beginning of the sequence
            const routerPackage = this.upgradeSequence.splice(routerIndex, 1)[0];
            this.upgradeSequence.unshift(routerPackage);
            this.log('🔀 Prioritizing react-router-dom upgrade due to test failures');
        }

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
            // Run npm install to ensure all dependencies are properly installed
            this.log('Ensuring all dependencies are properly installed...');
            await this.exec('npm install', { timeout: 300000 });
            
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

    // ... (rest of the class methods remain the same)

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
                        await this.exec(`npm install --save-dev ${pkg}@latest`, { timeout: 120000 });
                    } else {
                        this.log(`📦 Installing missing dependency: ${pkg}`);
                        await this.exec(`npm install ${pkg}@latest`, { timeout: 120000 });
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
}

// ... (rest of the file remains the same)
