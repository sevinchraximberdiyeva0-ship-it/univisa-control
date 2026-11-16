ALTER TABLE "University" ADD COLUMN "overdueOffsets" INTEGER[] NOT NULL DEFAULT ARRAY[1,3,7,14,30]::INTEGER[];
ALTER TABLE "NotificationJob"
 ADD COLUMN "provider" TEXT,
 ADD COLUMN "retryCount" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "queueFailures" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "lastErrorCode" TEXT,
 ADD COLUMN "deliveredAt" TIMESTAMP(3),
 ADD COLUMN "providerStatusAt" TIMESTAMP(3),
 ADD COLUMN "nextReceiptAt" TIMESTAMP(3),
 ADD COLUMN "receiptChecks" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "messageEncrypted" TEXT,
 ADD COLUMN "deliveryDate" TEXT;
CREATE INDEX "NotificationJob_provider_state_nextReceiptAt_idx" ON "NotificationJob"("provider","state","nextReceiptAt");
CREATE INDEX "NotificationJob_universityId_provider_providerMessageId_idx" ON "NotificationJob"("universityId","provider","providerMessageId");
CREATE UNIQUE INDEX "NotificationJob_delivery_day_key" ON "NotificationJob"("documentId","version","kind","channel","deliveryDate");
UPDATE "NotificationJob" j SET "retryCount"=(SELECT count(*) FROM "NotificationAttempt" a WHERE a."jobId"=j.id AND a."errorCode"='TEMPORARY');
CREATE TABLE "TelegramResponse" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "updateId" BIGINT NOT NULL,
 "payloadEncrypted" TEXT NOT NULL,
 "state" "DeliveryState" NOT NULL DEFAULT 'PENDING',
 "attempts" INTEGER NOT NULL DEFAULT 0,
 "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "sendingAt" TIMESTAMP(3),
 "lastErrorCode" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "TelegramResponse_updateId_key" ON "TelegramResponse"("updateId");
CREATE INDEX "TelegramResponse_state_scheduledAt_idx" ON "TelegramResponse"("state","scheduledAt");
CREATE TABLE "WorkerHeartbeat" ("id" TEXT NOT NULL PRIMARY KEY,"updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"lastSuccessAt" TIMESTAMP(3));
