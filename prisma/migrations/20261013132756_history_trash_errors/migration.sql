-- CreateTable
CREATE TABLE "revisions" (
    "id" TEXT NOT NULL,
    "content_id" TEXT,
    "page_id" TEXT,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "body" JSONB,
    "content_html" TEXT,
    "word_count" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trash_items" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "entry_count" INTEGER NOT NULL DEFAULT 0,
    "folder_count" INTEGER NOT NULL DEFAULT 0,
    "deleted_by_id" TEXT,
    "deleted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trash_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "error_events" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "route" TEXT,
    "digest" TEXT,
    "count" INTEGER NOT NULL DEFAULT 1,
    "first_seen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_alerted_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "error_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "revisions_content_id_created_at_idx" ON "revisions"("content_id", "created_at");

-- CreateIndex
CREATE INDEX "revisions_page_id_created_at_idx" ON "revisions"("page_id", "created_at");

-- CreateIndex
CREATE INDEX "trash_items_deleted_at_idx" ON "trash_items"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "error_events_fingerprint_key" ON "error_events"("fingerprint");

-- CreateIndex
CREATE INDEX "error_events_last_seen_idx" ON "error_events"("last_seen");
