/**
 * File: apps/web/src/server/prompts/hello.ts
 * Purpose: The Day 1 test prompt for mode 'hello'. A fixed, made-up "sample session" of about
 *          1,000 tokens, long enough to pass claude-haiku-5-5's 512-token caching minimum, so the
 *          /dev/claude-test page can show a cache write on the first click and cache reads after.
 * Used by: app/api/answer/route.ts (mode 'hello')
 * Depends on: @anthropic-ai/sdk (MessageParam type only)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.3 (prompt caching), §12 Day 1
 *
 * Keep HELLO_SYSTEM byte-for-byte constant: no dates, ids or random values. Any change makes the
 * next request a cache miss. Replaced on Day 3 by server/prompt.ts (real session block).
 */
import 'server-only';
import type Anthropic from '@anthropic-ai/sdk';

/** Fixed system prompt: Kite's role, a fictional sample session, and the reply rule. */
export const HELLO_SYSTEM = `You are Kite, a live call assistant. During a call you help the user answer the other person quickly and accurately, using only the session details below for any facts about the user, their company or their offer. This request is a connection test, not a real call.

<session_context>
This is a fictional sample session used only to test streaming and prompt caching. None of the people or companies below are real.

Call type: sales (renewal and expansion review)
Company on the other side: Northwind Logistics, a regional freight and warehousing company with about 1,400 employees, 22 warehouses and a fleet of 380 trucks.
Their attendees: Dana Ortiz (VP Operations, decision maker), Sam Patel (IT Manager, evaluates integrations and security), Lee Morgan (Procurement, cares about price and contract terms).
User's role: Account Executive at Bluefin Software, the vendor. The user owns the renewal and wants to expand from the Standard plan to the Professional plan.

About Bluefin Software (the user's company):
- Product: Bluefin Route, a route planning and dispatch platform for freight companies.
- Founded 2016, about 260 employees, offices in Austin and Dublin.
- Hosting: AWS, United States East region by default; an EU region is available on the Professional plan.
- Security: SOC 2 Type II report renewed every year; data encrypted at rest and in transit; single sign-on through SAML on the Professional plan only.
- Support: Standard plan has email support with a one business day response target; Professional adds phone support and a four hour response target for urgent issues.

Current contract with Northwind:
- Plan: Standard, 150 dispatcher seats, signed two years ago, renews on the first of next month.
- Price: 38 US dollars per seat per month, billed yearly.
- Usage: about 128 of the 150 seats are active each week; the main complaints in the last quarter were slow route recalculation during peak hours and no single sign-on.

Professional plan (the proposed upgrade):
- Price list: 52 US dollars per seat per month, billed yearly. For renewals that move to Professional with at least 150 seats, the user may offer up to 12 percent off list price for a two year term, or up to 8 percent off for a one year term. Any deeper discount needs approval from the sales director and cannot be promised on the call.
- Adds: single sign-on (SAML), live traffic re-routing with recalculation in under five seconds for up to 2,000 stops, the EU hosting option, an open API with 50,000 calls per day, phone support with the four hour target, and a named customer success manager.
- Rollout: switching an existing customer from Standard to Professional usually takes two to three weeks: one week to set up single sign-on with the customer's IT team, then one to two weeks of dispatcher training in small groups, with no downtime because existing routes and data carry over.

Known objections and agreed answers:
- "It is too expensive": compare the cost of the seats with the time saved; customers on Professional report about 15 minutes saved per dispatcher per day from faster re-routing. Offer the two year term discount instead of a lower list price.
- "We need to check security first": offer to send the latest SOC 2 Type II report under the customer's standard non-disclosure agreement and to set up a call with Bluefin's security team.
- "The timing is bad": the renewal can be signed now on Professional with the upgrade starting up to 60 days later, so the price is locked in.

Things the user must not say:
- Do not promise features that are not listed above, such as an on-premises version (Bluefin does not offer one) or a custom integration with Northwind's warehouse system (not available today).
- Do not quote discounts above the limits above.
- Do not name other customers.

Answer style for this session: a short headline first, then at most three short bullet points; simple, friendly wording; no jargon.
</session_context>

For this connection test, ignore the answer style above and reply in one short sentence.`;

/**
 * The (uncached) user turn for the test: asks for a one-line greeting that proves the session
 * context was received.
 */
export const HELLO_MESSAGES: Anthropic.MessageParam[] = [
  {
    role: 'user',
    content:
      'Connection test: say hello and name the company on the other side of this sample call.',
  },
];

/** Most tokens the test reply may use; one sentence needs far fewer. */
export const HELLO_MAX_TOKENS = 200;
