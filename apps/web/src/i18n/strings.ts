/**
 * The participant-facing dictionary. English and Arabic, hand-written, no library.
 *
 * Scope is the participant flow and nothing else (CLAUDE.md section 9): sign in, consent, the
 * visit screen and the report. The business console stays English -- it is an internal tool
 * for a business user, and translating it would be the "full i18n" that is explicitly out of
 * scope. See D-022 for why this is a plain object rather than i18next.
 *
 * `Strings` is derived from the English dictionary, so Arabic is checked against it at compile
 * time: a missing or misspelled key fails the build rather than rendering blank at runtime.
 * That is the whole reason this is typed rather than a loose Record.
 */

export const en = {
  /* sign in */
  signIn: 'Sign in',
  username: 'Username',
  password: 'Password',
  signingIn: 'Signing in…',
  signInFailed: 'Sign in failed',
  demoAccounts: 'Demo accounts',
  demoPasswordFor: 'Password for all:',

  /* shell */
  yourVisit: 'Your visit',
  signOut: 'Sign out',
  language: 'العربية',
  loading: 'Loading…',
  noVisits: 'You have no visits assigned right now.',

  /* consent */
  consentTitle: 'Before you start',
  consentCollectedTitle: 'What is collected',
  consentCollectedBody:
    "Your device's location, sampled while this page is open and in front of you, from the moment you start the visit until you end it. Nothing is collected before you start or after you end.",
  consentUsedTitle: 'What it is used for',
  consentUsedBody:
    'To judge how well the evidence supports the visit having happened. It produces a score and a list of reasons — never a simple yes or no, and never proof that you were somewhere. A human reviews anything uncertain.',
  consentKeptTitle: 'How long it is kept',
  consentKeptBody:
    'The raw location trail is deleted automatically after the retention window, by the database itself rather than by a job someone has to remember to run. The summary of the visit is kept.',
  consentCannotTitle: 'What this app cannot do',
  consentCannotBody:
    'It cannot follow you in the background. If you lock your phone or switch apps, it stops receiving your location, and the gap is recorded as a gap. You can end the visit at any time.',
  consentReadPrompt: 'Please read the four sections above before agreeing.',
  consentMarkRead: 'I have read this',
  consentHasRead: 'Read ✓',
  consentAgree: 'I agree — continue',
  consentRecording: 'Recording…',
  consentVersionNote:
    'Consent version {version}. Your agreement is recorded with a server timestamp.',

  /* ready to start */
  venueIndoor: 'Indoor venue',
  venueOutdoor: 'Outdoor venue',
  geofence: '{radius} m geofence',
  readyAdvice:
    'Start the visit as you arrive, and keep this page open and in front of you while you are inside. Your phone can go back in your pocket between interactions — the gaps are expected.',
  startVisit: 'Start visit',
  starting: 'Starting…',

  /* the active visit */
  capturing: 'Capturing',
  paused: 'Paused',
  onSite: 'on site',
  permDenied:
    'Location permission is off, so nothing is being recorded. Turn it on in your browser settings — without it this visit cannot be verified.',
  permUnsupported: 'This browser does not provide location. Try Chrome or Safari.',
  backgroundNotice:
    'This page is in the background, so your location is not being recorded right now. That is normal and the gap is expected — bring the page back when you can.',
  offlineNotice:
    'You are offline. Fixes are being saved on your phone and will send themselves when you reconnect.',
  offlineWaiting: '{count} waiting.',
  locationsRecorded: 'Locations recorded: {count}',
  lastAccurate: 'last accurate to ~{metres} m',
  waitingToSend: '{count} waiting to send',
  screenAwake: 'screen kept awake while this page is open',
  waitingFirstFix:
    'Waiting for a first fix. This can take a few seconds outdoors and longer inside.',
  endingNotice: 'Ending the visit stops location capture. You will write your report next.',
  endingConfirm: 'Yes, end the visit',
  ending: 'Ending…',
  notYet: 'Not yet',
  endVisit: 'End visit',

  /* the report */
  reportTitle: 'Your report',
  reportRating: 'Overall experience',
  reportNotes: 'What did you observe?',
  reportNotesHint: 'Greeting time, staff helpfulness, queue length, cleanliness…',
  reportNotesCounter: '{count}/10 characters minimum',
  submitReport: 'Submit report',
  submitting: 'Submitting…',
  reportSubmitted:
    'Report submitted. It is being reviewed — you do not need to do anything else.',

  /* terminal states, matching TerminalReasonCode on the server */
  endedNeverStarted: 'This visit was never started, and was closed automatically after {mins} minutes.',
  endedWentQuiet:
    'No location update arrived for {mins} minutes, so this visit was closed automatically. Capture stops when the screen locks or the tab is backgrounded.',
  endedNoReport:
    'This visit was ended but no report was filed within {mins} minutes, so it was closed automatically.',
  endedExpired:
    'This visit reached the {hours}-hour limit for a single session and was closed automatically. Location was no longer being recorded.',
  endedGeneric: 'This visit has ended and can no longer be continued.',
} as const;

