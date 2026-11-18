CREATE TABLE "StudentAccountRecovery" (
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StudentAccountRecovery_pkey" PRIMARY KEY ("userId")
);

CREATE UNIQUE INDEX "StudentAccountRecovery_tokenHash_key" ON "StudentAccountRecovery"("tokenHash");

ALTER TABLE "StudentAccountRecovery" ADD CONSTRAINT "StudentAccountRecovery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
