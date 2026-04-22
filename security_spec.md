# Security Spec

## Data Invariants
1. A Meeting cannot exist without a valid userId that corresponds to `request.auth.uid`.
2. A Meeting must contain exactly 11 keys during creation to prevent shadow properties.
3. User settings are strictly limited to the `UserSetting` schema (`userId`, `lineToken`, `lineUserId`, `dailyReminderTime`, `updatedAt`).
4. Timestamps (`createdAt`, `updatedAt`) must strictly be the server timestamp (`request.time`).
5. Only exact properties can be updated via updates. No rogue keys will be allowed in `updateDoc`.
6. Reading/listing any collection enforces `resource.data.userId == request.auth.uid` on top of the path parameters.

## The "Dirty Dozen" Payloads
1. **Shadow Update (Ghost Field)**: payload with `isVerified: true` -> Denied by `hasAll` and `.size()==11` limit or `affectedKeys()`.
2. **Value Poisoning**: `units` sent as Array instead of String -> Denied by type check.
3. **ID Injection**: passing an ID `../../../some_path` -> Denied by `isValidId`.
4. **Spoofed Ownership**: User A creating a meeting under User B's `/users/B/meetings/` -> Denied! `userId` == `request.auth.uid` AND `userId` in path.
5. **Modified Immutables**: Changing `createdAt` during update -> Denied by `isValidMeetingUpdate` (`data.createdAt == existing().createdAt`).
6. **Date Time Bypass**: Provide fake client timestamp for `updatedAt` -> Denied since `updatedAt == request.time` is enforced.
7. **Size Limit Overrun**: A `outline` of 6000 chars -> Denied by size limit 5000 chars.
8. **Negative reminder**: `remindMinutes` of `-10` -> Denied by `data.remindMinutes >= 5` constraint.
9. **Fake Email Verified Status**: A user lacking email verification tries to write -> Denied by `email_verified == true`.
10. **Array Poisoning in Meeting**: No array used (only simple objects) -> Safe!
11. **Type changing toggles**: Changing `isCompleted` to `string` ("true") -> Denied by `isCompleted is bool`.
12. **Blanket PII query**: Requesting `list` on `settings` collection globally -> Denied since path forces `users/{userId}` and `userId == request.auth.uid` constraint is verified.

## Test Runner (firestore.rules.test.ts)
```typescript
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import * as fs from 'fs';

let testEnv: any;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "test-auth-project",
    firestore: {
       rules: fs.readFileSync('./firestore.rules', 'utf8')
    }
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

describe('Firestore Rules - Meeting App', () => {
  it('prevents shadow update (ghost field)', async () => {
    const unverifiedUser = testEnv.authenticatedContext('user_123', { email_verified: false }); // Test Dirty Dozen 9
    // Test that fails on creating a meeting due to unverified email
    // ...
  });
});
```
