import { Box, Stack, Typography } from '@mui/material';
import type { Presence } from '@msp/shared';
import { useT } from '../i18n/LocaleContext.js';
import { qa, verdictPalette } from '../theme/theme.js';

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

  /**
   * Each state's colour, ground and mark.
   *
   * This used to be four MUI `Alert` severities. An `Alert` is the right weight for a passing
   * remark and the wrong weight for the single most important fact on the screen — it rendered
   * at the same size as the offline notice and the background-tab notice stacked beneath it,
   * and it was the only one of the three that changes what the participant should DO.
   *
   * The colours are the brand's, not MUI's semantic set, and `inside` is deliberately the brand
   * teal rather than a success green. This screen belongs to the same system as the verdict
   * that comes out of it, and a green tick here promises a certainty the engine will not
   * deliver later (D-001).
   */
  const view = {
    outside: {
      colour: verdictPalette.rejected.main,
      ground: qa.red[50],
      title: 'participant.presence.outside',
      hint: 'participant.presence.outsideHint',
      mark: 'alert',
    },
    near: {
      colour: verdictPalette.needs_review.main,
      ground: qa.yellow[50],
      title: 'participant.presence.near',
      hint: 'participant.presence.nearHint',
      mark: 'pin',
    },
    inside: {
      colour: qa.teal[700],
      ground: qa.teal[50],
      title: 'participant.presence.inside',
      hint: 'participant.presence.insideHint',
      mark: 'pin',
    },
    unknown: {
      colour: qa.neutral[600],
      ground: qa.neutral[100],
      title: 'participant.presence.unknown',
      hint: 'participant.presence.unknownHint',
      mark: 'question',
    },
  } as const;

  const v = presence
    ? view[presence]
    : ({
        colour: qa.neutral[600],
        ground: qa.neutral[100],
        title: 'participant.presence.checking',
        hint: 'participant.presence.checkingHint',
        mark: 'question',
      } as const);

  return (
    <Stack
      spacing={1.5}
      sx={{
        alignItems: 'center',
        textAlign: 'center',
        px: 2.5,
        py: 3,
        mb: 2,
        bgcolor: v.ground,
        border: `1px solid ${v.colour}22`,
        borderRadius: `${qa.radius.xl}px`,
      }}
    >
      <Box
        sx={{
          width: 60,
          height: 60,
          borderRadius: '50%',
          display: 'grid',
          placeItems: 'center',
          bgcolor: `${v.colour}1f`,
          flexShrink: 0,
        }}
      >
        <PresenceMark mark={v.mark} colour={v.colour} />
      </Box>

      {/*
        The venue is named in the headline rather than left to context. A participant with more
        than one visit open, reading a phone one-handed in a shop, should not have to work out
        which one this is about.
      */}
      <Box>
        <Typography variant="h2" sx={{ fontSize: '1.25rem', mb: 0.5 }}>
          {t(v.title, { venue: venueName })}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 300, mx: 'auto' }}>
          {t(v.hint)}
        </Typography>
      </Box>

      {/*
        The age, once the answer is old enough to doubt. Presence only moves when a batch
        reaches the server, so an offline participant keeps seeing the last answer — saying how
        old it is turns a stale reading into an honest one rather than a wrong one.
      */}
      {presenceAt !== null && <Freshness at={presenceAt} />}
    </Stack>
  );
}

/**
 * The mark inside the disc.
 *
 * Drawn rather than imported: the app has no icon dependency and one is not worth adding for
 * three glyphs. Stroke-based on a 20px grid so they scale and take their colour from the state.
 */
function PresenceMark({ mark, colour }: { mark: 'pin' | 'alert' | 'question'; colour: string }) {
  const common = {
    width: 30,
    height: 30,
    viewBox: '0 0 20 20',
    fill: 'none',
    stroke: colour,
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  if (mark === 'pin') {
    return (
      <svg {...common} aria-hidden>
        <path d="M10 17.5s5.5-4.35 5.5-9a5.5 5.5 0 1 0-11 0c0 4.65 5.5 9 5.5 9Z" />
        <circle cx="10" cy="8.5" r="2" />
      </svg>
    );
  }
  if (mark === 'alert') {
    return (
      <svg {...common} aria-hidden>
        <path d="M8.6 2.9 1.9 15a1.6 1.6 0 0 0 1.4 2.4h13.4A1.6 1.6 0 0 0 18.1 15L11.4 2.9a1.6 1.6 0 0 0-2.8 0Z" />
        <path d="M10 7.5v3.6" />
        <circle cx="10" cy="13.7" r="0.6" fill={colour} stroke="none" />
      </svg>
    );
  }
  return (
    <svg {...common} aria-hidden>
      <circle cx="10" cy="10" r="7.5" />
      <path d="M8.1 7.9a2 2 0 1 1 2.7 1.9v1.3" />
      <circle cx="10.4" cy="13.6" r="0.6" fill={colour} stroke="none" />
    </svg>
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
