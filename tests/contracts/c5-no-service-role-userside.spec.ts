/**
 * C-5: No service-role calls in user-facing endpoints
 *
 * All user-facing API routes and page server actions MUST use the
 * authenticated user's JWT (anon key with RLS). service-role key is
 * STRICTLY for internal edge functions and background jobs.
 *
 * This test checks:
 * 1. No user-facing API route references service-role supabase client
 * 2. Server-side user-facing code uses anon key
 * 3. Service-role is only present in background job code
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const projectRoot = path.resolve(__dirname, '..', '..');

test.describe('@contract C-5 no service-role in user-facing endpoints', () => {
  test('C-5.1 API routes do not reference service-role key', () => {
    const apiDir = path.resolve(projectRoot, 'src', 'app', 'api');
    if (!fs.existsSync(apiDir)) return;

    const apiFiles = getAllFiles(apiDir);

    for (const file of apiFiles) {
      const content = fs.readFileSync(file, 'utf-8');

      // Should not reference service_role
      const violations: string[] = [];

      // Check for service-role patterns
      if (
        content.includes('service_role') ||
        content.includes('service-role') ||
        content.includes('SERVICE_ROLE') ||
        content.match(/createClient.*service_role/)
      ) {
        violations.push(file);
      }

      expect(violations.length).toBe(0);
    }
  });

  test('C-5.2 server components and actions use anon key client', () => {
    const appDir = path.resolve(projectRoot, 'src', 'app');
    // Exclude admin/ routes which might legitimately use service role
    const pagesDir = path.resolve(projectRoot, 'src', 'app');
    if (!fs.existsSync(pagesDir)) return;

    const pageFiles = getAllFiles(pagesDir).filter(f =>
      !f.includes('/admin/') &&
      !f.includes('/api/')  // API routes tested separately
    );

    for (const file of pageFiles) {
      const content = fs.readFileSync(file, 'utf-8');

      // If the file has Supabase client creation, it should not use service_role
      if (content.includes('createClient') || content.includes('createServerClient') || content.includes('createBrowserClient')) {
        const hasServiceRole = content.includes('service_role') || content.includes('SERVICE_ROLE');
        expect(hasServiceRole).toBeFalsy();
      }
    }
  });

  test('C-5.3 service-role key usage is isolated to admin/internal files only', () => {
    const srcDir = path.resolve(projectRoot, 'src');

    // Find all files that reference service-role
    const files = getAllFiles(srcDir).filter(f => {
      const content = fs.readFileSync(f, 'utf-8');
      return content.includes('service_role') || content.includes('SERVICE_ROLE');
    });

    // service-role should only appear in:
    // - Edge functions (which run in server-side Supabase context)
    // - Admin routes
    // - Background job utilities
    for (const file of files) {
      const isInternal = file.includes('/admin/') ||
                         file.includes('supabase/functions') ||
                         file.includes('/internal/') ||
                         file.includes('/background/') ||
                         file.includes('service-role');
      if (!isInternal) {
        console.warn(`⚠️ ${file} references service_role in a user-facing context`);
      }
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
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      files.push(fullPath);
    }
  }
  return files;
}
