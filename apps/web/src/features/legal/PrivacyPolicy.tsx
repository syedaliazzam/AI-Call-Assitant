/**
 * File: apps/web/src/features/legal/PrivacyPolicy.tsx
 * Purpose: The public privacy policy (/privacy), in short plain words: what Paramount AI stores, what
 *          Google Drive saving can see and do (drive.file only), what the "call saved" email holds, who
 *          else handles data, and whom to contact. Google's OAuth consent screen links here. Keep it in
 *          step with how the app works (ADR-0049 encryption, ADR-0072 Drive and email, ADR-0095 Groq and
 *          ADR-0099 Google's Gemini and OpenAI as answer providers).
 * Used by: app/privacy/page.tsx
 * Depends on: ./LegalPage.tsx
 * Architecture: ADR-0049 (encrypted call records), ADR-0072 (Google Drive saving, the saved email),
 *               ADR-0095 and ADR-0099 (the answer providers)
 */
import { ContactLink, LegalPage, LegalSection } from './LegalPage';

/**
 * The privacy policy page.
 *
 * @returns The page.
 * Rendered by: app/privacy/page.tsx
 */
export function PrivacyPolicy() {
  return (
    <LegalPage title="Privacy policy">
      <LegalSection title="About Paramount AI">
        <p>
          Paramount AI is an internal call assistant of Paramount Intelligence, for its staff and
          authorised users. This page explains what it stores and why.
        </p>
      </LegalSection>

      <LegalSection title="What we store">
        <ul>
          <li>
            <strong>Your account:</strong> your name, email address, sign-in sessions and a daily
            count of requests (numbers only, never text).
          </li>
          <li>
            <strong>Your call records and settings:</strong> sessions, transcripts, answers and
            notes, and your preferences. Call records kept in your account are encrypted.
          </li>
          <li>
            <strong>Recordings</strong> stay on your computer. They leave it only if you turn on
            Google Drive saving, which uploads them to the Drive folder you choose.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Speech to text">
        <p>
          During a call, both your microphone and the other side&apos;s audio are streamed to
          Deepgram, Inc. to turn speech into text. Deepgram returns the text and does not keep the
          audio (we opt out of Deepgram&apos;s model improvement program). Audio is never stored by
          Paramount AI. If Deepgram cannot be reached, speech is turned into text on your computer.
          Cloud transcription is being turned on account by account; until it is on for yours,
          speech is turned into text on your computer only.
        </p>
      </LegalSection>

      <LegalSection title="Answers and notes">
        <p>
          To write answers and notes, the relevant transcript and document text (and any screenshot
          you ask about) is sent to Anthropic&apos;s Claude API. When a session is set to another
          answer model, its live answers (and, for Gemini and GPT models, its screenshots) go to
          that model&apos;s provider instead: Google (Gemini API), OpenAI (OpenAI API) or Groq. If
          that provider cannot answer quickly, the same request goes to Claude. Notes and Ask AI
          always use Claude. Call audio is never sent to any of these providers.
        </p>
      </LegalSection>

      <LegalSection title="Google Drive">
        <ul>
          <li>
            Paramount AI asks Google only for the <code>drive.file</code> permission. It can see
            only the files it creates and the folder you pick, not the rest of your Drive.
          </li>
          <li>It uploads only your own recordings, transcripts and notes, to that folder.</li>
          <li>The Google token that lets it upload for you is stored encrypted.</li>
          <li>
            You can disconnect at any time in Settings → Google Drive. Disconnecting revokes the
            access at Google and deletes the token. You can also remove it in your Google Account
            under Security → Third-party connections.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Email">
        <p>
          The &ldquo;call saved&rdquo; email holds only the session&apos;s title, date and length,
          the saved files&apos; names and links to them in Drive. It never contains transcript,
          notes, answer or document text. It goes to you and to anyone you add to its list.
        </p>
      </LegalSection>

      <LegalSection title="Sharing">
        <p>
          We don&apos;t sell your data or share it with anyone. The only other services that handle
          it are the ones that do the work described above: our hosting and database providers,
          Deepgram (speech to text), Anthropic&apos;s Claude API, the other answer providers (Google
          Gemini API, OpenAI API and Groq) when a session uses one of their models, and Google Drive
          when you turn it on.
        </p>
      </LegalSection>

      <LegalSection title="Contact">
        <p>
          Questions, or a request to see or delete your data: <ContactLink />.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
