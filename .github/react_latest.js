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

class PackageUpgrader {
  constructor() {
    this.results = { successful: [], failed: [], skipped: [], newPackages: [] };
    this.packageJsonBackup = '';
    this.packageLockBackup = '';
    this.discoveredPackages = new Map();
    this.upgradeSequence = [];
    this.versionCache = new Map(); // FEATURE: Cached version lookups
    this.startTime = Date.now(); // FEATURE: Execution time tracking
    this.stepTimes = {}; // Track individual step times
  }

  log(message) {
    console.log(`[${new Date().toISOString()}] ${message}`);
  }

  error(message) {
    console.error(`[${new Date().toISOString()}] ERROR: ${message}`);
  }

  // FEATURE: Better error handling with timeouts
  exec(command, options = {}) {
    try {
      return execSync(command, { 
        encoding: 'utf8', 
        stdio: options.silent ? 'pipe' : 'inherit',
        cwd: process.cwd(),
        timeout: options.timeout || 30000 // Default 30s timeout
      });
    } catch (error) {
      if (!options.silent) {
        this.error(`Command failed: ${command}`);
        this.error(error.message);
      }
      throw error;
    }
  }

  // FEATURE: Async wrapper for better error handling with timeouts
  execAsync(command, options = {}) {
    return new Promise((resolve, reject) => {
      try {
        const result = execSync(command, { 
          encoding: 'utf8', 
          stdio: options.silent ? 'pipe' : 'inherit',
          cwd: process.cwd(),
          timeout: options.timeout || 30000
        });
        resolve(result);
      } catch (error) {
        reject(error);
      }
    });
  }

