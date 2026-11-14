/**
 * File: apps/web/tests/integration/harness/screens.tsx
 * Purpose: Browser side of the restyled screens test (spec S17): the real Settings, Review, libraries, Ask
 *          AI, Mock Interview, Question Bank, Admin, sign-in, change password, error screens and the
 *          acceptable-use notice, with no sign-in, on this browser's real IndexedDB. Chosen by
 *          ?screen=…; ?theme=dark paints the dark theme.
 * Used by: apps/web/tests/integration/screens.spec.ts
 * Depends on: src/features (settings, review, library, ask-kite, prepare, admin, auth, notices, shell),
 *             src/core/storage, src/ui
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S17)
 *
 * All text is invented.
 */
import { createRoot } from 'react-dom/client';
import type { ReactNode } from 'react';
import { saveAnswer } from '@/core/storage/answers';
import { addLibraryItem } from '@/core/storage/library';
import { saveNotes } from '@/core/storage/notes';
import { createSession } from '@/core/storage/sessions';
import type { SessionType } from '@/core/storage/types';
import { saveUtterance } from '@/core/storage/utterances';
import type { AdminActionResult, AdminUserActions } from '@/features/admin/types';
import { UsersPage } from '@/features/admin/UsersPage';
import { AskKitePage } from '@/features/ask-kite/AskKitePage';
import { ChangePasswordForm } from '@/features/auth/ChangePasswordForm';
import { DesktopAppLink } from '@/features/auth/DesktopAppLink';
import { LoginForm } from '@/features/auth/LoginForm';
import { SignInHero } from '@/features/auth/SignInHero';
import { LibraryPage } from '@/features/library/LibraryPage';
import { LiveCallsUnsupported } from '@/features/live/LiveCallsUnsupported';
import { AcceptableUseNotice } from '@/features/notices/AcceptableUseNotice';
import { MockInterview } from '@/features/prepare/MockInterview';
import { QuestionBank } from '@/features/prepare/QuestionBank';
import { SessionReview } from '@/features/review/SessionReview';
import { Settings } from '@/features/settings/Settings';
import { AppShell } from '@/features/shell/AppShell';
import { AuthCard } from '@/ui/AuthCard';
import { Button } from '@/ui/Button';
import { ErrorScreen } from '@/ui/ErrorScreen';
import { LinkButton } from '@/ui/LinkButton';
import { PageShell } from '@/ui/PageShell';

const params = new URLSearchParams(window.location.search);

if (params.get('theme') === 'dark') document.documentElement.setAttribute('data-theme', 'dark');

/** When the invented call started. */
const CALL_START = Date.now() - 3_600_000;

/**
 * Stores an invented ended call, with its transcript, answers and notes.
 *
 * @param type The session's type.
 * @returns The session's id.
 * Called from: start()
 */
async function seedCall(type: SessionType): Promise<string> {
  const session = await createSession(
    {
      type,
      company: 'Northwind Logistics (invented)',
      role: 'Renewal call',
      description: 'Renewal and expansion to the dispatch team.',
      preferences: {
        language: 'en',
        model: 'fast',
        style: { format: 'headline+bullets', length: 'short', tone: 'simple' },
        keyTerms: '',
      },
      instructions: '',
      saveTranscript: true,
      autoAnswer: false,
    },
    CALL_START - 60_000,
  );
  const lines: ['you' | 'them', string, number][] = [
    ['you', 'THANKS FOR JOINING LET US TALK ABOUT THE RENEWAL', 5],
    ['them', 'WE WANT TO MOVE ABOUT FORTY SEATS TO PROFESSIONAL', 12],
    ['them', 'WHAT WOULD THAT COST', 24],
    ['you', 'FIFTY TWO DOLLARS PER SEAT PER MONTH BILLED YEARLY', 40],
  ];
  for (const [i, [speaker, text, at]] of lines.entries()) {
    await saveUtterance({
      id: `${session.id}-l${i}`,
      sessionId: session.id,
      speaker,
      text,
      tStart: CALL_START + at * 1_000,
      tEnd: CALL_START + at * 1_000 + 2_000,
    });
  }
  await saveAnswer({
    id: `${session.id}-a1`,
    sessionId: session.id,
    mode: 'answer',
    question: 'What would that cost?',
    text: 'Forty seats cost 2,080 dollars a month.\n- 52 dollars per seat\n- Billed yearly',
    model: 'fast',
    msFirstToken: 700,
    msTotal: 1_400,
    createdAt: CALL_START + 26_000,
    rating: 'up',
    note: '',
  });
  await saveNotes({
    sessionId: session.id,
    callStartedAt: CALL_START,
    createdAt: CALL_START + 200_000,
    fromAnswersOnly: false,
    notes: {
      summary: ['The team wants forty seats on Professional.', 'Price given: 52 dollars per seat.'],
      questions: [{ question: 'What would that cost?', at: 24, answered: 'yes', rating: 'up' }],
      nextSteps: [{ step: 'Send the proposal by Monday', owner: 'You' }],
      unclear: [],
      lessons: [],
    },
  });
  return session.id;
}

