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
    this.latestCache = new Map(); // cache for npm view
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
        // print limited tail of message for readability
        const msg = String(error.message || '').split('\n').slice(-25).join('\n');
        this.error(msg);
      }
      throw error;
    }
  }

  // Phase backup/restore (once per phase, not per package)
  createPhaseBackup() {
    this.log('Creating phase backup of package files...');
    if (fs.existsSync('package.json')) {
      this.packageJsonBackup = fs.readFileSync('package.json', 'utf8');
    }
    if (fs.existsSync('package-lock.json')) {
      this.packageLockBackup = fs.readFileSync('package-lock.json', 'utf8');
    }
  }
  restorePhaseBackup() {
    this.log('Restoring phase package files...');
    if (this.packageJsonBackup) fs.writeFileSync('package.json', this.packageJsonBackup);
    if (this.packageLockBackup) fs.writeFileSync('package-lock.json', this.packageLockBackup);
  }

  detectNewPackages() {
    try {
      const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
      const currentPackages = { ...(packageJson.dependencies || {}), ...(packageJson.devDependencies || {}) };
      this.discoverPackages(currentPackages);
      this.buildUpgradeSequence();
    } catch (error) {
      this.error(`Failed to detect packages: ${error.message}`);
    }
  }

  discoverPackages(currentPackages) {
    this.log('🔍 Step 1: Discovering packages needing upgrades...');
    for (const [packageName, currentVersion] of Object.entries(currentPackages)) {
      const cleanVersion = String(currentVersion || '').replace(/^[\^~]/, '');
      const latestVersion = this.getLatestVersion(packageName);
      if (!latestVersion || !this.compareVersions(cleanVersion, latestVersion)) continue;

      const riskLevel = this.assessPackageRisk(packageName, cleanVersion, latestVersion);
      const peers = this.getPeerDependencies(packageName);
      this.discoveredPackages.set(packageName, { currentVersion: cleanVersion, latestVersion, riskLevel, peers, needsUpgrade: true });
    }
    this.log(`📦 Found ${this.discoveredPackages.size} packages needing upgrades`);
  }

  getPeerDependencies(packageName) {
    const sequenceInfo = DEPENDENCY_SEQUENCE[packageName];
    return sequenceInfo ? sequenceInfo.peers : [];
  }

  buildUpgradeSequence() {
    this.log('🔄 Step 2: Building smart upgrade sequence...');
    const packagesWithOrder = Array.from(this.discoveredPackages.keys()).map((packageName) => {
      const sequenceInfo = DEPENDENCY_SEQUENCE[packageName];
      return { name: packageName, order: sequenceInfo ? sequenceInfo.order : 999, peers: sequenceInfo ? sequenceInfo.peers : [] };
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
    const cp = String(current).split('.').map((n) => parseInt(n) || 0);
    const lp = String(latest).split('.').map((n) => parseInt(n) || 0);
    return {
      major: (lp || 0) - (cp || 0),
      minor: (lp[1] || 0) - (cp[1] || 0),
      patch: (lp[2] || 0) - (cp[2] || 0)
    };
  }

  isCoreFramework(packageName) {
    return PACKAGE_TYPES.core_frameworks.some((pattern) =>
      pattern.includes('*') ? packageName.startsWith(pattern.replace('*', '')) : packageName === pattern
    );
  }
  isBuildTool(packageName) {
    return PACKAGE_TYPES.build_tools.includes(packageName);
  }
  isDevTool(packageName) {
    return PACKAGE_TYPES.dev_tools.some((pattern) =>
      pattern.includes('*') ? packageName.startsWith(pattern.replace('*', '')) : packageName === pattern
    );
  }

  getLatestVersion(packageName) {
    if (this.latestCache.has(packageName)) return this.latestCache.get(packageName);
    try {
      const result = this.exec(`npm view ${packageName} version`, { silent: true });
      const v = result.trim();
      this.latestCache.set(packageName, v);
      return v;
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
    } catch {
      return null;
    }
  }

  // Log-aware conflict recognition (from error log patterns)
  isPeerDependencyConflict(errorMessage) {
    const peerDependencyPatterns = [
      /ERESOLVE unable to resolve dependency tree/,
      /Could not resolve dependency:/,
      /peer dependency/i,
      /peer .* from .* requires/i,
      /Fix the upstream dependency conflict/
    ];
    return peerDependencyPatterns.some((pattern) => pattern.test(errorMessage));
  }

  extractPeerDependencyInfo(errorMessage) {
    const peerMatches = errorMessage.match(/peer ([^@]+)@"([^"]+)" from ([^@]+)@([^\s]+)/);
    if (peerMatches) return `Peer dependency conflict: ${peerMatches} requires ${peerMatches[1]}@${peerMatches[2]}`;

    const reactMatch = errorMessage.match(/Found: react@([^\s]+).*peer react@"([^"]+)"/);
    if (reactMatch) return `React version conflict: current React ${reactMatch[1]}, requires React ${reactMatch[2]}`;

    if (errorMessage.includes('@mui/') || errorMessage.includes('material')) return 'Material UI ecosystem upgrade required - coordinated upgrade needed';
    if (errorMessage.includes('@azure/msal')) return 'Azure MSAL ecosystem upgrade required - coordinated upgrade needed';
    if (errorMessage.includes('@types/react')) return 'React types ecosystem upgrade required - coordinated upgrade needed';

    return 'Peer dependency conflict detected - manual intervention required';
  }

  // Phase-level validation once per batch with guards
  async validatePhase() {
    // Detect presence for guarded validation
    let pkg;
    try {
      pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    } catch {
      pkg = { scripts: {} };
    }
    const hasTsConfig = fs.existsSync('tsconfig.json');
    const hasTestScript = pkg.scripts && typeof pkg.scripts.test === 'string';

    const steps = [
      { name: 'Installing dependencies', command: 'npm install --no-audit --no-fund' },
      hasTsConfig ? { name: 'Type checking', command: 'npx tsc --noEmit' } : null,
      hasTestScript ? { name: 'Running tests', command: 'npm run test -- --bail --detectOpenHandles --runInBand', timeout: 300000 } : null
    ].filter(Boolean);

    for (const step of steps) {
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
        // Print brief hint depending on step
        if (step.name === 'Type checking') {
          this.error('Hint: Ensure typescript is installed and tsconfig.json exists, or skip TS by adding tsconfig.json later.');
        }
        if (step.name === 'Running tests') {
          this.error('Hint: Ensure package.json contains a runnable \"test\" script or temporarily skip tests in CI.');
        }
        return { success: false, failedStep: step.name, error: error.message };
      }
    }
    return { success: true };
  }

  // Build ecosystem groups for phased upgrades
  buildUpgradeGroups() {
    const groups = { react: [], mui: [], msal: [], safe: [], other: [] };
    for (const pkg of this.upgradeSequence) {
      const name = pkg.name;
      if (
        name === 'react' ||
        name === 'react-dom' ||
        name.startsWith('@types/react') ||
        name === 'react-router-dom' ||
        name.startsWith('@testing-library/')
      ) {
        groups.react.push(name);
      } else if (name.startsWith('@mui/')) {
        groups.mui.push(name);
      } else if (name.startsWith('@azure/msal-')) {
        groups.msal.push(name);
      } else {
        const info = this.discoveredPackages.get(name);
        if (info && (info.riskLevel === 'safe' || info.riskLevel === 'low-risk')) groups.safe.push(name);
        else groups.other.push(name);
      }
    }
    const order = (a, b) => {
      const ia = this.upgradeSequence.findIndex((p) => p.name === a);
      const ib = this.upgradeSequence.findIndex((p) => p.name === b);
      return ia - ib;
    };
    for (const key of Object.keys(groups)) groups[key].sort(order);
    return groups;
  }

  // Batch installer with contained fallback
  batchInstall(packages) {
    if (!packages || packages.length === 0) return true;
    const spec = packages
      .map((n) => {
        const info = this.discoveredPackages.get(n);
        return info ? `${n}@${info.latestVersion}` : null;
      })
      .filter(Boolean);
    if (spec.length === 0) return true;

    this.log(`🚀 Batch installing ${spec.length} packages...`);
    this.log(`Spec: ${spec.join(' ')}`);
    try {
      this.exec(`npm install ${spec.join(' ')} --no-audit --no-fund`, { silent: true });
      return true;
    } catch (e) {
      if (/ERESOLVE|peer dependency/i.test(e.message)) {
        this.log('Peer conflicts detected. Retrying batch with --legacy-peer-deps...');
        try {
          this.exec(`npm install ${spec.join(' ')} --no-audit --no-fund --legacy-peer-deps`, { silent: true });
          return true;
        } catch (e2) {
          this.error(`Batch install failed with legacy-peer-deps: ${e2.message}`);
          return false;
        }
      }
      this.error(`Batch install failed: ${e.message}`);
      return false;
    }
  }

  // Phase runner (with success bookkeeping)
  async runPhasedUpgrades() {
    if (this.upgradeSequence.length === 0) {
      this.log('✅ No packages need upgrades!');
      return;
    }
    const groups = this.buildUpgradeGroups();

    const applyPhase = async (groupName, category) => {
      const list = groups[groupName];
      if (!list || list.length === 0) {
        this.log(`Skipping ${groupName} phase (no packages)`);
        return;
      }
      this.createPhaseBackup();
      if (this.batchInstall(list)) {
        const v = await this.validatePhase();
        if (!v.success) {
          this.error(`${groupName} phase failed at ${v.failedStep}. Reverting...`);
          this.restorePhaseBackup();
        } else {
          list.forEach((name) => {
            const info = this.discoveredPackages.get(name);
            if (info) this.results.successful.push({ name, oldVersion: info.currentVersion, newVersion: info.latestVersion, category });
          });
        }
      } else {
        this.error(`${groupName} batch install failed. Reverting...`);
        this.restorePhaseBackup();
      }
    };

    await applyPhase('safe', 'safe');
    await applyPhase('react', 'react');
    await applyPhase('mui', 'mui');
    await applyPhase('msal', 'msal');
    await applyPhase('other', 'other');

    this.log('📊 Phased upgrade flow complete.');
  }

  getPackageCategory(packageName) {
    const packageInfo = this.discoveredPackages.get(packageName);
    return packageInfo ? packageInfo.riskLevel : 'unknown';
  }

  generateEmailReport() {
    const totalAttempted = this.results.successful.length + this.results.failed.length;
    const successRate = totalAttempted > 0 ? Math.round((this.results.successful.length / totalAttempted) * 100) : 0;

    let emailContent = `
**Packages Analyzed:** ${this.discoveredPackages.size} total packages discovered which need upgrading

**Success Rate:** ${successRate}% (${this.results.successful.length}/${this.discoveredPackages.size} packages)

|Package|Old Version|New Version|
|--|--|--|
${this.results.successful.map((pkg) => `|${pkg.name}|${pkg.oldVersion}|${pkg.newVersion}|`).join('\n')}

*Includes peer dependency conflicts and other upgrade failures:*

|Package|Current Version|Target Version|Failure Reason|Category|
|--|--|--|--|--|
${this.results.failed.map((pkg) => `|${pkg.name}|${pkg.oldVersion}|${pkg.targetVersion}|${pkg.reason}|${pkg.category}|`).join('\n')}

**Please add to sequence:** ${this.results.newPackages.join(', ')}
`;
    return emailContent;
  }
}

// Main execution
(async () => {
  const upgrader = new PackageUpgrader();
  upgrader.log('Upgrading ALL packages via phased, batched strategy with guarded validation');
  upgrader.detectNewPackages();
  await upgrader.runPhasedUpgrades();
  upgrader.log('Done.');
})();
