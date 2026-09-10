-- Administrator-issued password resets.
-- must_change_password forces the next password login through a reset instead
-- of issuing a session; password_changed_at is the "last changed" read-out the
-- platform user directory shows next to it.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "passwordChangedAt" TIMESTAMP(3);
