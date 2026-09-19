-- Endpoint URLs delivered alongside the tokens so the architect can copy them
-- straight from the dashboard message.
ALTER TABLE "token_deliveries" ADD COLUMN "endpoints" JSONB;
