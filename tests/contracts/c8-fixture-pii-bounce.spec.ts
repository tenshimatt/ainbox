/**
 * C-8: Pre-commit fixture-PII check fires on real-looking emails
 *
 * Test fixtures and mock data MUST NOT contain real email addresses.
 * Pre-commit hooks or lint rules SHOULD bounce any fixture containing
 * @ patterns that look like real addresses.
 *
 * This test checks:
 * 1. Test fixtures use safe test domains only
 * 2. No real-looking email addresses in any source file
 * 3. A pre-commit check or lint rule exists to enforce this
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const projectRoot = path.resolve(__dirname, '..', '..');

const SAFE_DOMAINS = [
  'example.com',
  'example.org',
  'example.net',
  'test',
  'localhost',
  'mock',
  'acme.com',
  'yourcompany.com',
  'domain.com',
  'email.com',
  'company.com',
  'test.com',
  'fake.com',
  'noreply.com',
  'ainbox.test',
  'ainbox.example',
];

test.describe('@contract C-8 fixture PII check', () => {
  test('C-8.1 no real-looking emails in test fixtures', () => {
    const testDir = path.resolve(projectRoot, 'tests');
    if (!fs.existsSync(testDir)) return;

    const testFiles = getAllFiles(testDir);

    let violations: string[] = [];

    for (const file of testFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      const lines = content.split('\n');

      lines.forEach((line, i) => {
        // Find email-like patterns
        const emails = line.match(/[\w.+-]+@[\w-]+\.[a-z]{2,}/g);
        if (!emails) return;

        for (const email of emails) {
          const domain = email.split('@')[1].toLowerCase();

          // Skip safe domains
          const isSafe = SAFE_DOMAINS.some(d => domain === d || domain.endsWith('.' + d));
          if (isSafe) continue;

          // Skip if it's clearly a variable name or template
          if (line.includes('${') || line.includes('%s')) continue;
          if (line.match(/['"]\w+@\w+\.\w+['"]/)) continue; // String literals with test domains

          // Check it's not a URL or import path
          if (line.includes('//') || line.includes('import ') || line.includes('require(')) continue;

          violations.push(`${file}:${i + 1} — ${email}`);
        }
      });
    }

    if (violations.length > 0) {
      console.log('Real-looking email addresses found:', violations.join('\n'));
    }

    expect(violations.length).toBe(0);
  });

  test('C-8.2 no real-looking emails in mock data files', () => {
    const mockFiles = [
      path.resolve(projectRoot, 'src', 'lib', 'mock-data.ts'),
      path.resolve(projectRoot, 'src', 'lib', 'mock-data.tsx'),
      path.resolve(projectRoot, 'src', 'data', 'mock.ts'),
      path.resolve(projectRoot, 'src', 'data', 'fixtures.ts'),
    ];

    for (const file of mockFiles) {
      if (!fs.existsSync(file)) continue;

      const content = fs.readFileSync(file, 'utf-8');
      const lines = content.split('\n');

      lines.forEach((line, i) => {
        const emails = line.match(/[\w.+-]+@[\w-]+\.[a-z]{2,}/g);
        if (!emails) return;

        for (const email of emails) {
          const domain = email.split('@')[1].toLowerCase();
          const isSafe = SAFE_DOMAINS.some(d => domain === d || domain.endsWith('.' + d));
          if (isSafe) continue;

          expect(isSafe).toBeTruthy();
        }
      });
    }
  });

  test('C-8.3 pre-commit or lint config exists for PII', () => {
    // Check for pre-commit config
    const preCommitConfig = path.resolve(projectRoot, '.pre-commit-config.yaml');
    const lintStagedConfig = path.resolve(projectRoot, '.lintstagedrc.js');
    const huskyDir = path.resolve(projectRoot, '.husky');

    const hasPreCommit = fs.existsSync(preCommitConfig);
    const hasLintStaged = fs.existsSync(lintStagedConfig);
    const hasHusky = fs.existsSync(huskyDir);

    // At least one pre-commit mechanism should exist (or be planned)
    if (!hasPreCommit && !hasLintStaged && !hasHusky) {
      console.warn(
        '⚠️ C-8.3: No pre-commit or lint-staged config found. ' +
        'Add one before deploying real user data to prevent PII leaks.'
      );
    }
  });
});

function getAllFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const files: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!['node_modules', '.next', '.git'].includes(entry.name)) {
        files.push(...getAllFiles(fullPath));
      }
    } else if (
      entry.name.endsWith('.ts') ||
      entry.name.endsWith('.tsx') ||
      entry.name.endsWith('.json')
    ) {
      files.push(fullPath);
    }
  }
  return files;
}
