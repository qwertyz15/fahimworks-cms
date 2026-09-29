-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PropertyType" ADD VALUE 'RELATION';
ALTER TYPE "PropertyType" ADD VALUE 'ROLLUP';
ALTER TYPE "PropertyType" ADD VALUE 'FORMULA';

-- AlterTable
ALTER TABLE "databases" ADD COLUMN     "computed_on" DATE;

-- CreateTable
CREATE TABLE "page_relations" (
    "property_id" TEXT NOT NULL,
    "from_page_id" TEXT NOT NULL,
    "to_page_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "page_relations_pkey" PRIMARY KEY ("property_id","from_page_id","to_page_id")
);

-- CreateIndex
CREATE INDEX "page_relations_to_page_id_idx" ON "page_relations"("to_page_id");

-- CreateIndex
CREATE INDEX "page_relations_from_page_id_idx" ON "page_relations"("from_page_id");

-- AddForeignKey
ALTER TABLE "page_relations" ADD CONSTRAINT "page_relations_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "database_properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_relations" ADD CONSTRAINT "page_relations_from_page_id_fkey" FOREIGN KEY ("from_page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_relations" ADD CONSTRAINT "page_relations_to_page_id_fkey" FOREIGN KEY ("to_page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
