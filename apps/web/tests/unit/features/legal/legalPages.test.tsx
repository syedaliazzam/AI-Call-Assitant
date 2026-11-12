/**
 * Tests for apps/web/src/features/legal (PrivacyPolicy.tsx, TermsOfUse.tsx, LegalPage.tsx), as the server
 * renders them: each page has its title, a "Last updated" date and the contact mail link; the privacy
 * policy names the drive.file permission, disconnecting, and what the saved email holds; the terms show
 * the consent checkbox's words and the in-app acceptable-use notice word for word; both link to each other.
 */
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LEGAL_CONTACT_EMAIL, LEGAL_LAST_UPDATED, LegalLinks } from '@/features/legal/LegalPage';
import { PrivacyPolicy } from '@/features/legal/PrivacyPolicy';
import { TermsOfUse } from '@/features/legal/TermsOfUse';
import { ACCEPTABLE_USE_TEXT } from '@/features/notices/acceptableUseText';

/**
 * Turns rendered HTML into its visible text (tags removed, entities and spaces normalised).
 * @param html The HTML.
 * @returns The text.
 */
function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

describe.each([
  ['privacy', PrivacyPolicy, 'Privacy policy'],
  ['terms', TermsOfUse, 'Terms of use'],
] as const)('the %s page', (_name, Page, title) => {
  const html = renderToString(<Page />);

  it('has its title, the last-updated date and the contact mail link', () => {
    expect(html).toMatch(new RegExp(`<h1[^>]*>${title}</h1>`));
    expect(textOf(html)).toContain(`Last updated ${LEGAL_LAST_UPDATED}`);
    expect(html).toContain(`href="mailto:${LEGAL_CONTACT_EMAIL}"`);
  });

  it('links to both pages and back to the app', () => {
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/terms"');
    expect(html).toContain('href="/"');
  });
});

describe('PrivacyPolicy', () => {
  const text = textOf(renderToString(<PrivacyPolicy />));

  it('names the drive.file permission, encryption and disconnecting', () => {
    expect(text).toContain('drive.file');
    expect(text).toContain('stored encrypted');
    expect(text).toContain('Settings → Google Drive');
  });

  it('says the saved email never holds transcript text, and that data is not sold', () => {
    expect(text).toContain('never contains transcript');
    expect(text).toContain("We don't sell your data");
  });
});

describe('TermsOfUse', () => {
  const text = textOf(renderToString(<TermsOfUse />));

  it("shows the consent checkbox's words and the acceptable-use notice word for word", () => {
    expect(text).toContain('Everyone on the call has agreed to be recorded');
    expect(text).toContain(ACCEPTABLE_USE_TEXT);
    expect(text).toContain('access being removed');
  });
});

describe('LegalLinks', () => {
  it('links the privacy policy and terms of use', () => {
    const html = renderToString(<LegalLinks />);
    expect(html).toMatch(/href="\/privacy"[^>]*>Privacy policy</);
    expect(html).toMatch(/href="\/terms"[^>]*>Terms of use</);
  });
});
