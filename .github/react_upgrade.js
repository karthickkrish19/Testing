#!/usr/bin/env node

const fs = require('fs');
const { execSync } = require('child_process');
const { exit } = require('process');

// Configuration: define package upgrade priority and categories
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

// Package categories for risk assessment
const PACKAGE_TYPES = {
  core_frameworks: ['react', 'vue', 'angular', '@angular/core'],
  build_tools: ['webpack', 'vite', 'rollup', 'parcel', 'typescript'],
  ui_frameworks: ['@mui/material', '@ant-design/core', 'bootstrap'],
  dev_tools: ['eslint', 'prettier', 'jest', '@testing-library/*']
};

class PackageUpgrader {
  constructor() {
    this.results = { successful: [], failed: [], skipped: [], newPackages: [] };
    this.packageJsonBackup = '';
    this.packageLockBackup = '';
    this.discoveredPackages = new Map();
    this.upgradeSequence = [];
    this.versionCache = new Map(); 
    this.startTime = Date.now();
    this.stepTimes = {};
  }

  log(message) {
    console.log(`[${new Date().toISOString()}] ${message}`);
  }

  error(message) {
    console.error(`[${new Date().toISOString()}] ERROR: ${message}`);
  }

  // Execute shell command with optional silence and timeout
  exec(command, options = {}) {
    try {
      return execSync(command, {
        encoding: 'utf8', 
        stdio: options.silent ? 'pipe' : 'inherit',
        cwd: process.cwd(),
        timeout: options.timeout || 300000
      });
    } catch (error) {
      if (!options.silent) {
        this.error(`Command failed: ${command}`);
        this.error(error.message);
      }
      throw error;
    }
  }

  // Async wrapper around exec
  execAsync(command, options = {}) {
    return new Promise((resolve, reject) => {
      try {
        const result = execSync(command, {
          encoding: 'utf8',
          stdio: options.silent ? 'pipe' : 'inherit',
          cwd: process.cwd(),
          timeout: options.timeout || 300000
        });
        resolve(result);
      } catch (error) {
        reject(error);
      }
    });
  }

  trackStepTime(stepName, startTime) {
    const duration = Math.round((Date.now() - startTime) / 1000);
    this.stepTimes[stepName] = duration;
    this.log(`⏱️ ${stepName} completed in ${duration}s`);
    return duration;
  }

  createBackup() {
    this.log('Creating backup of package.json and package-lock.json');
    if (fs.existsSync('package.json')) {
      this.packageJsonBackup = fs.readFileSync('package.json', 'utf8');
    }
    if (fs.existsSync('package-lock.json')) {
      this.packageLockBackup = fs.readFileSync('package-lock.json', 'utf8');
    }
  }

  restoreBackup() {
    this.log('Restoring original package.json and package-lock.json');
    if (this.packageJsonBackup) {
      fs.writeFileSync('package.json', this.packageJsonBackup);
    }
    if (this.packageLockBackup) {
      fs.writeFileSync('package-lock.json', this.packageLockBackup);
    }
  }

  // Batch fetch latest versions for packages, with caching
  async batchGetLatestVersions(packageNames) {
    const stepStart = Date.now();
    this.log('Fetching latest versions from npm registry');
    const batchSize = 8;
    const results = new Map();

    for (let i = 0; i < packageNames.length; i += batchSize) {
      const batch = packageNames.slice(i, i + batchSize);
      const promises = batch.map(async (packageName) => {
        // use cache if available
        if (this.versionCache.has(packageName)) {
          return [packageName, this.versionCache.get(packageName)];
        }
        try {
          // Use npm view to get version.
          const result = await this.execAsync(`npm view ${packageName} version --no-audit --no-fund`, {
            silent: true,
            timeout: 10000
          });
          const version = result.trim();
          if (version) this.versionCache.set(packageName, version);
          return [packageName, version];
        } catch (error) {
          this.log(`⚠️ Unable to fetch latest version for ${packageName}: ${error.message}`);
          return [packageName, null];
        }
      });

      const batchResults = await Promise.all(promises);
      batchResults.forEach(([name, version]) => {
        if (version) results.set(name, version);
      });
      this.log(`Processed ${Math.min(i + batchSize, packageNames.length)}/${packageNames.length}`);
    }

    this.trackStepTime('Fetching Versions', stepStart);
    return results;
  }

