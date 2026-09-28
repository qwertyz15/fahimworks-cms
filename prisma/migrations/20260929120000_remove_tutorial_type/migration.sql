-- Tutorials are no longer a content type: anything still marked TUTORIAL becomes an article.
UPDATE "contents" SET "type" = 'ARTICLE' WHERE "type" = 'TUTORIAL';

-- AlterEnum (Postgres can't drop an enum value: recreate the type without it)
CREATE TYPE "ContentType_new" AS ENUM ('BLOG', 'ARTICLE', 'PROJECT', 'NOTEBOOK');
ALTER TABLE "contents" ALTER COLUMN "type" TYPE "ContentType_new" USING ("type"::text::"ContentType_new");
ALTER TYPE "ContentType" RENAME TO "ContentType_old";
ALTER TYPE "ContentType_new" RENAME TO "ContentType";
DROP TYPE "ContentType_old";
