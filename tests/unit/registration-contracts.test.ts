import { describe, expect, it } from 'vitest';

import {
  MAIN_RULES_VERSION,
  readRegistrationChoiceRequest,
  readRegistrationMetadata,
  registrationMetadata,
} from '../../shared/registration-contracts';

describe('registration contracts', () => {
  it('normalizes the shared Main and Pocket registration metadata', () => {
    const metadata = registrationMetadata({
      fullName: '  Aisyah   Rahman  ',
      accountName: '  Aisyah Trading  ',
      phone: ' +60 12 345 6789 ',
      product: 'pocket',
    });

    expect(metadata).toMatchObject({
      collectboss_registration_version: 2,
      collectboss_product: 'pocket',
      full_name: 'Aisyah Rahman',
      business_name: 'Aisyah Trading',
      phone: '+60 12 345 6789',
    });
    expect(readRegistrationMetadata(metadata)).toEqual({
      fullName: 'Aisyah Rahman',
      accountName: 'Aisyah Trading',
      phone: '+60 12 345 6789',
      product: 'pocket',
      registrationVersion: 2,
      mainRulesAcceptance: null,
    });
  });

  it('requires a versioned rules acceptance for new Main registrations', () => {
    const acceptedAt = '2026-08-24T02:00:00.000Z';
    const details = {
      fullName: 'Aisyah Rahman',
      accountName: 'Aisyah Trading',
      phone: '+60123456789',
      product: 'main' as const,
    };
    expect(readRegistrationMetadata(registrationMetadata(details))).toBeNull();
    expect(readRegistrationMetadata(registrationMetadata(details, {
      version: MAIN_RULES_VERSION,
      acceptedAt,
    }))).toMatchObject({
      ...details,
      registrationVersion: 2,
      mainRulesAcceptance: { version: MAIN_RULES_VERSION, acceptedAt },
    });
  });

  it('accepts a Main product choice only after the explicit rules tick', () => {
    const choice = {
      fullName: 'Aisyah Rahman',
      accountName: 'Aisyah Trading',
      phone: '+60123456789',
      product: 'main',
      mainRulesVersion: MAIN_RULES_VERSION,
      mainRulesAccepted: true,
    };
    expect(readRegistrationChoiceRequest(choice)).toEqual(choice);
    expect(readRegistrationChoiceRequest({ ...choice, mainRulesAccepted: false })).toBeNull();
  });

  it('rejects unversioned, malformed, and unsupported registration metadata', () => {
    expect(readRegistrationMetadata({ full_name: 'Aisyah Rahman' })).toBeNull();
    expect(readRegistrationMetadata(registrationMetadata({
      fullName: 'Aisyah Rahman',
      accountName: 'Aisyah Trading',
      phone: 'not-a-phone',
      product: 'pocket',
    }))).toBeNull();
    expect(readRegistrationMetadata({
      ...registrationMetadata({
        fullName: 'Aisyah Rahman',
        accountName: 'Aisyah Trading',
        phone: '+60123456789',
        product: 'pocket',
      }),
      collectboss_product: 'admin',
    })).toBeNull();
  });
});
