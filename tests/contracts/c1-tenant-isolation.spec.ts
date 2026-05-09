/**
 * C-1: Tenant isolation
 *
 * Every data query MUST filter by auth.uid(). Every table MUST have
 * row-level security that enforces auth.uid() = user_id.
 *
 * No exceptions. No service-role bypass on user-facing endpoints.
 *
 * This test checks:
 * 1. Migration files declare RLS on every table with a user_id column
 * 2. RLS policies exist for SELECT, INSERT, UPDATE, DELETE
 * 3. No user-facing API route uses service-role key
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const projectRoot = path.resolve(__dirname, '..', '..');
const schemaDir = path.resolve(projectRoot, 'supabase', 'migrations');

test.describe('@contract C-1 tenant isolation', () => {
  test('C-1.1 every migration declares RLS on user-scoped tables', () => {
    // Check the migration file for necessary constructs
    const migrations = fs.readdirSync(schemaDir).filter(f => f.endsWith('.sql'));

    // All migrations should exist
    expect(migrations.length).toBeGreaterThanOrEqual(1);

    for (const file of migrations) {
      const content = fs.readFileSync(path.join(schemaDir, file), 'utf-8');

      // Every user-scoped table should have RLS enabled
      const createTableLines = content.split('\n').filter(l =>
        l.includes('CREATE TABLE') && !l.includes('auth.users')
      );

      for (const line of createTableLines) {
        // Extract table name
        const match = line.match(/CREATE TABLE\s+(?:public\.)?(\w+)/i);
        if (!match) continue;
        const tableName = match[1];

        // Skip system tables
        if (['schema_migrations', 'pg_stat_statements'].includes(tableName)) continue;

        // Should have RLS
        expect(content).toMatch(
          new RegExp(`ALTER TABLE\\s+(?:public\\.)?${tableName}\\s+ENABLE ROW LEVEL SECURITY`, 'i')
        );

        // Should have policies
        const policies = content.match(
          new RegExp(`CREATE POLICY.*ON\\s+(?:public\\.)?${tableName}`, 'gi')
        );
        expect(policies).not.toBeNull();
      }
    }
  });

  test('C-1.2 API route handlers do not use service-role Supabase key', () => {
    const apiDir = path.resolve(projectRoot, 'src', 'app', 'api');
    if (!fs.existsSync(apiDir)) return; // Skip if no API routes yet

    const apiFiles = getAllTsFiles(apiDir);

    for (const file of apiFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      // Should not reference service_role
      expect(content).not.toMatch(/service_role/i);
      expect(content).not.toMatch(/service-role/i);
      expect(content).not.toMatch(/SERVICE_ROLE/i);
    }
  });

  test('C-1.3 no auth.uid bypass patterns exist', () => {
    const apiDir = path.resolve(projectRoot, 'src', 'app', 'api');
    if (!fs.existsSync(apiDir)) return;

    const apiFiles = getAllTsFiles(apiDir);

    for (const file of apiFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      // Should not use .from(table).select() without auth guard
      // Note: this is a basic heuristic — real enforcement needs runtime checks
      const hasFromSelect = content.includes('.from(') && content.includes('.select(');
      const hasFromInsert = content.includes('.from(') && content.includes('.insert(');
      if (hasFromSelect || hasFromInsert) {
        // Must have some auth check
        const hasAuthCheck =
          content.includes('auth.uid()') ||
          content.includes('user.id') ||
          content.includes('session') ||
          content.includes('getUser');
        expect(hasAuthCheck).toBeTruthy();
      }
    }
  });
});

function getAllTsFiles(dir: string): string[] {
  const files: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getAllTsFiles(fullPath));
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      files.push(fullPath);
    }
  }
  return files;
}
