-- 0002 — Refresh tokens with rotation and reuse detection (ADR-0004 §4.2–4.3, S2-02).
--
-- Tokens are opaque 256-bit values; only their SHA-256 hash is stored. Every sign-in starts a
-- family; each refresh marks the presented token used and issues the next one in the same family.
-- Presenting a used token again revokes the whole family (theft signal). Rows are visible only to
-- the presented token (`app.refresh_hash`) or its user (`app.user_id`); the functions below set
-- those transaction-local settings, so call each in its own transaction.

CREATE FUNCTION app_refresh_hash() RETURNS text
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.refresh_hash', true), '') $$;

CREATE TABLE refresh_token_families (
  id             text PRIMARY KEY,
  user_id        text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  workspace_id   text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  revoked_at     timestamptz,
  revoke_reason  text CHECK (revoke_reason IN ('logout', 'reuse', 'account_deleted', 'membership_removed')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_token_families_user_idx ON refresh_token_families (user_id);

CREATE TABLE refresh_tokens (
  id          text PRIMARY KEY,
  family_id   text NOT NULL REFERENCES refresh_token_families (id) ON DELETE CASCADE,
  user_id     text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id);

CREATE TRIGGER refresh_token_families_updated_at BEFORE UPDATE ON refresh_token_families
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER refresh_tokens_updated_at BEFORE UPDATE ON refresh_tokens
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE refresh_token_families ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_token_families FORCE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens FORCE ROW LEVEL SECURITY;

CREATE POLICY own_families ON refresh_token_families
  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
CREATE POLICY own_tokens ON refresh_tokens
  USING (token_hash = app_refresh_hash() OR user_id = app_user_id())
  WITH CHECK (user_id = app_user_id());

-- A retry of a refresh whose response was lost, or two extension contexts refreshing at once,
-- presents the just-used token again within seconds; that is not theft (ADR-0004 §4.3).
-- Within this window a used token gets another successor instead of revoking the family.
-- (The window must stay short: a stolen token is usable for this long after the legit refresh.)
CREATE FUNCTION app_refresh_reuse_grace() RETURNS interval
  LANGUAGE sql IMMUTABLE AS $$ SELECT interval '30 seconds' $$;

-- Starts a family for a sign-in and stores its first token. The user must be a member of the
-- workspace the tokens will name.
CREATE FUNCTION app_issue_refresh_token(
  p_user_id text, p_workspace_id text, p_family_id text, p_token_id text,
  p_token_hash text, p_expires_at timestamptz
) RETURNS void
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  PERFORM set_config('app.user_id', p_user_id, true);
  IF NOT EXISTS (SELECT 1 FROM memberships m
                 WHERE m.user_id = p_user_id AND m.workspace_id = p_workspace_id) THEN
    RAISE EXCEPTION 'user is not a member of the workspace' USING ERRCODE = '42501';
  END IF;
  INSERT INTO refresh_token_families (id, user_id, workspace_id)
    VALUES (p_family_id, p_user_id, p_workspace_id);
  INSERT INTO refresh_tokens (id, family_id, user_id, token_hash, expires_at)
    VALUES (p_token_id, p_family_id, p_user_id, p_token_hash, p_expires_at);
END $$;

-- Rotates a presented token. Status: 'ok' (new token stored), 'unknown', 'expired', 'revoked'
-- (family revoked, or the user left the workspace: the family is revoked now) or 'reused' (a used
-- token came back after the grace window: the family is revoked now).
CREATE FUNCTION app_rotate_refresh_token(
  p_token_hash text, p_new_token_id text, p_new_token_hash text, p_new_expires_at timestamptz
) RETURNS TABLE (status text, user_id text, workspace_id text)
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
DECLARE
  t refresh_tokens%ROWTYPE;
  f refresh_token_families%ROWTYPE;
BEGIN
  PERFORM set_config('app.refresh_hash', p_token_hash, true);
  SELECT * INTO t FROM refresh_tokens rt WHERE rt.token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'unknown'::text, NULL::text, NULL::text;
    RETURN;
  END IF;
  PERFORM set_config('app.user_id', t.user_id, true);
  SELECT * INTO f FROM refresh_token_families rf WHERE rf.id = t.family_id FOR UPDATE;

  IF f.revoked_at IS NOT NULL THEN
    RETURN QUERY SELECT 'revoked'::text, t.user_id, f.workspace_id;
    RETURN;
  END IF;
  IF t.used_at IS NOT NULL AND t.used_at < now() - app_refresh_reuse_grace() THEN
    UPDATE refresh_token_families SET revoked_at = now(), revoke_reason = 'reuse' WHERE id = f.id;
    RETURN QUERY SELECT 'reused'::text, t.user_id, f.workspace_id;
    RETURN;
  END IF;
  IF t.expires_at <= now() THEN
    RETURN QUERY SELECT 'expired'::text, t.user_id, f.workspace_id;
    RETURN;
  END IF;
  -- Removed from the workspace: no more tokens naming it.
  IF NOT EXISTS (SELECT 1 FROM memberships m
                 WHERE m.user_id = t.user_id AND m.workspace_id = f.workspace_id) THEN
    UPDATE refresh_token_families SET revoked_at = now(), revoke_reason = 'membership_removed'
      WHERE id = f.id;
    RETURN QUERY SELECT 'revoked'::text, t.user_id, f.workspace_id;
    RETURN;
  END IF;

  UPDATE refresh_tokens SET used_at = coalesce(used_at, now()) WHERE id = t.id;
  INSERT INTO refresh_tokens (id, family_id, user_id, token_hash, expires_at)
    VALUES (p_new_token_id, f.id, t.user_id, p_new_token_hash, p_new_expires_at);
  RETURN QUERY SELECT 'ok'::text, t.user_id, f.workspace_id;
END $$;

-- Logout: revokes the presented token's family. Returns false for an unknown token.
CREATE FUNCTION app_revoke_refresh_family(p_token_hash text, p_reason text)
  RETURNS boolean
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
DECLARE
  t refresh_tokens%ROWTYPE;
BEGIN
  PERFORM set_config('app.refresh_hash', p_token_hash, true);
  SELECT * INTO t FROM refresh_tokens rt WHERE rt.token_hash = p_token_hash;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  PERFORM set_config('app.user_id', t.user_id, true);
  UPDATE refresh_token_families SET revoked_at = coalesce(revoked_at, now()),
    revoke_reason = coalesce(revoke_reason, p_reason)
    WHERE id = t.family_id;
  RETURN true;
END $$;

-- Only the application role (the owner) may call these; nothing is granted to PUBLIC.
REVOKE EXECUTE ON FUNCTION app_issue_refresh_token(text, text, text, text, text, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION app_rotate_refresh_token(text, text, text, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION app_revoke_refresh_family(text, text) FROM PUBLIC;
