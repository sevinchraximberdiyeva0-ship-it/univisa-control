-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'UNIVERSITY_ADMIN', 'INTERNATIONAL_OFFICE', 'FACULTY_COORDINATOR', 'STUDENT', 'AUDITOR');

-- CreateEnum
CREATE TYPE "ReviewState" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED', 'NEEDS_CORRECTION');

-- CreateEnum
CREATE TYPE "DeliveryState" AS ENUM ('PENDING', 'SENDING', 'ACCEPTED', 'DELIVERED', 'FAILED', 'UNKNOWN', 'CANCELED', 'UNAVAILABLE', 'MOCK');

-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('SMS', 'TELEGRAM', 'IN_APP');

-- CreateTable
CREATE TABLE "University" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Tashkent',
    "deliveryStart" INTEGER NOT NULL DEFAULT 9,
    "deliveryEnd" INTEGER NOT NULL DEFAULT 18,
    "legalApprovedAt" TIMESTAMP(3),
    "legalApprovedBy" TEXT,
    "contactEmail" TEXT NOT NULL,
    "retentionDays" INTEGER NOT NULL DEFAULT 365,
    "reminderRevision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "University_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "facultyId" TEXT,
    "mfaSecret" TEXT,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "lastTotpStep" BIGINT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "csrfHash" TEXT NOT NULL,
    "mfaVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Faculty" (
    "id" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Faculty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Student" (
    "id" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "userId" TEXT,
    "studentNumber" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "facultyId" TEXT NOT NULL,
    "program" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "group" TEXT NOT NULL,
    "nationality" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "email" TEXT NOT NULL,
    "phoneEncrypted" TEXT,
    "phoneVerifiedAt" TIMESTAMP(3),
    "officerId" TEXT,
    "enrollmentStatus" TEXT NOT NULL DEFAULT 'ACTIVE',
    "smsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "telegramEnabled" BOOLEAN NOT NULL DEFAULT true,
    "consentAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Student_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentDocument" (
    "id" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "activeVersion" INTEGER NOT NULL DEFAULT 1,
    "issueDate" DATE NOT NULL,
    "expirationDate" DATE NOT NULL,
    "officerId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentVersion" (
    "id" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "issueDate" DATE NOT NULL,
    "expirationDate" DATE NOT NULL,
    "fileId" TEXT,
    "verifiedBy" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,

    CONSTRAINT "DocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RenewalApplication" (
    "id" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "baseVersion" INTEGER NOT NULL,
    "issueDate" DATE NOT NULL,
    "expirationDate" DATE NOT NULL,
    "fileId" TEXT NOT NULL,
    "state" "ReviewState" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "submittedBy" TEXT NOT NULL,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RenewalApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentVerification" (
    "id" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "state" "ReviewState" NOT NULL,
    "notes" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrivateFile" (
    "id" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrivateFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationRule" (
    "id" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "daysRemaining" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "escalate" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "NotificationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationJob" (
    "id" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'REMINDER',
    "channel" "Channel" NOT NULL,
    "scheduledDate" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "state" "DeliveryState" NOT NULL DEFAULT 'PENDING',
    "providerMessageId" TEXT,
    "sendingAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationAttempt" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "state" "DeliveryState" NOT NULL,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationTemplate" (
    "id" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "body" TEXT NOT NULL,

    CONSTRAINT "NotificationTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramConnection" (
    "id" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "blocked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "TelegramConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramLinkToken" (
    "hash" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "TelegramLinkToken_pkey" PRIMARY KEY ("hash")
);

-- CreateTable
CREATE TABLE "TelegramUpdate" (
    "id" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelegramUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmsProviderConfiguration" (
    "id" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'mock',
    "credentialsEncrypted" TEXT,
    "monthlyQuota" INTEGER NOT NULL DEFAULT 1000,
    "unitCost" DECIMAL(12,4) NOT NULL DEFAULT 0,

    CONSTRAINT "SmsProviderConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffAssignment" (
    "id" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "facultyId" TEXT NOT NULL,

    CONSTRAINT "StaffAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffTask" (
    "id" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "studentId" TEXT,
    "assignedTo" TEXT,
    "reason" TEXT NOT NULL,
    "deduplicationKey" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "id" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "resource" TEXT NOT NULL,
    "action" TEXT NOT NULL,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "University_slug_key" ON "University"("slug");

-- CreateIndex
CREATE INDEX "User_universityId_role_idx" ON "User"("universityId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "User_universityId_email_key" ON "User"("universityId", "email");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Faculty_id_universityId_key" ON "Faculty"("id", "universityId");

-- CreateIndex
CREATE UNIQUE INDEX "Faculty_universityId_name_key" ON "Faculty"("universityId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Student_userId_key" ON "Student"("userId");

-- CreateIndex
CREATE INDEX "Student_universityId_facultyId_archivedAt_idx" ON "Student"("universityId", "facultyId", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Student_universityId_studentNumber_key" ON "Student"("universityId", "studentNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Student_universityId_email_key" ON "Student"("universityId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "Student_id_universityId_key" ON "Student"("id", "universityId");

-- CreateIndex
CREATE INDEX "StudentDocument_universityId_expirationDate_idx" ON "StudentDocument"("universityId", "expirationDate");

-- CreateIndex
CREATE UNIQUE INDEX "StudentDocument_id_universityId_key" ON "StudentDocument"("id", "universityId");

-- CreateIndex
CREATE INDEX "DocumentVersion_universityId_documentId_idx" ON "DocumentVersion"("universityId", "documentId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentVersion_documentId_version_key" ON "DocumentVersion"("documentId", "version");

-- CreateIndex
CREATE INDEX "RenewalApplication_universityId_state_idx" ON "RenewalApplication"("universityId", "state");

-- CreateIndex
CREATE INDEX "DocumentVerification_universityId_applicationId_idx" ON "DocumentVerification"("universityId", "applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "PrivateFile_storageKey_key" ON "PrivateFile"("storageKey");

-- CreateIndex
CREATE INDEX "PrivateFile_universityId_studentId_idx" ON "PrivateFile"("universityId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationRule_universityId_daysRemaining_key" ON "NotificationRule"("universityId", "daysRemaining");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationJob_idempotencyKey_key" ON "NotificationJob"("idempotencyKey");

-- CreateIndex
CREATE INDEX "NotificationJob_state_scheduledAt_idx" ON "NotificationJob"("state", "scheduledAt");

-- CreateIndex
CREATE INDEX "NotificationJob_universityId_studentId_idx" ON "NotificationJob"("universityId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationTemplate_universityId_language_kind_key" ON "NotificationTemplate"("universityId", "language", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramConnection_studentId_key" ON "TelegramConnection"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramConnection_chatId_key" ON "TelegramConnection"("chatId");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramConnection_studentId_universityId_key" ON "TelegramConnection"("studentId", "universityId");

-- CreateIndex
CREATE UNIQUE INDEX "SmsProviderConfiguration_universityId_key" ON "SmsProviderConfiguration"("universityId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffAssignment_universityId_userId_facultyId_key" ON "StaffAssignment"("universityId", "userId", "facultyId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffTask_deduplicationKey_key" ON "StaffTask"("deduplicationKey");

-- CreateIndex
CREATE INDEX "StaffTask_universityId_resolvedAt_idx" ON "StaffTask"("universityId", "resolvedAt");

-- CreateIndex
CREATE INDEX "AuditLog_universityId_createdAt_idx" ON "AuditLog"("universityId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SystemSetting_universityId_key_key" ON "SystemSetting"("universityId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_role_resource_action_key" ON "Permission"("role", "resource", "action");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_universityId_fkey" FOREIGN KEY ("universityId") REFERENCES "University"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Faculty" ADD CONSTRAINT "Faculty_universityId_fkey" FOREIGN KEY ("universityId") REFERENCES "University"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_universityId_fkey" FOREIGN KEY ("universityId") REFERENCES "University"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_facultyId_universityId_fkey" FOREIGN KEY ("facultyId", "universityId") REFERENCES "Faculty"("id", "universityId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentDocument" ADD CONSTRAINT "StudentDocument_studentId_universityId_fkey" FOREIGN KEY ("studentId", "universityId") REFERENCES "Student"("id", "universityId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_documentId_universityId_fkey" FOREIGN KEY ("documentId", "universityId") REFERENCES "StudentDocument"("id", "universityId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RenewalApplication" ADD CONSTRAINT "RenewalApplication_documentId_universityId_fkey" FOREIGN KEY ("documentId", "universityId") REFERENCES "StudentDocument"("id", "universityId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationAttempt" ADD CONSTRAINT "NotificationAttempt_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "NotificationJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramConnection" ADD CONSTRAINT "TelegramConnection_studentId_universityId_fkey" FOREIGN KEY ("studentId", "universityId") REFERENCES "Student"("id", "universityId") ON DELETE RESTRICT ON UPDATE CASCADE;
