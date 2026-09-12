import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('CollectBoss registration integration', () => {
  it('creates the shared login before product selection in web and Expo', () => {
    const web = read('src/components/pages/auth/signup-page.tsx');
    const mobile = read('mobile/src/components/auth-screen.tsx');
    const provider = read('mobile/src/providers/auth-provider.tsx');

    for (const source of [web, mobile]) {
      expect(source).toMatch(/Email|email/);
      expect(source).toMatch(/Password|password/);
      expect(source).toMatch(/Confirm [Pp]assword/);
      expect(source).toContain('choose');
    }
    expect(web).toContain('router.push("/choose-product")');
    expect(read('src/components/layout/profile-guard.tsx')).toContain('"/choose-product"');
    expect(read('src/components/pages/auth/product-selection-page.tsx')).toContain('product === "main" ? "/onboarding/profile" : "/pocket"');
    expect(provider).toContain('needsConfirmation');
    expect(provider).toContain('prepareRegisteredWorkspace');
    expect(read('mobile/src/components/product-gate.tsx')).toContain('resolveProduct(true)');
  });

  it('requires Main rules acceptance during the product-selection step', () => {
    const web = read('src/components/pages/auth/product-selection-page.tsx');
    const mobile = read('mobile/src/components/product-selection-screen.tsx');
    const route = read('src/app/api/workspace/provision/route.ts');

    for (const source of [web, mobile]) {
      expect(source).toContain('CollectBoss Pocket');
      expect(source).toMatch(/Full name|Full Name/);
      expect(source).toMatch(/Business or [Aa]ccount [Nn]ame/);
      expect(source).toMatch(/Phone [Nn]umber/);
      expect(source).toContain('MAIN_COLLECTBOSS_RULES');
      expect(source).toMatch(/rulesAccepted/);
      expect(source).toMatch(/Agree and [Cc]ontinue/);
    }
    expect(route).toContain('readRegistrationChoiceRequest');
    expect(route).toContain('registration.main_rules_accepted');
    expect(route).toContain('app_metadata');
  });

  it('provisions only a bearer-authenticated, versioned registration', () => {
    const route = read('src/app/api/workspace/provision/route.ts');
    const provisioner = read('src/lib/workspace/registration.ts');
    const proxy = read('src/proxy.ts');

    expect(route).toContain('client.auth.getUser(token)');
    expect(route).toContain('provisionRegisteredWorkspace');
    expect(provisioner).toContain('readUserRegistration(user)');
    expect(provisioner).toContain('.eq("owner_id", user.id)');
    expect(provisioner).toContain('workspace_product_states');
    expect(provisioner).toContain('getServiceClient()');
    expect(provisioner).not.toMatch(/service_role_key/i);
    expect(proxy).toContain('"/api/workspace/provision"');
  });
});
