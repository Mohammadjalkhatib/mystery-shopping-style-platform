import { Alert, Box, Button, CircularProgress, Stack, Typography } from '@mui/material';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { useT } from '../i18n/LocaleContext.js';

const MAX_BYTES = 6 * 1024 * 1024;
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * The optional photo on the report screen.
 *
 * It uploads on selection rather than on submit, deliberately. Submit is a transaction that
 * closes the visit (rule 9) and it has to stay fast and certain; carrying six megabytes into it
 * would make a slow network look like a failed submission, and a retry would then be a retry of
 * the whole report. Uploading first means the submit body carries a short key and the slow part
 * has already succeeded or already failed, visibly, while the participant is still looking.
 *
 * Both limits are checked here AND on the server. This copy exists to give an instant answer on
 * a phone rather than after a six megabyte round trip; the server's copy is the one that counts,
 * because this one is client-side and therefore advisory (rule 2).
 */
export function EvidencePicker({
  sessionId,
  onChange,
}: {
  sessionId: string;
  onChange: (evidenceKey: string | null) => void;
}) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // An object URL is a document-lifetime handle; without this every re-pick leaks one.
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const pick = async (file: File): Promise<void> => {
    setError(null);
    if (!ALLOWED.includes(file.type)) {
      setError(t('participant.evidence.wrongType'));
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(t('participant.evidence.tooLarge'));
      return;
    }

    setBusy(true);
    try {
      const { evidenceKey } = await api.uploadEvidence(sessionId, file);
      setPreview((old) => {
        if (old) URL.revokeObjectURL(old);
        return URL.createObjectURL(file);
      });
      setDone(true);
      onChange(evidenceKey);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('participant.evidence.uploadFailed'));
      setDone(false);
      onChange(null);
    } finally {
      setBusy(false);
    }
  };

  const clear = (): void => {
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return null;
    });
    setDone(false);
    setError(null);
    onChange(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <Box>
      <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.25 }}>
        {t('participant.evidence.attach')}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
        {t('participant.evidence.attachHint')}
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 1.5 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {preview && (
        <Box
          component="img"
          src={preview}
          alt=""
          sx={{
            display: 'block',
            width: '100%',
            maxHeight: 240,
            objectFit: 'cover',
            borderRadius: 1,
            mb: 1.5,
          }}
        />
      )}

      <input
        ref={inputRef}
        type="file"
        // `capture` is a hint, not a demand: on a phone it offers the camera, and on a desktop
        // browsers that do not understand it simply show the normal file picker.
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void pick(f);
        }}
      />

      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Button
          variant="outlined"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          startIcon={busy ? <CircularProgress size={16} /> : undefined}
        >
          {busy
            ? t('participant.evidence.uploading')
            : preview
              ? t('participant.evidence.replacePhoto')
              : t('participant.evidence.choosePhoto')}
        </Button>
        {preview && !busy && (
          <Button color="inherit" onClick={clear}>
            {t('participant.evidence.remove')}
          </Button>
        )}
        {done && !busy && (
          <Typography variant="caption" color="success.main">
            {t('participant.evidence.uploaded')}
          </Typography>
        )}
      </Stack>
    </Box>
  );
}