  // Detect which packages need upgrades
  async detectNewPackages() {
    const stepStart = Date.now();
    try {
      this.log('Detecting package upgrades needed');
      const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
      // Combine dependencies and devDependencies
      const currentPackages = { ...(packageJson.dependencies || {}), ...(packageJson.devDependencies || {}) };
      const packageNames = Object.keys(currentPackages);
      const latestVersions = await this.batchGetLatestVersions(packageNames);

      for (const [packageName, currentVersionRaw] of Object.entries(currentPackages)) {
        const currentVersion = currentVersionRaw.replace(/^[\^~]/, '') || '';
        const latestVersion = latestVersions.get(packageName);
        if (!latestVersion) {
          // Could not fetch latest; skip upgrade
          this.log(`No latest version found for ${packageName}`);
          this.results.skipped.push({ name: packageName, currentVersion, reason: 'No registry version found' });
          this.discoveredPackages.set(packageName, {
            currentVersion,
            latestVersion: null,
            riskLevel: 'unknown',
            peers: this.getPeerDependencies(packageName),
            needsUpgrade: false
          });
          continue;
        }
        if (currentVersion === latestVersion) {
          // Already up to date
          this.log(`${packageName} is up to date (${currentVersion})`);
          this.results.skipped.push({ name: packageName, currentVersion, reason: 'Already latest' });
          this.discoveredPackages.set(packageName, {
            currentVersion,
            latestVersion,
            riskLevel: 'safe',
            peers: this.getPeerDependencies(packageName),
            needsUpgrade: false
          });
        } else {
          // Needs upgrade
          const risk = this.assessPackageRisk(packageName, currentVersion, latestVersion);
          this.discoveredPackages.set(packageName, {
            currentVersion,
            latestVersion,
            riskLevel: risk,
            peers: this.getPeerDependencies(packageName),
            needsUpgrade: true
          });
        }
      }
      const count = Array.from(this.discoveredPackages.values()).filter(p => p.needsUpgrade).length;
      this.log(`Packages needing upgrade: ${count}`);
      this.trackStepTime('Package Discovery', stepStart);
    } catch (error) {
      this.error(`Failed package detection: ${error.message}`);
    }
  }

  getPeerDependencies(packageName) {
    const info = DEPENDENCY_SEQUENCE[packageName];
    return info ? info.peers : [];
  }

  buildUpgradeSequence() {
    this.log('Building upgrade sequence');
    // Filter and sort by defined order
    const sequenceList = Array.from(this.discoveredPackages.entries())
      .filter(([name, info]) => info.needsUpgrade)
      .map(([name, info]) => {
        const seq = DEPENDENCY_SEQUENCE[name];
        return {
          name,
          order: seq ? seq.order : 999,
          peers: seq ? seq.peers : []
        };
      });
    sequenceList.sort((a, b) => a.order - b.order);
    this.upgradeSequence = sequenceList;
    this.upgradeSequence.forEach((pkg, idx) => {
      const info = this.discoveredPackages.get(pkg.name);
      this.log(`  ${idx+1}. ${pkg.name}: ${info.currentVersion} -> ${info.latestVersion}`);
    });
  }

  // Compare semantic versions
  assessPackageRisk(packageName, currentVersion, latestVersion) {
    const diff = this.calculateVersionDiff(currentVersion, latestVersion);
    if (diff.major > 0) return 'high-risk';
    if (this.isCoreFramework(packageName)) return 'high-risk';
    if (this.isBuildTool(packageName) && diff.minor > 0) return 'medium-risk';
    if (this.isDevTool(packageName)) return 'low-risk';
    if (diff.major === 0 && diff.minor === 0) return 'safe';
    return 'low-risk';
  }

  calculateVersionDiff(current, latest) {
    const currParts = current.split('.').map(n => parseInt(n) || 0);
    const latParts = latest.split('.').map(n => parseInt(n) || 0);
    return {
      major: (latParts[0] || 0) - (currParts[0] || 0),
      minor: (latParts[1] || 0) - (currParts[1] || 0),
      patch: (latParts[2] || 0) - (currParts[2] || 0)
    };
  }

  isCoreFramework(pkg) {
    return PACKAGE_TYPES.core_frameworks.some(pattern => pkg.startsWith(pattern.replace('*','')));
  }
  isBuildTool(pkg) {
    return PACKAGE_TYPES.build_tools.includes(pkg);
  }
  isDevTool(pkg) {
    return PACKAGE_TYPES.dev_tools.some(pattern => pkg.startsWith(pattern.replace('*','')));
  }

