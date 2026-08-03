-- Attribute outbound messages to the team member who sent them.
-- Additive: one nullable column. A NULL on an OUTBOUND row means the bot
-- sent it, which is what every existing row already is.

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "sentByUserId" TEXT;

-- CreateIndex
CREATE INDEX "Message_sentByUserId_idx" ON "Message"("sentByUserId");

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_sentByUserId_fkey" FOREIGN KEY ("sentByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

