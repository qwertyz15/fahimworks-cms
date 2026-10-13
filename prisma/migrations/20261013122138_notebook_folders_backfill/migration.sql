-- Give existing Notebook entries an order inside their (top-level) folder:
-- newest edits first, as the Notebook list showed them. Keys are valid
-- fractional-indexing keys ("b" + two base-62 digits, up to 3,844 entries),
-- which sort byte-wise like the keys the app generates.
WITH ordered AS (
  SELECT id, (row_number() OVER (ORDER BY updated_at DESC, id) - 1) AS n
  FROM contents
  WHERE source = 'WRITTEN' AND folder_position IS NULL
)
UPDATE contents c
SET folder_position = 'b'
  || substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', (o.n / 62)::int + 1, 1)
  || substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', (o.n % 62)::int + 1, 1)
FROM ordered o
WHERE c.id = o.id AND o.n < 3844;