  // Validate by installing and type-checking (and tests)
  async quickValidateUpgrade() {
    try {
      this.log('Running quick validation (install + tsc)');
      await this.execAsync('npm install --no-audit --prefer-offline', { silent: true, timeout: 120000 });
      await this.execAsync('npx tsc --noEmit', { silent: true, timeout: 60000 });
      return { success: true };
    } catch (error) {
      return { success: false, failedStep: 'validation', error: error.message };
    }
  }

  async validateUpgrade() {
    const steps = [
      { name: 'Install dependencies', cmd: 'npm install --no-audit --prefer-offline', timeout: 120000 },
      { name: 'Type check (tsc)', cmd: 'npx tsc --noEmit', timeout: 60000 },
      { name: 'Run tests', cmd: 'npm test -- --bail --detectOpenHandles --runInBand', timeout: 300000 }
    ];
    for (const step of steps) {
      try {
        this.log(`${step.name}...`);
        await this.execAsync(step.cmd, { silent: true, timeout: step.timeout });
        this.log(`${step.name} passed`);
      } catch (error) {
        this.error(`${step.name} failed: ${error.message}`);
        return { success: false, failedStep: step.name, error: error.message };
      }
    }
    return { success: true };
  }

  isPeerDependencyConflict(errorMessage) {
    const patterns = [/ERESOLVE unable to resolve dependency tree/, /peer dependency/i, /requires a peer of/, /Fix the upstream dependency conflict/];
    return patterns.some(p => p.test(errorMessage));
  }

  isNpmETargetError(errorMessage) {
    return /No matching version found|ETARGET|notarget/i.test(errorMessage);
  }

  parseNpmETarget(errorMessage) {
    const match = errorMessage.match(/No matching version found for (.+)@(\S+)/);
    if (match) {
      return { pkg: match[1], version: match[2] };
    }
    return null;
  }

  // Get current version from package.json dependencies
  getCurrentVersion(pkg) {
    try {
      const pj = JSON.parse(fs.readFileSync('package.json', 'utf8'));
      const allDeps = { ...(pj.dependencies || {}), ...(pj.devDependencies || {}) };
      const ver = allDeps[pkg];
      return ver ? ver.replace(/^[\^~]/, '') : null;
    } catch {
      return null;
    }
  }

  npmFlags() {
    let flags = ' --no-audit --prefer-offline';
    if (process.env.UPGRADE_USE_LEGACY_PEER_DEPS === '1') {
      flags += ' --legacy-peer-deps';
    }
    return flags;
  }

  // Upgrade multiple packages at once
  async batchUpgradePackages(packages) {
    if (!packages.length) return [];
    const start = Date.now();
    this.log(`Batch installing ${packages.map(p => p.name).join(', ')}`);
    try {
      const installCmd = 'npm install ' + packages.map(p => `${p.name}@${p.latestVersion}`).join(' ') + this.npmFlags();
      await this.execAsync(installCmd, { timeout: 180000 });
      // Quick validation after batch
      const valid = await this.quickValidateUpgrade();
      if (valid.success) {
        packages.forEach(p => {
          this.results.successful.push({ name: p.name, oldVersion: this.discoveredPackages.get(p.name).currentVersion, newVersion: p.latestVersion, category: this.discoveredPackages.get(p.name).riskLevel });
        });
        this.trackStepTime(`Batch upgrade (${packages.length} pkgs)`, start);
        this.log(`Batch upgrade of ${packages.length} packages succeeded`);
        return packages.map(p => p.name);
      }
      this.log('Batch validation failed, rolling back');
      this.restoreBackup();
      return [];
    } catch (error) {
      this.log(`Batch upgrade error: ${error.message}`);
      this.restoreBackup();
      return [];
    }
  }