/** The invented accounts on the Users page. */
const USERS = [
  {
    id: 'u1',
    name: 'Sam Lee',
    email: 'sam.lee@example.com',
    role: 'admin' as const,
    disabled: false,
    mustChangePassword: false,
    createdAt: new Date(Date.UTC(2026, 9, 1)),
    lastActiveAt: new Date(Date.UTC(2026, 10, 14, 9)),
  },
  {
    id: 'u2',
    name: 'Dana Okafor',
    email: 'dana.okafor@example.com',
    role: 'user' as const,
    disabled: false,
    mustChangePassword: true,
    createdAt: new Date(Date.UTC(2026, 9, 20)),
    lastActiveAt: null,
  },
  {
    id: 'u3',
    name: 'Ravi Menon',
    email: 'ravi.menon@example.com',
    role: 'user' as const,
    disabled: true,
    mustChangePassword: false,
    createdAt: new Date(Date.UTC(2026, 8, 3)),
    lastActiveAt: new Date(Date.UTC(2026, 9, 2)),
  },
  {
    id: 'u4',
    name: 'Ana Ruiz',
    email: 'ana.ruiz@example.com',
    role: 'admin' as const,
    disabled: false,
    mustChangePassword: false,
    createdAt: new Date(Date.UTC(2026, 10, 12)),
    lastActiveAt: new Date(Date.UTC(2026, 10, 13)),
  },
];

/** What the Users page asked the fake server for, read by screens.spec.ts. */
const adminCalls: string[] = [];
(window as unknown as { kiteAdminCalls: string[] }).kiteAdminCalls = adminCalls;

/**
 * A fake server action's answer: ?fail=1 makes every action fail, as the server does.
 *
 * @param call  What was asked, recorded for the test.
 * @param extra More fields for a success.
 * @returns The result.
 */
function fakeResult(call: string, extra: { temporaryPassword?: string } = {}): AdminActionResult {
  adminCalls.push(call);
  return params.get('fail') === '1'
    ? { ok: false, error: 'Something went wrong. Please try again.' }
    : { ok: true, ...extra };
}

/** Stand-ins for the server actions in app/(app)/admin/users/actions.ts. */
const ADMIN_ACTIONS: AdminUserActions = {
  createUser: async (_previous, formData) => {
    adminCalls.push(`create:${String(formData.get('role'))}`);
    return {
      status: 'created',
      email: String(formData.get('email')),
      temporaryPassword: 'Harness-Temp-2',
    };
  },
  resetPassword: async (userId) =>
    fakeResult(`reset:${userId}`, { temporaryPassword: 'Harness-Temp-1' }),
  setDisabled: async (userId, disabled) => fakeResult(`disabled:${userId}:${disabled}`),
  setRole: async (userId, role) => fakeResult(`role:${userId}:${role}`),
};

/**
 * A screen inside the app's real shell.
 *
 * @param props.children The screen.
 * @returns The shell around it.
 * Rendered by: start()
 */
function InShell({
  children,
}: {
  /** The screen. */
  children: ReactNode;
}) {
  return (
    <AppShell user={{ name: 'Sam Lee', email: 'sam.lee@example.com', role: 'admin' }}>
      {children}
    </AppShell>
  );
}

/**
 * Stores what the screen needs, and shows it.
 *
 * @returns Resolves when it is shown.
 */
async function start(): Promise<void> {
  const screen = params.get('screen') ?? 'settings';
  const root = createRoot(document.getElementById('root')!);
  if (['resumes', 'documents', 'ask'].includes(screen)) {
    await addLibraryItem('resume', 'invented-cv.txt', 'Sam Okafor, frontend engineer, 5 years.');
    await addLibraryItem('document', 'price-list.txt', 'Professional plan: 52 dollars per seat.');
  }
  const callId = ['review', 'mock', 'bank', 'ask'].includes(screen)
    ? await seedCall(screen === 'review' ? 'regular' : 'interview')
    : '';
  const views: Record<string, () => ReactNode> = {
    settings: () => (
      <InShell>
        <Settings isAdmin />
      </InShell>
    ),
    review: () => (
      <InShell>
        <SessionReview sessionId={callId} onDeleted={() => undefined} />
      </InShell>
    ),
    resumes: () => (
      <InShell>
        <LibraryPage kind="resume" />
      </InShell>
    ),
    documents: () => (
      <InShell>
        <LibraryPage kind="document" />
      </InShell>
    ),
    ask: () => (
      <InShell>
        <AskKitePage />
      </InShell>
    ),
    mock: () => (
      <InShell>
        <MockInterview />
      </InShell>
    ),
    bank: () => (
      <InShell>
        <QuestionBank />
      </InShell>
    ),
    admin: () => (
      <InShell>
        <PageShell title="Users" width="lg">
          <UsersPage users={USERS} currentUserId="u1" actions={ADMIN_ACTIONS} />
        </PageShell>
      </InShell>
    ),
    login: () => (
      <AuthCard
        title="Sign in to Paramount AI"
        subtitle="Use the email and password your admin gave you."
        hero={<SignInHero />}
        footer={<DesktopAppLink />}
      >
        <LoginForm />
      </AuthCard>
    ),
    'change-password': () => (
      <AuthCard
        title="Choose a new password"
        subtitle="You are using a temporary password. Choose your own to continue."
        hero={<SignInHero />}
      >
        <ChangePasswordForm action={async () => ({})} />
      </AuthCard>
    ),
    'not-found': () => (
      <ErrorScreen
        title="Page not found"
        action={<LinkButton href="/">Back to dashboard</LinkButton>}
      >
        <p>This address does not lead anywhere in Paramount AI.</p>
      </ErrorScreen>
    ),
    error: () => (
      <ErrorScreen title="Something went wrong" action={<Button>Try again</Button>}>
        <p>This page could not be shown. Your sessions are safe on this computer.</p>
      </ErrorScreen>
    ),
    unsupported: () => <LiveCallsUnsupported />,
    notice: () => (
      <InShell>
        <AcceptableUseNotice />
        <PageShell title="Sessions">
          <p>Sessions appear here.</p>
        </PageShell>
      </InShell>
    ),
  };
  root.render(views[screen]!());
}

void start();
