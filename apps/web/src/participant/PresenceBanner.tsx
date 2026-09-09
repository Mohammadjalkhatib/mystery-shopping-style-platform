import { Alert, AlertTitle, Typography } from '@mui/material';
import type { Presence } from '@msp/shared';
import { useT } from '../i18n/LocaleContext.js';

/**
 * Where the participant is, said out loud while there is still time to do something about it.
 *
 * This is the "live presence indicator" `docs/BACKLOG.md` asked for in `feat/participant-flow`
 * and never got, and its absence was a real product failure: the server computed presence on
 * the very first fix, and the participant found out days later from a rejection. Someone could
 * stand in the wrong branch of a chain for an hour with the system knowing the whole time.
 *
 * **The state is computed on the server and relayed, never computed here** (rule 2, rule 7).
 * The classification is the server's: it holds the snapshot the visit is judged against and
 * applies `presenceFor` to it, and no arithmetic on the fence happens in the browser.
 *
 * **It says which state, never how far** (D-036), and the honest reason is narrower than it
 * first looks. A metre readout would be a live oracle — move, read, adjust — but the fence it
 * would reveal is ALREADY disclosed: `GET /sessions/:id` returns `venue.lat`, `venue.lng` and
 * `venue.radiusM` to the participant, and this screen renders the radius on the ready-to-start
 * card. So withholding distance here buys only `nearBufferM`, which an attacker aiming to look
 * *inside* never needs. It is kept withheld because it costs nothing to withhold, not because
 * it is load-bearing; the disclosure worth revisiting is `SessionView`, and that is recorded
 * rather than changed here. The `spoof-adversary` pass established this, against the opposite
 * claim that used to be written in this comment.
 *
 * Two states here are deliberately NOT failures, and the copy says so in both:
 * `unknown` is an accuracy problem, normal indoors, and the engine is already told not to
 * punish it; and `null` means no answer has come back yet, which lasts up to a sampling
 * interval at the start of every visit and is not the same claim as "you are not there".
 */
export function PresenceBanner({
  presence,
  presenceAt,
  venueName,
}: {
  presence: Presence | null;
  /** Device clock of the fix behind the answer. Used only to show an age. */
  presenceAt: number | null;
  venueName: string;
}) {
  const t = useT();

  const view = {
    // `error` because being in the wrong place has to be unmissable on a phone in a shop, and
    // the body copy carries the reassurance that nothing has gone wrong yet.
    outside: { severity: 'error', title: 'participant.presence.outside', hint: 'participant.presence.outsideHint' },
    near: { severity: 'warning', title: 'participant.presence.near', hint: 'participant.presence.nearHint' },
    inside: { severity: 'success', title: 'participant.presence.inside', hint: 'participant.presence.insideHint' },
    unknown: { severity: 'info', title: 'participant.presence.unknown', hint: 'participant.presence.unknownHint' },
  } as const;

  const v = presence ? view[presence] : null;

  if (!v) {
    return (
      <Alert severity="info" sx={{ mb: 2 }}>
        <AlertTitle sx={{ mb: 0.25 }}>{t('participant.presence.checking')}</AlertTitle>
        <Typography variant="body2">{t('participant.presence.checkingHint')}</Typography>
      </Alert>
    );
  }

  return (
    <Alert severity={v.severity} sx={{ mb: 2 }}>
      {/*
        The venue is named in the headline rather than left to context. A participant with more
        than one visit open, reading a phone one-handed in a shop, should not have to work out
        which one this is about.
      */}
      <AlertTitle sx={{ mb: 0.25 }}>{t(v.title, { venue: venueName })}</AlertTitle>
      <Typography variant="body2">{t(v.hint)}</Typography>
      {/*
        The age, once the answer is old enough to doubt. Presence only moves when a batch
        reaches the server, so an offline participant keeps seeing the last answer — saying how
        old it is turns a stale reading into an honest one rather than a wrong one.
      */}
      {presenceAt !== null && <Freshness at={presenceAt} />}
    </Alert>
  );
}

function Freshness({ at }: { at: number }) {
  const t = useT();
  const mins = Math.floor((Date.now() - at) / 60_000);
  return (
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
      {mins < 1 ? t('participant.presence.staleNow') : t('participant.presence.stale', { mins })}
    </Typography>
  );
}
