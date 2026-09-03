-- Add UmaPark to the reshuffle pool after UmaFourty.
INSERT INTO clubs (
  circle_id,
  name,
  slot_order,
  capacity,
  in_pool,
  leader_viewer_id_api
)
VALUES (548045752, 'UmaPark', 6, 30, 1, 702530333287)
ON CONFLICT (circle_id) DO UPDATE SET
  name = excluded.name,
  slot_order = excluded.slot_order,
  capacity = excluded.capacity,
  in_pool = excluded.in_pool,
  leader_viewer_id_api = excluded.leader_viewer_id_api,
  is_active = 1;