  // FEATURE: Execution time tracking
  trackStepTime(stepName, startTime) {
    const duration = Math.round((Date.now() - startTime) / 1000);
    this.stepTimes[stepName] = duration;
    this.log(`⏱️ ${stepName} completed in ${duration}s`);
    return duration;
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

  // FEATURE: Batch processing for version lookups with cached results
  async batchGetLatestVersions(packageNames) {
    const stepStart = Date.now();
    this.log('🚀 Batch fetching latest versions with optimized npm commands...');
    
    const batchSize = 8; // Process 8 packages concurrently
    const results = new Map();
    
    for (let i = 0; i < packageNames.length; i += batchSize) {
      const batch = packageNames.slice(i, i + batchSize);
      const promises = batch.map(async (packageName) => {
        try {
          // FEATURE: Check cache first
          if (this.versionCache.has(packageName)) {
            return [packageName, this.versionCache.get(packageName)];
          }
          
          // FEATURE: Optimized npm commands with --no-audit --no-fund
          const result = await this.execAsync(`npm view ${packageName} version --no-audit --no-fund --timeout=8000`, { 
            silent: true, 
            timeout: 10000 
          });
          
          const version = result.trim();
          this.versionCache.set(packageName, version); // Cache the result
          return [packageName, version];
        } catch (error) {
          this.log(`⚠️ Failed to get version for ${packageName}: ${error.message}`);
          return [packageName, null];
        }
      });
      
      const batchResults = await Promise.all(promises);
      batchResults.forEach(([name, version]) => {
        if (version) results.set(name, version);
      });
      
      this.log(`📦 Processed ${Math.min(i + batchSize, packageNames.length)}/${packageNames.length} packages`);
    }
    
    this.trackStepTime('Version Fetching', stepStart);
    return results;
  }

  async detectNewPackages() {
    const stepStart = Date.now();
    try {
      const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
      const currentPackages = { ...packageJson.dependencies || {}, ...packageJson.devDependencies || {} };
      await this.discoverPackagesFast(currentPackages);
      this.buildUpgradeSequence();
      this.trackStepTime('Package Discovery', stepStart);
    } catch (error) {
      this.error(`Failed to detect packages: ${error.message}`);
    }
  }

  // FEATURE: Fast discovery with batch processing
  async discoverPackagesFast(currentPackages) {
    this.log('🔍 Step 1: Fast package discovery with batch processing...');
    
    const packageNames = Object.keys(currentPackages);
    const latestVersions = await this.batchGetLatestVersions(packageNames);
    
    for (const [packageName, currentVersionRaw] of Object.entries(currentPackages)) {
      const cleanVersion = currentVersionRaw.replace(/[\^~]/, '');
      const latestVersion = latestVersions.get(packageName); // may be undefined/null
      
      // If no latest version was found in the registry, keep the package and do not remove it.
      if (!latestVersion) {
        this.log(`ℹ️ No registry version found for ${packageName}; keeping current version (${cleanVersion}).`);
        this.results.skipped.push({
          name: packageName,
          currentVersion: cleanVersion,
          reason: 'Latest version unavailable in registry'
        });
        this.discoveredPackages.set(packageName, {
          currentVersion: cleanVersion,
          latestVersion: null,
          riskLevel: 'unknown',
          peers: this.getPeerDependencies(packageName),
          needsUpgrade: false
        });
        continue;
      }
      
      // If already at latest, skip
      if (!this.compareVersions(cleanVersion, latestVersion)) {
        this.log(`ℹ️ ${packageName} is already at latest version (${cleanVersion}).`);
        this.results.skipped.push({
          name: packageName,
          currentVersion: cleanVersion,
          reason: 'Already up to date'
        });
        this.discoveredPackages.set(packageName, {
          currentVersion: cleanVersion,
          latestVersion,
          riskLevel: 'safe',
          peers: this.getPeerDependencies(packageName),
          needsUpgrade: false
        });
        continue;
      }
      
      // Needs upgrade
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
    
    this.log(`📦 Found ${Array.from(this.discoveredPackages.values()).filter(p => p.needsUpgrade).length} packages needing upgrades`);
  }

  getPeerDependencies(packageName) {
    const sequenceInfo = DEPENDENCY_SEQUENCE[packageName];
    return sequenceInfo ? sequenceInfo.peers : [];
  }

  buildUpgradeSequence() {
    this.log('🔄 Step 2: Building smart upgrade sequence...');

    // Only include packages that need an upgrade
    const packagesWithOrder = Array.from(this.discoveredPackages.entries())
      .filter(([name, info]) => info && info.needsUpgrade)
      .map(([packageName]) => {
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

  // FEATURE: Quick validation with timeouts
  async quickValidateUpgrade() {
    try {
      this.log('⚡ Quick validation with optimized commands...');
      
      // FEATURE: Optimized npm commands
      await this.execAsync('npm install --no-audit --no-fund --prefer-offline', { 
        silent: true, 
        timeout: 90000 
      });
      
      await this.execAsync('npx tsc --noEmit', { 
        silent: true, 
        timeout: 45000 
      });
      
      return { success: true };
    } catch (error) {
      return { success: false, failedStep: 'quick-validation', error: error.message };
    }
  }

  // FEATURE: Batch processing for safe packages
  async batchUpgradeCompatiblePackages(packages) {
    if (packages.length === 0) return [];
    
    const stepStart = Date.now();
    this.log(`⚡ Batch upgrading ${packages.length} compatible packages...`);
    
    try {
      // Build upgrade command for multiple packages
      const upgradeCommands = packages.map(pkg => {
        const packageData = this.discoveredPackages.get(pkg.name);
        return `${pkg.name}@${packageData.latestVersion}`;
      });
      
      // FEATURE: Optimized npm commands with batch install
      const command = `npm install ${upgradeCommands.join(' ')}${this.npmFlags()}`;
      await this.execAsync(command, { timeout: 180000 });
      
      // Quick validation
      const validation = await this.quickValidateUpgrade();
      
      if (validation.success) {
        // Mark all as successful
        packages.forEach(pkg => {
          const packageData = this.discoveredPackages.get(pkg.name);
          this.results.successful.push({
            name: pkg.name,
            oldVersion: packageData.currentVersion,
            newVersion: packageData.latestVersion,
            category: packageData.riskLevel
          });
        });
        
        this.trackStepTime(`Batch Upgrade (${packages.length} packages)`, stepStart);
        this.log(`✅ Batch upgraded ${packages.length} packages successfully!`);
        return packages.map(p => p.name);
      } else {
        this.log(`❌ Batch upgrade failed, falling back to individual upgrades...`);
        this.restoreBackup();
        return [];
      }
    } catch (error) {
      // New: special handling for ETARGET (missing registry version)
      if (this.isNpmETargetError(error.message)) {
        const parsed = this.parseNpmETarget(error.message);
        const reason = parsed ? `Target version not found in registry: ${parsed.pkg}@${parsed.version}` : 'Target version not found in registry';
        packages.forEach(pkg => {
          this.results.failed.push({
            name: pkg.name,
            oldVersion: this.discoveredPackages.get(pkg.name).currentVersion,
            targetVersion: this.discoveredPackages.get(pkg.name).latestVersion,
            reason,
            category: this.getPackageCategory(pkg.name),
            conflictType: 'etarget'
          });
        });
        this.restoreBackup();
        return [];
      }

      this.log(`❌ Batch upgrade failed: ${error.message}`);
      this.restoreBackup();
      return [];
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

  // FEATURE: Better error handling with timeouts
  async validateUpgrade() {
    const validationSteps = [
      { 
        name: 'Installing dependencies', 
        command: 'npm install --no-audit --no-fund --prefer-offline',
        timeout: 120000 
      },
      { 
        name: 'Type checking', 
        command: 'npx tsc --noEmit',
        timeout: 60000 
      },
      { 
        name: 'Running tests', 
        command: 'npm run test -- --bail --detectOpenHandles --runInBand',
        timeout: 300000 
      }
    ];

    for (const step of validationSteps) {
      try {
        this.log(`${step.name}...`);
        await this.execAsync(step.command, { 
          silent: true, 
          timeout: step.timeout 
        });
        this.log(`${step.name} passed`);
      } catch (error) {
        this.error(`${step.name} failed: ${error.message}`);
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

  // New: detect ETARGET / "No matching version found" errors
  isNpmETargetError(errorMessage) {
    return /No matching version found for|ETARGET|notarget/i.test(errorMessage);
  }

  // New: try parse "No matching version found for <pkg>@<ver>"
  parseNpmETarget(errorMessage) {
    const m = errorMessage.match(/No matching version found for\s+([^\s@]+)@([^\s]+)/i);
    if (m) return { pkg: m[1], version: m[2] };
    const m2 = errorMessage.match(/Could not find version "([^"]+)" of "([^"]+)"/i);
    if (m2) return { pkg: m2[2], version: m2[1] };
    return null;
  }

  // New: centralize optional npm flags (enable legacy peer deps via env)
  npmFlags() {
    let flags = ' --no-audit --no-fund --prefer-offline';
    if (process.env.UPGRADE_USE_LEGACY_PEER_DEPS === '1') flags += ' --legacy-peer-deps';
    return flags;
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

  // FEATURE: Fast individual package upgrade with optimized commands
  async upgradePackageFast(packageName, targetVersion) {
    const currentVersion = this.getCurrentVersion(packageName);
    
    if (!currentVersion || currentVersion === targetVersion) {
      this.results.skipped.push({
        name: packageName,
        currentVersion,
        reason: 'Already up to date'
      });
      return true;
    }

    try {
      this.createBackup();
      
      // FEATURE: Optimized npm commands with fast install
      await this.execAsync(`npm install ${packageName}@${targetVersion}${this.npmFlags()}`, { 
        silent: true, 
        timeout: 90000 
      });
      
      // Quick validation only
      const validation = await this.quickValidateUpgrade();
      
      if (validation.success) {
        this.results.successful.push({
          name: packageName,
          oldVersion: currentVersion,
          newVersion: targetVersion,
          category: this.getPackageCategory(packageName)
        });
        return true;
      } else {
        this.restoreBackup();

        // Build a more meaningful, user-friendly failure reason from validation output
        const failedStep = validation.failedStep || 'validation';
        const rawError = validation.error || '';
        // Prefer a concise single-line reason
        let reason = rawError ? `${failedStep}: ${rawError}` : `Validation failed during ${failedStep}`;
        const firstLine = reason.split('\n')[0];
        reason = firstLine === 'quick-validation: Command failed: npm install --no-audit --no-fund --prefer-offline' ? 'Installing dependencies' : firstLine;

        const failureRecord = {
          name: packageName,
          oldVersion: currentVersion,
          targetVersion: targetVersion,
          reason,
          category: this.getPackageCategory(packageName)
        };

        // Detect peer dependency conflicts and mark them
        if (rawError && this.isPeerDependencyConflict(rawError)) {
          failureRecord.conflictType = 'peer-dependency';
        }

        this.results.failed.push(failureRecord);
        return false;
      }
    } catch (error) {
      this.restoreBackup();
      
      // New: check for ETARGET (missing version in registry)
      if (this.isNpmETargetError(error.message)) {
        const parsed = this.parseNpmETarget(error.message);
        const reason = parsed ? `Target version not found in registry: ${parsed.pkg}@${parsed.version}` : 'Target version not found in registry';
        this.results.failed.push({
          name: packageName,
          oldVersion: currentVersion,
          targetVersion: targetVersion,
          reason,
          category: this.getPackageCategory(packageName),
          conflictType: 'etarget'
        });
        return false;
      }

      // Check for peer dependency conflicts
      if (this.isPeerDependencyConflict(error.message)) {
        const conflictReason = this.extractPeerDependencyInfo(error.message);
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
        await this.execAsync(`npm install ${packageName}@${targetVersion} --dry-run --no-audit`, { 
          silent: true,
          timeout: 30000 
        });
      } catch (dryRunError) {
        if (this.isPeerDependencyConflict(dryRunError.message)) {
          const conflictReason = this.extractPeerDependencyInfo(dryRunError.message);
          this.log(`⚠️  ${packageName} has peer dependency conflict: ${conflictReason}`);
          this.log(`🔄 Will attempt upgrade anyway and handle conflicts...`);
        }
      }
      
      // FEATURE: Optimized npm install command
      await this.execAsync(`npm install ${packageName}@${targetVersion}${this.npmFlags()}`, { 
        silent: true,
        timeout: 120000 
      });
      
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
      // New: handle ETARGET here too
      if (this.isNpmETargetError(error.message)) {
        const parsed = this.parseNpmETarget(error.message);
        const reason = parsed ? `Target version not found in registry: ${parsed.pkg}@${parsed.version}` : 'Target version not found in registry';
        this.log(`⚠️  ${packageName} skipped: ${reason}`);
        this.restoreBackup();
        this.results.failed.push({
          name: packageName,
          oldVersion: currentVersion,
          targetVersion: targetVersion,
          reason,
          category: this.getPackageCategory(packageName),
          conflictType: 'etarget'
        });
        return false;
      }

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
        
        this.log(`🔗 Upgrading peer dependency: ${peer}`);
        const peerSuccess = await this.upgradePackage(peer, peerInfo.latestVersion);
        
        if (!peerSuccess) {
          this.log(`⚠️  Peer ${peer} failed, but continuing with ${packageName}...`);
        }
      }
    }
    
    // Step 3b: Now upgrade the main package
    return await this.upgradePackage(packageName, targetVersion);
  }

  // FEATURE: Smart batch processing with execution time tracking
  async upgradeSequentiallyOptimized() {
    if (this.upgradeSequence.length === 0) {
      this.log('✅ No packages need upgrades!');
      return;
    }

    const stepStart = Date.now();
    this.log(`\n🚀 Step 3: Optimized package upgrades with batch processing...`);
    this.log(`📦 Will upgrade ${this.upgradeSequence.length} packages efficiently\n`);
    
    // FEATURE: Group packages by risk level for batch processing
    const safePackages = this.upgradeSequence.filter(pkg => {
      const packageData = this.discoveredPackages.get(pkg.name);
      return packageData.riskLevel === 'safe';
    });
    
    const lowRiskPackages = this.upgradeSequence.filter(pkg => {
      const packageData = this.discoveredPackages.get(pkg.name);
      return packageData.riskLevel === 'low-risk';
    });

    let processedPackages = new Set();

    // Step 1: Try batch upgrade safe packages
    if (safePackages.length > 0) {
      this.log(`⚡ Attempting batch upgrade of ${safePackages.length} safe packages...`);
      this.createBackup();
      
      const batchSuccessful = await this.batchUpgradeCompatiblePackages(safePackages);
      batchSuccessful.forEach(pkg => processedPackages.add(pkg));
    }

    // Step 2: Try batch upgrade low-risk packages (if safe batch succeeded)
    if (lowRiskPackages.length > 0 && safePackages.length === 0) {
      this.log(`⚡ Attempting batch upgrade of ${lowRiskPackages.length} low-risk packages...`);
      this.createBackup();
      
      const batchSuccessful = await this.batchUpgradeCompatiblePackages(lowRiskPackages);
      batchSuccessful.forEach(pkg => processedPackages.add(pkg));
    }

    // Step 3: Process remaining packages individually (but faster)
    const remainingPackages = this.upgradeSequence.filter(pkg => 
      !processedPackages.has(pkg.name)
    );

    if (remainingPackages.length > 0) {
      this.log(`\n🎯 Processing ${remainingPackages.length} packages individually with fast mode...`);
      
      for (const packageInfo of remainingPackages) {
        if (processedPackages.has(packageInfo.name)) continue;
        
        const packageData = this.discoveredPackages.get(packageInfo.name);
        this.log(`\n🔄 Upgrading ${packageInfo.name}: ${packageData.currentVersion} → ${packageData.latestVersion}`);
        
        const success = await this.upgradePackageFast(packageInfo.name, packageData.latestVersion);
        if (success) {
          processedPackages.add(packageInfo.name);
        }
      }
    }

    // Final validation with tests (only once at the end)
    if (this.results.successful.length > 0) {
      this.log('\n🧪 Running final validation with tests...');
      try {
        await this.execAsync('npm run test -- --bail --detectOpenHandles --runInBand', { 
          silent: true, 
          timeout: 300000 // 5 minutes max for tests
        });
        this.log('✅ All tests passed!');
      } catch (error) {
        this.log('⚠️ Some tests failed, but upgrades are complete. Manual review recommended.');
      }
    }

    const successCount = this.results.successful.length;
    const failureCount = this.results.failed.length;
    
    this.trackStepTime('Sequential Upgrade', stepStart);
    
    this.log(`\n📊 Optimized upgrade complete:`);
    this.log(`✅ Successful: ${successCount}`);
    this.log(`❌ Failed: ${failureCount}`);
    if (successCount + failureCount > 0) {
      this.log(`⚡ Success Rate: ${Math.round((successCount / (successCount + failureCount)) * 100)}%`);
    }
  }

  async upgradeSequentially() {
    return await this.upgradeSequentiallyOptimized();
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
    
    await this.upgradeSequentially();
    
    // Restore original sequence
    this.upgradeSequence = originalSequence;
  }

  getPackageCategory(packageName) {
    const packageInfo = this.discoveredPackages.get(packageName);
    return packageInfo ? packageInfo.riskLevel : 'unknown';
  }

  // FEATURE: Responsive email template
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

      const totalExecutionTime = Math.round((Date.now() - this.startTime) / 1000);
      
      const results = {
        timestamp: new Date().toISOString(),
        executionTime: {
          total: totalExecutionTime,
          steps: this.stepTimes
        },
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
  fs.appendFileSync(githubOutput, `execution_time=${totalExecutionTime}\n`);
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
    const totalExecutionTime = Math.round((Date.now() - this.startTime) / 1000);

    this.log('\n📊 UPGRADE SUMMARY');
    this.log('==================');
    this.log(`✅ Successful: ${this.results.successful.length}`);
    this.log(`❌ Failed Upgrades: ${allFailures.length}`);
    this.log(`⏭️  Skipped: ${this.results.skipped.length}`);
    this.log(`🆕 New packages detected: ${this.results.newPackages.length}`);
    this.log(`⏱️  Total execution time: ${totalExecutionTime}s`);

    // FEATURE: Show performance breakdown
    if (Object.keys(this.stepTimes).length > 0) {
      this.log('\n⚡ PERFORMANCE BREAKDOWN:');
      Object.entries(this.stepTimes).forEach(([step, time]) => {
        this.log(`  ${step}: ${time}s`);
      });
    }

    if (this.results.successful.length > 0) {
      this.log('\n✅ SUCCESSFUL UPGRADES:');
      this.results.successful.forEach(pkg => {
        this.log(`  ${pkg.name}: ${pkg.oldVersion} → ${pkg.newVersion}`);
      });
    }

    if (allFailures.length > 0) {
      this.log('\n❌ FAILED UPGRADES:');
      allFailures.forEach(pkg => {
        const conflictType = pkg.conflictType === 'peer-dependency' ? '[Peer Dependency]' : '[Other]';
        this.log(`  ${pkg.name}: ${pkg.oldVersion} → ${pkg.targetVersion} ${conflictType}`);
        this.log(`    Reason: ${pkg.reason}`);
      });
    }

    // Only show recommendations if there are any failures
    if (allFailures.length > 0) {
      const hasPeerConflicts = allFailures.some(pkg => pkg.conflictType === 'peer-dependency');
      
      this.log('\n💡 RECOMMENDATIONS:');
      if (hasPeerConflicts) {
        this.log('  • Plan coordinated ecosystem upgrades for conflicted packages');
        this.log('  • Consider grouping React, Material UI, or MSAL packages together');
        this.log('  • Review peer dependency requirements for major version planning');
      } else {
        this.log('  • Review failed packages for manual intervention');
        this.log('  • Check build configurations and dependencies');
      }
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
    upgrader.log(`🚀 Starting optimized package upgrade for category: ${category}`);
    
    // Step 1: Fast discovery with execution time tracking
    await upgrader.detectNewPackages();
    
    if (upgrader.discoveredPackages.size === 0) {
      upgrader.log('✅ No packages need upgrades!');
      process.exit(0);
    }
    
    // Step 2 & 3: Execute upgrades with batch processing and time tracking
    if (category === 'all') {
      await upgrader.upgradeSequentially();
    } else {
      await upgrader.upgradeCategory(category);
    }

    upgrader.saveResults();
    upgrader.printSummary();

    const totalExecutionTime = Math.round((Date.now() - upgrader.startTime) / 1000);
    upgrader.log(`\n⏱️ Total execution time: ${totalExecutionTime} seconds`);

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
