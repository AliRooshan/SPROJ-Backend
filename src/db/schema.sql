-- REFERENCE TABLES

CREATE TABLE countries (
  id   SERIAL PRIMARY KEY,
  code CHAR(2) UNIQUE NOT NULL,  -- ISO 3166-1
  name TEXT NOT NULL
);

CREATE TABLE cities (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  country_id INT REFERENCES countries(id) ON DELETE CASCADE,
  UNIQUE(name, country_id)
);

CREATE TABLE universities (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  city_id    INT REFERENCES cities(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- CORE TABLES

CREATE TABLE programs (
  id            SERIAL PRIMARY KEY,
  university_id INT REFERENCES universities(id) ON DELETE CASCADE,
  name          TEXT,
  degree_level  TEXT,  -- Master's, PhD
  field_of_study TEXT,
  deadline      DATE,
  tuition_amount NUMERIC,
  currency      CHAR(3) DEFAULT 'USD',  -- ISO 4217
  standard_tuition NUMERIC,
  duration      TEXT,
  description   TEXT,
  eligibility   JSONB DEFAULT '[]',
  website       TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT chk_tuition_positive CHECK (tuition_amount >= 0)
);

CREATE TABLE scholarships (
  id          SERIAL PRIMARY KEY,
  name        TEXT,
  provider    TEXT,
  amount      TEXT,
  currency    CHAR(3),
  deadline    TEXT,
  country_id  INT REFERENCES countries(id) ON DELETE CASCADE,
  type        TEXT,  -- 'merit', 'need-based', 'sports', etc.
  description TEXT,
  requirements      JSONB DEFAULT '[]',
  benefits    TEXT,
  website     TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  
);

CREATE TABLE living_costs (
  id             SERIAL PRIMARY KEY,
  city_id        INT NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  rent_monthly   NUMERIC NOT NULL,
  food_monthly   NUMERIC NOT NULL,
  transport_monthly NUMERIC NOT NULL,
  currency       CHAR(3) NOT NULL DEFAULT 'USD',
  lifestyle      TEXT NOT NULL DEFAULT 'medium',

  CONSTRAINT chk_costs_positive CHECK (
    rent_monthly >= 0 AND food_monthly >= 0 AND transport_monthly >= 0
  ),
  CONSTRAINT chk_lifestyle CHECK (lifestyle IN ('low', 'medium', 'high'))
);

CREATE TABLE visa_guidance (
  id         SERIAL PRIMARY KEY,
  country_id INT UNIQUE NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  steps      JSONB NOT NULL DEFAULT '[]',
  documents  JSONB NOT NULL DEFAULT '[]',  -- Changed from TEXT[] for consistency
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- USER TABLES

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  phone         TEXT,
  is_admin      BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT chk_email_format CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}$')
);

CREATE TABLE user_profiles (
  user_id         UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  degree_level    TEXT,
  major           TEXT,
  gpa             NUMERIC(3,2),
  english_test    TEXT,  -- 'IELTS', 'TOEFL', 'PTE'
  english_score   NUMERIC(4,1),
  intake_term     TEXT,  -- 'Fall 2024', 'Spring 2025'
  budget_min      NUMERIC,
  budget_max      NUMERIC,
  budget_currency CHAR(3) DEFAULT 'USD',
  career_goal     TEXT,
  target_countries      JSONB NOT NULL DEFAULT '[]',

  CONSTRAINT chk_gpa_range CHECK (gpa BETWEEN 0 AND 4.0),
  CONSTRAINT chk_budget CHECK (budget_min <= budget_max)
);

-- SECONDARY TABLES

CREATE TABLE applications (
  id         SERIAL PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  program_id INT NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  status     TEXT NOT NULL DEFAULT 'pending',
  applied_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id, program_id),
  CONSTRAINT chk_status CHECK (status IN ('pending', 'accepted', 'rejected'))
);

CREATE TABLE saved_programs (
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  program_id INT NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  saved_at   TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY(user_id, program_id)
);

CREATE TABLE saved_scholarships (
  user_id        UUID REFERENCES users(id) ON DELETE CASCADE,
  scholarship_id INT REFERENCES scholarships(id) ON DELETE CASCADE,
  saved_at       TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY(user_id, scholarship_id)
);

-- EXTRA TABLES
CREATE TABLE currency_rates (
  currency CHAR(3) PRIMARY KEY,
  rate_to_usd NUMERIC NOT NULL
);

-- INDEXES

CREATE INDEX idx_programs_university ON programs(university_id);
CREATE INDEX idx_programs_deadline ON programs(deadline);
CREATE INDEX idx_programs_tuition ON programs(tuition_amount);
CREATE INDEX idx_programs_field ON programs(field_of_study);
CREATE INDEX idx_programs_standard_tuition ON programs(standard_tuition);

CREATE INDEX idx_scholarships_country ON scholarships(country_id);
CREATE INDEX idx_scholarships_deadline ON scholarships(deadline);
CREATE INDEX idx_scholarships_amount ON scholarships(amount);

CREATE INDEX idx_living_costs_city ON living_costs(city_id);

CREATE INDEX idx_applications_user ON applications(user_id);
CREATE INDEX idx_applications_status ON applications(user_id, status);

CREATE INDEX idx_saved_programs_user ON saved_programs(user_id);
CREATE INDEX idx_saved_scholarships_user ON saved_scholarships(user_id);

--TRIGGERS

-- Function
CREATE OR REPLACE FUNCTION update_programs_standard_tuition()
RETURNS TRIGGER AS $$
BEGIN
  NEW.standard_tuition := NEW.tuition_amount *
    COALESCE(
      (SELECT rate_to_usd FROM currency_rates WHERE currency = NEW.currency),
      1   
    );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger
CREATE TRIGGER trg_programs_standard_tuition
BEFORE INSERT OR UPDATE ON programs
FOR EACH ROW
EXECUTE FUNCTION update_programs_standard_tuition();
