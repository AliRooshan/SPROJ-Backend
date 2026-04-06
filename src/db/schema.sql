-- EdVoyage Database Schema

CREATE TABLE IF NOT EXISTS programs (
  id          SERIAL PRIMARY KEY,
  university  TEXT NOT NULL,
  program     TEXT NOT NULL,
  country     TEXT,
  city        TEXT,
  deadline    DATE,
  tuition     NUMERIC,
  currency    TEXT,
  duration    TEXT,
  description TEXT,
  eligibility TEXT,
  image       TEXT,
  logo        TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scholarships (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  provider   TEXT,
  amount     TEXT,
  deadline   TEXT,
  country    TEXT,
  type       TEXT,
  status     TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS living_costs (
  id        SERIAL PRIMARY KEY,
  city      TEXT NOT NULL,
  country   TEXT,
  rent      NUMERIC,
  food      NUMERIC,
  transport NUMERIC,
  currency  TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email            TEXT UNIQUE NOT NULL,
  password_hash    TEXT NOT NULL,
  full_name        TEXT,
  phone            TEXT,
  degree           TEXT,
  major            TEXT,
  gpa              TEXT,
  english_test     TEXT,
  english_score    TEXT,
  target_countries TEXT[],
  intake           TEXT,
  budget           TEXT,
  career_goal      TEXT,
  is_admin         BOOLEAN DEFAULT FALSE,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS saved_programs (
  id         SERIAL PRIMARY KEY,
  user_id    UUID REFERENCES users(id) ON DELETE CASCADE,
  program_id INT  REFERENCES programs(id) ON DELETE CASCADE,
  saved_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, program_id)
);

CREATE TABLE IF NOT EXISTS saved_scholarships (
  id             SERIAL PRIMARY KEY,
  user_id        UUID REFERENCES users(id) ON DELETE CASCADE,
  scholarship_id INT  REFERENCES scholarships(id) ON DELETE CASCADE,
  saved_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, scholarship_id)
);

CREATE TABLE IF NOT EXISTS applications (
  id           SERIAL PRIMARY KEY,
  user_id      UUID REFERENCES users(id) ON DELETE CASCADE,
  program_id   INT  REFERENCES programs(id) ON DELETE SET NULL,
  university   TEXT,
  program_name TEXT,
  country      TEXT,
  deadline     DATE,
  status       TEXT DEFAULT 'pending',
  applied_date DATE DEFAULT CURRENT_DATE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, program_id)
);

CREATE TABLE IF NOT EXISTS visa_guidance (
  id          SERIAL PRIMARY KEY,
  country     TEXT NOT NULL UNIQUE,
  steps       JSONB NOT NULL DEFAULT '[]',   -- array of {id, title, description, duration}
  documents   TEXT[] NOT NULL DEFAULT '{}',  -- list of required document names
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_programs_country        ON programs(country);
CREATE INDEX idx_programs_tuition        ON programs(tuition);
CREATE INDEX idx_programs_duration       ON programs(duration);
CREATE INDEX idx_applications_user       ON applications(user_id);
CREATE INDEX idx_saved_programs_user     ON saved_programs(user_id);
CREATE INDEX idx_saved_scholarships_user ON saved_scholarships(user_id);
CREATE INDEX idx_visa_country            ON visa_guidance(country);