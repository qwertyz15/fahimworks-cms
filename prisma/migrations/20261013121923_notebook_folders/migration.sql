-- AlterTable
ALTER TABLE "contents" ADD COLUMN     "folder_id" TEXT,
ADD COLUMN     "folder_position" TEXT;

-- CreateTable
CREATE TABLE "notebook_folders" (
    "id" TEXT NOT NULL,
    "parent_id" TEXT,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "description" TEXT,
    "slug" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notebook_folders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notebook_folders_slug_key" ON "notebook_folders"("slug");

-- CreateIndex
CREATE INDEX "notebook_folders_parent_id_position_idx" ON "notebook_folders"("parent_id", "position");

-- CreateIndex
CREATE INDEX "contents_folder_id_folder_position_idx" ON "contents"("folder_id", "folder_position");

-- AddForeignKey
ALTER TABLE "contents" ADD CONSTRAINT "contents_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "notebook_folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notebook_folders" ADD CONSTRAINT "notebook_folders_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "notebook_folders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
