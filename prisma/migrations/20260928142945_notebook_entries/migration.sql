-- CreateEnum
CREATE TYPE "ContentSource" AS ENUM ('IMPORTED', 'WRITTEN');

-- AlterTable
ALTER TABLE "contents" ADD COLUMN     "body" JSONB,
ADD COLUMN     "source" "ContentSource" NOT NULL DEFAULT 'IMPORTED',
ADD COLUMN     "subtitle" TEXT,
ALTER COLUMN "url" DROP NOT NULL,
ALTER COLUMN "normalized_url" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "contents_source_idx" ON "contents"("source");