export type Strings = Record<keyof typeof en, string>;

/**
 * Arabic. Modern Standard, addressing the participant directly.
 *
 * The placeholders `{mins}` and `{hours}` must survive translation -- they are substituted by
 * `t()`, and a translated string that drops one silently renders the brace to the participant.
 */
export const ar: Strings = {
  signIn: 'تسجيل الدخول',
  username: 'اسم المستخدم',
  password: 'كلمة المرور',
  signingIn: 'جارٍ تسجيل الدخول…',
  signInFailed: 'فشل تسجيل الدخول',
  demoAccounts: 'حسابات تجريبية',
  demoPasswordFor: 'كلمة المرور للجميع:',

  yourVisit: 'زيارتك',
  signOut: 'تسجيل الخروج',
  language: 'English',
  loading: 'جارٍ التحميل…',
  noVisits: 'لا توجد لديك زيارات مُسندة حاليًا.',

  consentTitle: 'قبل أن تبدأ',
  consentCollectedTitle: 'ما الذي يُجمع',
  consentCollectedBody:
    'موقع جهازك، يُؤخذ أثناء فتح هذه الصفحة وظهورها أمامك، من لحظة بدء الزيارة حتى إنهائها. لا يُجمع شيء قبل البدء ولا بعد الإنهاء.',
  consentUsedTitle: 'فيمَ يُستخدم',
  consentUsedBody:
    'لتقدير مدى دعم الأدلة لحدوث الزيارة. ينتج عن ذلك درجة وقائمة أسباب — وليس نعم أو لا، وليس إثباتًا بأنك كنت في مكان ما. ويراجع شخص كل حالة غير مؤكدة.',
  consentKeptTitle: 'مدة الاحتفاظ به',
  consentKeptBody:
    'يُحذف سجل الموقع الأولي تلقائيًا بعد انتهاء مدة الاحتفاظ، بواسطة قاعدة البيانات نفسها لا بمهمة يتذكرها أحد. أما ملخص الزيارة فيُحفظ.',
  consentCannotTitle: 'ما لا يستطيع هذا التطبيق فعله',
  consentCannotBody:
    'لا يمكنه تتبعك في الخلفية. إذا أقفلت هاتفك أو انتقلت إلى تطبيق آخر، يتوقف عن استقبال موقعك، وتُسجَّل الفجوة على أنها فجوة. ويمكنك إنهاء الزيارة في أي وقت.',
  consentReadPrompt: 'يرجى قراءة الأقسام الأربعة أعلاه قبل الموافقة.',
  consentMarkRead: 'لقد قرأت هذا',
  consentHasRead: 'تمت القراءة ✓',
  consentAgree: 'أوافق — متابعة',
  consentRecording: 'جارٍ التسجيل…',
  consentVersionNote: 'إصدار الموافقة {version}. تُسجَّل موافقتك مع طابع زمني من الخادم.',

  venueIndoor: 'موقع داخلي',
  venueOutdoor: 'موقع خارجي',
  geofence: 'نطاق جغرافي {radius} متر',
  readyAdvice:
    'ابدأ الزيارة فور وصولك، وأبقِ هذه الصفحة مفتوحة وأمامك أثناء وجودك في الداخل. يمكنك إعادة الهاتف إلى جيبك بين التعاملات — الفجوات متوقعة.',
  startVisit: 'ابدأ الزيارة',
  starting: 'جارٍ البدء…',

  capturing: 'يسجّل',
  paused: 'متوقف مؤقتًا',
  onSite: 'في الموقع',
  permDenied:
    'إذن الموقع مُعطَّل، لذا لا يُسجَّل شيء. فعّله من إعدادات المتصفح — بدونه لا يمكن التحقق من هذه الزيارة.',
  permUnsupported: 'هذا المتصفح لا يوفّر خدمة الموقع. جرّب Chrome أو Safari.',
  backgroundNotice:
    'هذه الصفحة تعمل في الخلفية، لذلك لا يُسجَّل موقعك الآن. هذا أمر طبيعي والفجوة متوقعة — أعد فتح الصفحة عندما تستطيع.',
  offlineNotice:
    'أنت غير متصل بالإنترنت. تُحفظ القراءات على هاتفك وتُرسل تلقائيًا عند عودة الاتصال.',
  offlineWaiting: '{count} بانتظار الإرسال.',
  locationsRecorded: 'القراءات المسجّلة: {count}',
  lastAccurate: 'آخر قراءة بدقة ~{metres} متر',
  waitingToSend: '{count} بانتظار الإرسال',
  screenAwake: 'تبقى الشاشة مضاءة أثناء فتح هذه الصفحة',
  waitingFirstFix:
    'بانتظار أول قراءة. قد يستغرق ذلك ثوانٍ في الخارج ووقتًا أطول في الداخل.',
  endingNotice: 'إنهاء الزيارة يوقف تسجيل الموقع. ستكتب تقريرك بعد ذلك.',
  endingConfirm: 'نعم، أنهِ الزيارة',
  ending: 'جارٍ الإنهاء…',
  notYet: 'ليس بعد',
  endVisit: 'إنهاء الزيارة',

  reportTitle: 'تقريرك',
  reportRating: 'التجربة بشكل عام',
  reportNotes: 'ماذا لاحظت؟',
  reportNotesHint: 'وقت الترحيب، تعاون الموظفين، طول الطابور، النظافة…',
  reportNotesCounter: '{count}/10 حد أدنى من الأحرف',
  submitReport: 'إرسال التقرير',
  submitting: 'جارٍ الإرسال…',
  reportSubmitted: 'تم إرسال التقرير. تجري مراجعته — لا حاجة لأي إجراء آخر منك.',

  endedNeverStarted: 'لم تبدأ هذه الزيارة، وأُغلقت تلقائيًا بعد {mins} دقيقة.',
  endedWentQuiet:
    'لم تصل أي تحديثات للموقع خلال {mins} دقيقة، لذلك أُغلقت الزيارة تلقائيًا. يتوقف التسجيل عند قفل الشاشة أو تشغيل التبويب في الخلفية.',
  endedNoReport: 'أُنهيت الزيارة دون إرسال تقرير خلال {mins} دقيقة، لذلك أُغلقت تلقائيًا.',
  endedExpired:
    'بلغت هذه الزيارة الحد الأقصى وهو {hours} ساعات لجلسة واحدة وأُغلقت تلقائيًا. لم يعد الموقع يُسجَّل.',
  endedGeneric: 'انتهت هذه الزيارة ولم يعد بالإمكان متابعتها.',
};

export const DICTIONARIES = { en, ar } as const;
export type Locale = keyof typeof DICTIONARIES;
