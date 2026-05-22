-- Remove duplicate lists: keep only the oldest (lowest id) per name.
-- Only deletes lists that have no members (safe to remove).
DELETE FROM lists
WHERE id NOT IN (
  SELECT MIN(id) FROM lists GROUP BY name
)
AND NOT EXISTS (
  SELECT 1 FROM list_members WHERE list_id = lists.id
);
