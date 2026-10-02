# Security Specification for Mostawdaee Smart System

## Data Invariants
1. A user can only access their own slice of data (Row Level Security).
2. All documents resides under `/users/{userId}/...` where `userId` matches `request.auth.uid`.
3. Inventory items must have positive quantity and costs.
4. Vault transactions must ensure the calculated balance is consistent (though rule-side balance calculation is complex, we'll enforce schema and ownership).
5. Timestamps (`dateAdded`, `date`, `timestamp`, `hiredDate`) should ideally be validated, but we'll focus on ownership and schema integrity.

## The Dirty Dozen Payloads (Rejection Targets)
1. **P1: Cross-User Read** - Authenticated user A tries to read `/users/UserB/inventory/item1`.
2. **P2: Cross-User Write** - Authenticated user A tries to create `/users/UserB/inventory/item1`.
3. **P3: Unauthenticated Read** - Non-logged in user tries to read any setting or inventory.
4. **P4: Schema Poisoning** - Updating a product with `quantity: "a lot"` (string instead of number).
5. **P5: Missing Required Fields** - Creating a product without a `sku`.
6. **P6: Invalid Status** - Setting product status to `Exploded` (not in enum).
7. **P7: ID Injection** - Using a 2MB string as a product ID in the path.
8. **P8: Unauthorized Settings Update** - User A tries to change User B's business name.
9. **P9: Negative Salary** - Creating an employee with `salary: -1000`.
10. **P10: Spoofed UID** - User A creates a document in their own collection but sets an `ownerId` field (if any) to User B (integrity check).
11. **P11: Bypassing Enum** - Setting `defaultLanguage` to `fr` in user settings.
12. **P12: Giant Payload** - Sending a 2MB description field to exhaust storage.

## Test Runner Plan
I will generate `firestore.rules` that prevent these attacks using:
- `request.auth.uid == userId` checks.
- `isValid[Entity]` helpers for type and schema validation.
- `matches` and `size()` checks for strings and IDs.
