-- CreateEnum
CREATE TYPE "HandshakeStatus" AS ENUM ('PENDING', 'ESTABLISHED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "CommDirection" AS ENUM ('ADMIN_TO_ARCHITECT', 'ARCHITECT_TO_ADMIN');

-- CreateEnum
CREATE TYPE "TokenRequestStatus" AS ENUM ('PENDING', 'FULFILLED', 'REJECTED');

-- CreateTable
CREATE TABLE "api_request_logs" (
    "id" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "ip" TEXT,
    "userId" TEXT,
    "requestBody" TEXT,
    "responseBody" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_request_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "architect_handshakes" (
    "id" TEXT NOT NULL,
    "architectId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "secretHash" TEXT NOT NULL,
    "secretPrefix" TEXT NOT NULL,
    "credentialExpiresAt" TIMESTAMP(3) NOT NULL,
    "status" "HandshakeStatus" NOT NULL DEFAULT 'PENDING',
    "architectValidatedAt" TIMESTAMP(3),
    "establishedAt" TIMESTAMP(3),
    "lastValidatedIp" TEXT,
    "createdById" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "architect_handshakes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_tokens" (
    "id" TEXT NOT NULL,
    "handshakeId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "fromRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "token_requests" (
    "id" TEXT NOT NULL,
    "handshakeId" TEXT NOT NULL,
    "reason" TEXT,
    "status" "TokenRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requestedIp" TEXT,
    "resolvedById" TEXT,
    "issuedTokenId" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "token_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_logs" (
    "id" TEXT NOT NULL,
    "handshakeId" TEXT,
    "direction" "CommDirection" NOT NULL,
    "event" TEXT NOT NULL,
    "statusCode" INTEGER,
    "detail" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "communication_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "api_request_logs_userId_idx" ON "api_request_logs"("userId");

-- CreateIndex
CREATE INDEX "api_request_logs_endpoint_idx" ON "api_request_logs"("endpoint");

-- CreateIndex
CREATE UNIQUE INDEX "architect_handshakes_clientId_key" ON "architect_handshakes"("clientId");

-- CreateIndex
CREATE INDEX "architect_handshakes_architectId_idx" ON "architect_handshakes"("architectId");

-- CreateIndex
CREATE INDEX "architect_handshakes_status_idx" ON "architect_handshakes"("status");

-- CreateIndex
CREATE UNIQUE INDEX "integration_tokens_tokenHash_key" ON "integration_tokens"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "integration_tokens_fromRequestId_key" ON "integration_tokens"("fromRequestId");

-- CreateIndex
CREATE INDEX "integration_tokens_handshakeId_idx" ON "integration_tokens"("handshakeId");

-- CreateIndex
CREATE INDEX "token_requests_handshakeId_idx" ON "token_requests"("handshakeId");

-- CreateIndex
CREATE INDEX "token_requests_status_idx" ON "token_requests"("status");

-- CreateIndex
CREATE INDEX "communication_logs_handshakeId_idx" ON "communication_logs"("handshakeId");

-- CreateIndex
CREATE INDEX "communication_logs_event_idx" ON "communication_logs"("event");

-- AddForeignKey
ALTER TABLE "architect_handshakes" ADD CONSTRAINT "architect_handshakes_architectId_fkey" FOREIGN KEY ("architectId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_tokens" ADD CONSTRAINT "integration_tokens_handshakeId_fkey" FOREIGN KEY ("handshakeId") REFERENCES "architect_handshakes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "token_requests" ADD CONSTRAINT "token_requests_handshakeId_fkey" FOREIGN KEY ("handshakeId") REFERENCES "architect_handshakes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_logs" ADD CONSTRAINT "communication_logs_handshakeId_fkey" FOREIGN KEY ("handshakeId") REFERENCES "architect_handshakes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

