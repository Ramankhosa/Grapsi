-- Multi-provider social login: one row per (user, provider) link.
CREATE TABLE "user_oauth_accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" "OAuthProvider" NOT NULL,
    "provider_user_id" TEXT NOT NULL,
    "email" TEXT,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "profile" JSONB,
    "linked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_oauth_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_oauth_accounts_provider_provider_user_id_key"
    ON "user_oauth_accounts"("provider", "provider_user_id");

CREATE UNIQUE INDEX "user_oauth_accounts_user_id_provider_key"
    ON "user_oauth_accounts"("user_id", "provider");

CREATE INDEX "user_oauth_accounts_user_id_idx" ON "user_oauth_accounts"("user_id");

ALTER TABLE "user_oauth_accounts"
    ADD CONSTRAINT "user_oauth_accounts_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill the existing single-provider links onto the new table.
INSERT INTO "user_oauth_accounts" (
    "id", "user_id", "provider", "provider_user_id",
    "email", "email_verified", "profile", "linked_at", "created_at", "updated_at"
)
SELECT
    md5(random()::text || clock_timestamp()::text),
    u."id",
    u."oauthProvider",
    u."oauthProviderId",
    u."email",
    u."emailVerified",
    u."oauthProfile",
    u."createdAt",
    u."createdAt",
    CURRENT_TIMESTAMP
FROM "users" u
WHERE u."oauthProvider" IS NOT NULL
  AND u."oauthProviderId" IS NOT NULL
ON CONFLICT DO NOTHING;
