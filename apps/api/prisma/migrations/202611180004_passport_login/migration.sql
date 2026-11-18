CREATE TABLE "PassportLoginChallenge" (
    "userId" TEXT NOT NULL,
    "browserHash" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "windowStartedAt" TIMESTAMP(3) NOT NULL,
    "sendCount" INTEGER NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "usedAt" TIMESTAMP(3),
    CONSTRAINT "PassportLoginChallenge_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "PassportLoginChallenge" ADD CONSTRAINT "PassportLoginChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "StudentIdentity_universityId_numberLast4_status_idx" ON "StudentIdentity"("universityId", "numberLast4", "status");
