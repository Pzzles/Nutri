CREATE TABLE user_food_portions (
  user_id       UUID           NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  food_id       UUID           NOT NULL REFERENCES foods(id)    ON DELETE CASCADE,
  usual_g       NUMERIC(8,2)   NOT NULL,
  use_count     INT            NOT NULL DEFAULT 1,
  last_used_at  TIMESTAMPTZ    NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, food_id)
);

ALTER TABLE user_food_portions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user can manage own portions"
  ON user_food_portions FOR ALL
  USING (auth.uid() = user_id);
