import { DEFAULT_INTENTS } from "./engine/intents.js";

// Append-only. Each entry runs once, in order, tracked in schema_migrations. Never edit a shipped entry.
export const migrations: string[] = [
  // 1: Phase 1 core tables (IF NOT EXISTS so pre-migration DBs pass through)
  /* sql */ `
CREATE TABLE IF NOT EXISTS categories (
  id   SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS documents (
  id          SERIAL PRIMARY KEY,
  category_id INT REFERENCES categories(id) ON DELETE SET NULL,
  title       TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sections (
  id          SERIAL PRIMARY KEY,
  document_id INT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  position    INT NOT NULL DEFAULT 0,
  heading     TEXT NOT NULL DEFAULT '',
  body        TEXT NOT NULL,
  search      tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', heading), 'A') ||
    setweight(to_tsvector('english', body), 'B')
  ) STORED
);
CREATE INDEX IF NOT EXISTS sections_search_idx ON sections USING GIN (search);

-- array_to_string is STABLE, so generated columns reject it; for text[] it is effectively immutable.
CREATE OR REPLACE FUNCTION keywords_text(text[]) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT array_to_string($1, ' ') $$;

CREATE TABLE IF NOT EXISTS faqs (
  id          SERIAL PRIMARY KEY,
  category_id INT REFERENCES categories(id) ON DELETE SET NULL,
  question    TEXT NOT NULL,
  answer      TEXT NOT NULL,
  keywords    TEXT[] NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  search      tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', question), 'A') ||
    setweight(to_tsvector('english', keywords_text(keywords)), 'A') ||
    setweight(to_tsvector('english', answer), 'C')
  ) STORED
);
CREATE INDEX IF NOT EXISTS faqs_search_idx ON faqs USING GIN (search);
`,

  // 2: Phase 2 — multiple knowledge bases, enable/disable, document sources
  /* sql */ `
CREATE TABLE knowledge_bases (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO knowledge_bases (name, slug) VALUES ('Default', 'default');

ALTER TABLE categories ADD COLUMN kb_id INT REFERENCES knowledge_bases(id) ON DELETE CASCADE;
ALTER TABLE faqs       ADD COLUMN kb_id INT REFERENCES knowledge_bases(id) ON DELETE CASCADE;
ALTER TABLE documents  ADD COLUMN kb_id INT REFERENCES knowledge_bases(id) ON DELETE CASCADE;
UPDATE categories SET kb_id = (SELECT id FROM knowledge_bases WHERE slug = 'default');
UPDATE faqs       SET kb_id = (SELECT id FROM knowledge_bases WHERE slug = 'default');
UPDATE documents  SET kb_id = (SELECT id FROM knowledge_bases WHERE slug = 'default');
ALTER TABLE categories ALTER COLUMN kb_id SET NOT NULL;
ALTER TABLE faqs       ALTER COLUMN kb_id SET NOT NULL;
ALTER TABLE documents  ALTER COLUMN kb_id SET NOT NULL;

ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_name_key;
ALTER TABLE categories ADD CONSTRAINT categories_kb_name_key UNIQUE (kb_id, name);

ALTER TABLE faqs      ADD COLUMN enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE documents ADD COLUMN enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE documents ADD COLUMN source_type TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE documents ADD COLUMN source_name TEXT;

CREATE INDEX faqs_kb_idx      ON faqs (kb_id);
CREATE INDEX documents_kb_idx ON documents (kb_id);
CREATE INDEX sections_doc_idx ON sections (document_id);
`,

  // 3: Phase 3 — synonym dictionary per knowledge base, content_version for search-index cache invalidation
  /* sql */ `
CREATE TABLE synonyms (
  id         SERIAL PRIMARY KEY,
  kb_id      INT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  terms      TEXT[] NOT NULL CHECK (cardinality(terms) >= 2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX synonyms_kb_idx ON synonyms (kb_id);

ALTER TABLE knowledge_bases ADD COLUMN content_version BIGINT NOT NULL DEFAULT 0;

-- Any change to searchable content bumps its knowledge base's version, so every API instance rebuilds its index.
CREATE FUNCTION bump_kb_version() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  kb INT;
  r RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  IF TG_TABLE_NAME = 'sections' THEN
    SELECT kb_id INTO kb FROM documents WHERE id = r.document_id;
  ELSE
    kb := r.kb_id;
  END IF;
  UPDATE knowledge_bases SET content_version = content_version + 1 WHERE id = kb;
  RETURN NULL;
END $$;

CREATE TRIGGER faqs_bump      AFTER INSERT OR UPDATE OR DELETE ON faqs       FOR EACH ROW EXECUTE FUNCTION bump_kb_version();
CREATE TRIGGER documents_bump AFTER INSERT OR UPDATE OR DELETE ON documents  FOR EACH ROW EXECUTE FUNCTION bump_kb_version();
CREATE TRIGGER sections_bump  AFTER INSERT OR UPDATE OR DELETE ON sections   FOR EACH ROW EXECUTE FUNCTION bump_kb_version();
CREATE TRIGGER synonyms_bump  AFTER INSERT OR UPDATE OR DELETE ON synonyms   FOR EACH ROW EXECUTE FUNCTION bump_kb_version();
CREATE TRIGGER categories_bump AFTER UPDATE OR DELETE ON categories          FOR EACH ROW EXECUTE FUNCTION bump_kb_version();
`,

  // 4: Phase 4 — deterministic intents; FAQs/documents can be tagged with one.
  // Existing knowledge bases get the default intents (new ones get them on creation, see insertDefaultIntents).
  /* sql */ `
CREATE TABLE intents (
  id         SERIAL PRIMARY KEY,
  kb_id      INT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  patterns   TEXT[] NOT NULL CHECK (cardinality(patterns) >= 1),
  response   TEXT,
  enabled    BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (kb_id, name)
);

ALTER TABLE faqs      ADD COLUMN intent_id INT REFERENCES intents(id) ON DELETE SET NULL;
ALTER TABLE documents ADD COLUMN intent_id INT REFERENCES intents(id) ON DELETE SET NULL;

INSERT INTO intents (kb_id, name, patterns, response)
SELECT k.id, d.name, d.patterns, d.response
  FROM knowledge_bases k
 CROSS JOIN jsonb_to_recordset($intents$${JSON.stringify(DEFAULT_INTENTS)}$intents$::jsonb) AS d(name text, patterns text[], response text);

CREATE TRIGGER intents_bump AFTER INSERT OR UPDATE OR DELETE ON intents FOR EACH ROW EXECUTE FUNCTION bump_kb_version();
`,

  // 5: Phase 5 — conversation context for follow-up questions (see context.ts)
  /* sql */ `
CREATE TABLE conversations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kb_id             INT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  previous_question TEXT,
  previous_answer   TEXT,
  detected_intent   TEXT,
  matched_article   JSONB,
  entities          TEXT[] NOT NULL DEFAULT '{}',
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX conversations_updated_idx ON conversations (updated_at);
`,

  // 6: Phase 6 — order_status default intent for existing knowledge bases (entities are extracted per message, not stored)
  /* sql */ `
INSERT INTO intents (kb_id, name, patterns, response)
SELECT k.id, d.name, d.patterns, d.response
  FROM knowledge_bases k
 CROSS JOIN jsonb_to_recordset($intents$${JSON.stringify(DEFAULT_INTENTS.filter((i) => i.name === "order_status"))}$intents$::jsonb)
         AS d(name text, patterns text[], response text)
ON CONFLICT (kb_id, name) DO NOTHING;
`,

  // 7: Phase 9 — one row per visitor question, for analytics (see analytics.ts). No content_version trigger: logging a
  // question must not invalidate the search cache. conversation_id has no FK because conversations expire after 30 min.
  /* sql */ `
CREATE TABLE questions (
  id              BIGSERIAL PRIMARY KEY,
  kb_id           INT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL,
  message         TEXT NOT NULL,
  question_key    TEXT NOT NULL,
  topics          TEXT[] NOT NULL DEFAULT '{}',
  level           TEXT NOT NULL CHECK (level IN ('high', 'medium', 'low')),
  confidence      REAL NOT NULL,
  via             TEXT NOT NULL,
  intent          TEXT,
  source_type     TEXT CHECK (source_type IN ('faq', 'document')),
  source_id       INT,
  source_title    TEXT,
  reviewed        BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX questions_kb_created_idx ON questions (kb_id, created_at);
`,

  // 8: Phase 10 — human handoff: contact channels per knowledge base, and ticket threads answered by agents (see handoff.ts)
  /* sql */ `
ALTER TABLE knowledge_bases ADD COLUMN handoff JSONB NOT NULL DEFAULT '{}';

CREATE TABLE tickets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kb_id           INT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  conversation_id UUID,
  name            TEXT,
  email           TEXT,
  live            BOOLEAN NOT NULL DEFAULT false,
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX tickets_kb_idx ON tickets (kb_id, status, updated_at DESC);

CREATE TABLE ticket_messages (
  id         BIGSERIAL PRIMARY KEY,
  ticket_id  UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author     TEXT NOT NULL CHECK (author IN ('visitor', 'agent')),
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ticket_messages_ticket_idx ON ticket_messages (ticket_id, id);
`,
];
