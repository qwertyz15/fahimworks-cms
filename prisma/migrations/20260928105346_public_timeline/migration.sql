-- AlterTable
ALTER TABLE "system_settings" ADD COLUMN     "profile_email" TEXT,
ADD COLUMN     "profile_github" TEXT,
ADD COLUMN     "profile_linkedin" TEXT,
ADD COLUMN     "profile_name" TEXT,
ADD COLUMN     "profile_tagline" TEXT,
ADD COLUMN     "profile_website" TEXT,
ADD COLUMN     "profile_x" TEXT,
ADD COLUMN     "timeline_enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "timeline_indexable" BOOLEAN NOT NULL DEFAULT false;
