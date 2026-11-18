ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3),
ADD COLUMN "emailVerificationRequired" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "EmailVerification" (
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "windowStartedAt" TIMESTAMP(3) NOT NULL,
    "sendCount" INTEGER NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "EmailVerification_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "EmailVerification" ADD CONSTRAINT "EmailVerification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
