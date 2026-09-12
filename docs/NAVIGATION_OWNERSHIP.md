# Navigation ownership map

The authenticated primary navigation is defined in `shared/navigation.ts` and contains exactly five destinations.

| Primary destination | Canonical route | Owned routes and workflows |
| --- | --- | --- |
| Dashboard | `/` | Portfolio overview and starting state only |
| Cases | `/cases` | Cases, debtors, add-case, reminders, evidence, legal documents and document exports |
| Payments | `/payments` | Payment history, recording, access requests, proof review and receiving-account flows |
| Action Centre | `/actions` | Prioritised actions, operations and notifications |
| Reports | `/reports` | Reports, exports and statements |

Secondary navigation is presented through `/more` and the Settings page. Existing route URLs remain valid; this change removes duplicate menu ownership rather than deleting or renaming functional modules.

Direct-page permissions are checked in `src/proxy.ts` for privileged page routes. APIs continue to enforce their own permissions independently; menu visibility is not treated as an authorization boundary.

Rollback: revert the shared navigation file and the consuming shell changes. No database or URL migration is involved.
