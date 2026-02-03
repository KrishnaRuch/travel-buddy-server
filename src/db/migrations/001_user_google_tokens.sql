CREATE TABLE IF NOT EXISTS user_google_tokens (
  user_id        INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  access_token   TEXT,
  refresh_token  TEXT,
  scope          TEXT,
  token_type     TEXT,
  expiry_date    BIGINT, -- ms since epoch
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION set_updated_at_user_google_tokens()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_user_google_tokens_updated_at ON user_google_tokens;
CREATE TRIGGER trg_user_google_tokens_updated_at
BEFORE UPDATE ON user_google_tokens
FOR EACH ROW
EXECUTE PROCEDURE set_updated_at_user_google_tokens();