  // Upgrade one package (fast mode: quick validation)
  async upgradePackageFast(pkg) {
    const packageName = pkg.name;
    const targetVersion = pkg.latestVersion;
    const currentVersion = this.getCurrentVersion(packageName);
    if (!currentVersion || currentVersion === targetVersion) {
      this.results.skipped.push({ name: packageName, currentVersion, reason: 'Up to date' });
      return true;
    }
    try {
      this.createBackup();
      await this.execAsync(`npm install ${packageName}@${targetVersion}${this.npmFlags()}`, { silent: true, timeout: 120000 });
      const validation = await this.quickValidateUpgrade();
      if (validation.success) {
        this.results.successful.push({ name: packageName, oldVersion: currentVersion, newVersion: targetVersion, category: this.discoveredPackages.get(packageName).riskLevel });
        return true;
      } else {
        this.log(`Validation failed for ${packageName}: ${validation.error}`);
        this.restoreBackup();
        const reason = validation.failedStep || 'validation failed';
        this.results.failed.push({ name: packageName, oldVersion: currentVersion, targetVersion, reason, category: this.discoveredPackages.get(packageName).riskLevel });
        return false;
      }
    } catch (error) {
      this.restoreBackup();
      if (this.isNpmETargetError(error.message)) {
        const parsed = this.parseNpmETarget(error.message);
        const reason = parsed ? `Version ${parsed.pkg}@${parsed.version} not found` : error.message;
        this.results.failed.push({ name: packageName, oldVersion: currentVersion, targetVersion, reason, category: this.discoveredPackages.get(packageName).riskLevel });
      } else if (this.isPeerDependencyConflict(error.message)) {
        const conflict = error.message.split('\n')[0];
        this.results.failed.push({ name: packageName, oldVersion: currentVersion, targetVersion, reason: `Peer conflict: ${conflict}`, category: this.discoveredPackages.get(packageName).riskLevel });
      } else {
        this.results.failed.push({ name: packageName, oldVersion: currentVersion, targetVersion, reason: error.message, category: this.discoveredPackages.get(packageName).riskLevel });
      }
      return false;
    }
  }

  // Upgrade with possible peer handling (upgrade peers first)
  async upgradePackageWithPeerHandling(pkg) {
    const { name: packageName, latestVersion } = pkg;
    const packageInfo = this.discoveredPackages.get(packageName);
    const peers = packageInfo.peers || [];
    // Attempt to upgrade peers first
    for (const peer of peers) {
      if (this.discoveredPackages.has(peer) && !this.results.successful.some(r => r.name === peer)) {
        const peerInfo = this.discoveredPackages.get(peer);
        this.log(`Resolving peer ${peer} for ${packageName}`);
        const success = await this.upgradePackage({ name: peer, latestVersion: peerInfo.latestVersion });
        if (!success) {
          this.log(`Peer ${peer} failed, continuing with ${packageName}`);
        }
      }
    }
    // Now upgrade main package
    return await this.upgradePackage({ name: packageName, latestVersion });
  }

  async upgradePackage(pkg) {
    const { name: packageName, latestVersion } = pkg;
    const currentVersion = this.getCurrentVersion(packageName);
    if (!currentVersion || currentVersion === latestVersion) {
      this.results.skipped.push({ name: packageName, currentVersion, reason: 'Up to date' });
      return true;
    }
    try {
      this.log(`Upgrading ${packageName}: ${currentVersion} -> ${latestVersion}`);
      this.createBackup();
      // Pre-check for peer dependency conflict (dry-run)
      try {
        await this.execAsync(`npm install ${packageName}@${latestVersion} --dry-run --no-audit`, { silent: true, timeout: 30000 });
      } catch (dryErr) {
        if (this.isPeerDependencyConflict(dryErr.message)) {
          this.log(`Peer conflict detected for ${packageName}: ${dryErr.message.split('\n')[0]}`);
          this.log('Proceeding with upgrade to handle manually');
        }
      }
      // Perform install
      await this.execAsync(`npm install ${packageName}@${latestVersion}${this.npmFlags()}`, { silent: true, timeout: 180000 });
      const validation = await this.validateUpgrade();
      if (validation.success) {
        this.log(`${packageName} upgraded successfully`);
        this.results.successful.push({ name: packageName, oldVersion: currentVersion, newVersion: latestVersion, category: this.discoveredPackages.get(packageName).riskLevel });
        return true;
      } else {
        this.error(`${packageName} failed validation: ${validation.failedStep}`);
        this.log(`Reverting ${packageName}`);
        this.restoreBackup();
        this.results.failed.push({ name: packageName, oldVersion: currentVersion, targetVersion: latestVersion, reason: validation.failedStep, category: this.discoveredPackages.get(packageName).riskLevel });
        return false;
      }
    } catch (error) {
      this.restoreBackup();
      if (this.isNpmETargetError(error.message)) {
        const parsed = this.parseNpmETarget(error.message);
        const reason = parsed ? `Version ${parsed.pkg}@${parsed.version} not found` : error.message;
        this.log(`${packageName} skipped: ${reason}`);
        this.results.failed.push({ name: packageName, oldVersion: currentVersion, targetVersion: latestVersion, reason, category: this.discoveredPackages.get(packageName).riskLevel });
        return false;
      }
      if (this.isPeerDependencyConflict(error.message)) {
        const conflict = error.message.split('\n')[0];
        this.log(`${packageName} skipped due to peer conflict: ${conflict}`);
        this.results.failed.push({ name: packageName, oldVersion: currentVersion, targetVersion: latestVersion, reason: `Peer conflict: ${conflict}`, category: this.discoveredPackages.get(packageName).riskLevel });
        return false;
      }
      this.error(`${packageName} upgrade error: ${error.message}`);
      this.log(`Reverting ${packageName}`);
      this.restoreBackup();
      this.results.failed.push({ name: packageName, oldVersion: currentVersion, targetVersion: latestVersion, reason: error.message, category: this.discoveredPackages.get(packageName).riskLevel });
      return false;
    }
  }

