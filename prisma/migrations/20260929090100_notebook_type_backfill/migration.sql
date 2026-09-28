-- Notebook posts are their own type. (Separate migration: Postgres can't use a
-- newly added enum value in the transaction that added it.)
UPDATE "contents" SET "type" = 'NOTEBOOK' WHERE "source" = 'WRITTEN';
