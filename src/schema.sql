-- USERS
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  username TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- PREFERENCES (checkbox list saved as rows)
CREATE TABLE IF NOT EXISTS user_preferences (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  preference TEXT NOT NULL
);

-- CHAT PROMPTS (store last prompts; we will keep last 10 per user)
CREATE TABLE IF NOT EXISTS user_prompts (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- BOOKINGS
CREATE TABLE IF NOT EXISTS bookings (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('hotel', 'taxi')),
  details JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);