  // Perform upgrades efficiently
  async upgradeSequentiallyOptimized() {
    if (!this.upgradeSequence.length) {
      this.log('No packages to upgrade');
      return;
    }
    this.log(`Upgrading ${this.upgradeSequence.length} packages`);
    const stepStart = Date.now();
    // Separate packages by risk
    const safePkgs = this.upgradeSequence.filter(p => this.discoveredPackages.get(p.name).riskLevel === 'safe');
    const lowPkgs = this.upgradeSequence.filter(p => this.discoveredPackages.get(p.name).riskLevel === 'low-risk');
    const mediumPkgs = this.upgradeSequence.filter(p => this.discoveredPackages.get(p.name).riskLevel === 'medium-risk');
    const highPkgs = this.upgradeSequence.filter(p => this.discoveredPackages.get(p.name).riskLevel === 'high-risk');

    // Batch upgrade safe packages
    if (safePkgs.length) {
      this.log(`Attempt batch upgrade of ${safePkgs.length} safe packages`);
      this.createBackup();
      const successNames = await this.batchUpgradePackages(safePkgs);
      safePkgs.forEach(p => {
        if (successNames.includes(p.name)) {
          this.log(`${p.name} upgraded in batch`);
        }
      });
    }
    // Then process remaining by category sequentially
    if (lowPkgs.length && !safePkgs.length) {
      this.log(`Attempt batch upgrade of ${lowPkgs.length} low-risk packages`);
      this.createBackup();
      await this.batchUpgradePackages(lowPkgs);
    }
    const remainders = this.upgradeSequence.filter(p => !this.results.successful.some(r => r.name === p.name));
    // Individually upgrade remaining
    for (const pkg of remainders) {
      const info = this.discoveredPackages.get(pkg.name);
      if (info.riskLevel === 'safe' || info.riskLevel === 'low-risk') {
        // Safe or low-risk not done in batch
        await this.upgradePackageFast(pkg);
      } else {
        // medium or high risk: handle peers then upgrade
        await this.upgradePackageWithPeerHandling(pkg);
      }
    }
    // Final validation (run tests once)
    if (this.results.successful.length > 0) {
      this.log('Running final test suite');
      try {
        await this.execAsync('npm test -- --bail --detectOpenHandles --runInBand', { silent: true, timeout: 300000 });
        this.log('All tests passed');
      } catch {
        this.log('Some tests failed; please review manually');
      }
    }
    this.trackStepTime('All Upgrades', stepStart);
    this.log(`Upgrade summary: ${this.results.successful.length} succeeded, ${this.results.failed.length} failed`);
  }

  async upgradeSequentially() {
    this.buildUpgradeSequence();
    await this.upgradeSequentiallyOptimized();
  }

  async upgradeCategory(category) {
    const filtered = this.upgradeSequence.filter(p => {
      const lvl = this.discoveredPackages.get(p.name).riskLevel;
      if (category === 'all') return true;
      if (category === 'all-safe') return ['safe', 'low-risk'].includes(lvl);
      return lvl === category;
    });
    if (!filtered.length) {
      this.log(`No packages in category: ${category}`);
      return;
    }
    this.log(`Upgrading category '${category}' packages`);
    const original = this.upgradeSequence;
    this.upgradeSequence = filtered;
    await this.upgradeSequentially();
    this.upgradeSequence = original;
  }

