BEGIN;

CREATE OR REPLACE FUNCTION ensure_message_sender_is_member()
RETURNS TRIGGER AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM conversation_members
        WHERE conversation_id = NEW.conversation_id
          AND user_id = NEW.sender_id
          AND left_at IS NULL
    ) THEN
        RAISE EXCEPTION 'Sender must be an active member of the conversation';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