  generateEmailReport() {
    const total = this.results.successful.length + this.results.failed.length;
    const successRate = total ? Math.round(this.results.successful.length / total * 100) : 0;
    let html = `<h2>Upgrade Report</h2><p>Total packages attempted: ${total}</p>
                <p>Success rate: ${successRate}%</p>`;
    if (this.results.successful.length) {
      html += `<h3>✅ Upgraded (${this.results.successful.length})</h3><table border="1"><tr><th>Package</th><th>Old</th><th>New</th></tr>`;
      this.results.successful.forEach(r => {
        html += `<tr><td>${r.name}</td><td>${r.oldVersion}</td><td>${r.newVersion}</td></tr>`;
      });
      html += `</table>`;
    }
    if (this.results.failed.length) {
      html += `<h3>❌ Failed (${this.results.failed.length})</h3><table border="1">
               <tr><th>Package</th><th>Current</th><th>Target</th><th>Reason</th></tr>`;
      this.results.failed.forEach(r => {
        html += `<tr><td>${r.name}</td><td>${r.oldVersion}</td><td>${r.targetVersion}</td><td>${r.reason}</td></tr>`;
      });
      html += `</table>`;
    }
    return html;
  }

  saveResults() {
    try {
      // Remove duplicates
      const unique = (arr, key) => Array.from(new Map(arr.map(x => [key(x), x])).values());
      this.results.successful = unique(this.results.successful, x => x.name + x.oldVersion + x.newVersion);
      this.results.failed = unique(this.results.failed, x => x.name + x.oldVersion + x.targetVersion);
      const totalTime = Math.round((Date.now() - this.startTime) / 1000);
      const summary = {
        totalPackages: this.discoveredPackages.size,
        successful: this.results.successful.length,
        failed: this.results.failed.length,
        skipped: this.results.skipped.length
      };
      const output = {
        timestamp: new Date().toISOString(),
        executionTime: totalTime,
        summary, results: this.results
      };
      fs.writeFileSync('upgrade_results.json', JSON.stringify(output, null, 2));
      // Write GitHub Actions outputs
      if (process.env.GITHUB_OUTPUT) {
        const outPath = process.env.GITHUB_OUTPUT;
        fs.appendFileSync(outPath, `email_content<<EOF\n${this.generateEmailReport()}\nEOF\n`);
        fs.appendFileSync(outPath, `total_packages=${this.discoveredPackages.size}\n`);
        fs.appendFileSync(outPath, `successful_count=${this.results.successful.length}\n`);
        fs.appendFileSync(outPath, `failed_count=${this.results.failed.length}\n`);
        fs.appendFileSync(outPath, `execution_time=${totalTime}\n`);
      }
      this.log('Results saved (upgrade_results.json)');
    } catch (err) {
      this.error(`Error saving results: ${err.message}`);
    }
  }

  printSummary() {
    this.log(`\nSummary:\n - Successful: ${this.results.successful.length}\n - Failed: ${this.results.failed.length}\n - Skipped: ${this.results.skipped.length}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const catArg = args.find(a => a.startsWith('--category='));
  const category = catArg ? catArg.split('=')[1] : 'safe';
  const valid = ['safe','low-risk','medium-risk','high-risk','all','all-safe'];
  if (!valid.includes(category)) {
    console.error(`Invalid category: ${category}`);
    process.exit(1);
  }
  const upgrader = new PackageUpgrader();
  try {
    upgrader.log(`Starting upgrade process (category: ${category})`);
    await upgrader.detectNewPackages();
    if (!upgrader.discoveredPackages.size) {
      upgrader.log('No dependencies found in package.json');
      return;
    }
    upgrader.buildUpgradeSequence();
    if (category === 'all') {
      await upgrader.upgradeSequentially();
    } else {
      await upgrader.upgradeCategory(category);
    }
    upgrader.saveResults();
    upgrader.printSummary();
    upgrader.log(`Total execution time: ${Math.round((Date.now() - upgrader.startTime)/1000)}s`);
    process.exit(0);
  } catch (e) {
    console.error('Fatal error during upgrade process:', e);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
