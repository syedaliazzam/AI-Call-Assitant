# ADR-0093: The other person's name instead of "Them"

- **Status:** Accepted
- **Date:** 2026-11-16
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §5, §6.3, §7.2, §7.4 (version 4.33.0)
- **Supersedes / superseded by:** extends ADR-0041 (the session's `contactName`, display only until now) and v1.3.2's rename on the session page.

## Context

The other side of a call was labelled "Them" almost everywhere: the transcript, the overlay, Claude's prompts, the notes and the files saved to Drive. A session could hold the contact's name, but only the transcript bubbles showed it. Claude, the notes, the Drive PDFs and the emails never saw it. The developer asked for:

- the real name wherever "Them" appears;
- a one-click offer when the person introduces themselves;
- "Interviewer" as the fallback for interviews;
- a per-call rename on the session page that also updates the call's Drive PDFs.

## Decision

**1. The label.** `core/transcript/theirName.ts` decides the label for one call:

- the call's own name (`StoredCall.themName`, new, synced with the call);
- else the session's `contactName`;
- else "Interviewer" (interview and mock-interview sessions) or "Them" (other calls).

Names are cleaned by `cleanPersonName()` in `@kite/shared`:

- letters, spaces, apostrophes, hyphens and dots only, at most 60 characters;
- "You", "Them" and "Interviewer" are not names.

The user's own turns keep the account's display name.

**2. Where the label appears:**

- the live transcript, the call window's audio meter and the overlay (`CompactState.themName`);
- the session page's Conversation and its TXT and PDF downloads;
- the recording player;
- the Drive transcript PDF and notes PDF ("With Sarah", "Questions from Sarah");
- the "Call saved" and "Recording saved" emails ("With: Sarah"; a real name only, never a fallback);
- Claude's prompts (point 3).

**3. Claude.** With a real name, `SessionContext.themName` is sent (cleaned again on the server):

- the other person's transcript lines are labelled with the name instead of "Them", in the answer prompt and in the notes and Ask AI call record;
- the session block gains one line: `The other person ("Them" in these rules) is Sarah: their lines are labelled "Sarah".`

Without a name, nothing is sent and every prompt is byte for byte what it was. The "Interviewer" fallback is display only, so existing sessions' prompts and cache entries do not change. A rename during a call changes the cached blocks once.

**4. Detection during the call.** While no name is known:

- each final line of the other person is read once, again when more words are merged into it, by `detectIntroducedName()`. It finds "I'm Sarah…", "I am…", "my name is…" and "this is / it's Sarah from / here / speaking / calling / with…". After a greeting, "this is Sarah." also counts;
- the name must be capitalised (cloud transcription capitalises names);
- listed words are never names: "I'm sure", "I'm good", "I'm from…", "I'm the…", nationalities, days and greetings;
- the user's own name and the company are skipped.

The call window and the overlay's status bar then offer "Rename Them to Sarah?" (or "Rename Interviewer to Sarah?") with **Rename** and **Not now**:

- nothing is renamed by itself;
- Rename applies the name to the rest of the call and saves it on the call's record;
- a declined name is not offered again in that call.

**5. Deepgram keyterms.** A name accepted during the call goes first in the call's keyterms (`withNameKeyterm()`, within the 100-term and 1,500-character limits). The change is sent with `Configure`, as other keyterm changes are (ADR-0078). The session's contact name was already a keyterm (ADR-0079).

**6. Rename on the session page.** Clicking the name in Conversation renames the other person for the shown call, the whole call:

- the call record keeps it; a call made before call records renames the session's contact, as before;
- the notes are shown with the new name in place of the name they were written with (`StoredCallNotes.writtenTheirName`, else "Them"). There is no new notes request; only **Rewrite notes** (the old "Regenerate", renamed) asks Claude again;
- when the call's Drive upload is done, its transcript PDF and notes PDF are made again and replace the saved copies (`core/drive/renamedCall.ts`, `POST /api/drive/files` with `replace=1`). The new copy is uploaded and verified first; only then does the old one go to the bin. An upload that has not finished makes its files with the new name anyway.

## Consequences

- Answers and notes can say who asked what by name.
- Prompts with a name differ from those without. Calls with no name keep their prompts and cache entries.
- Notes written before a rename keep their wording; only the label word is swapped. A notes sentence that used the old name as an ordinary word would also change.
- No new desktop release: the shell is not involved.

## Alternatives considered

- **Rename automatically when a name is heard.** Rejected: the developer asked for one click, never automatic; false names are possible.
- **Write the notes again after a rename.** Rejected: it is a paid request. Swapping the label gives the same result for the label and costs nothing.
- **Send "Interviewer" to Claude when there is no name.** Rejected: it would change every interview prompt (and its cache) for no new information.

## Validation

- Unit tests:
  - the label rules and fallbacks;
  - name cleaning;
  - detection, including false-name cases;
  - the prompt with and without a name (without: unchanged);
  - the notes record's label;
  - the overlay offer and its commands;
  - the keyterm;
  - the Drive replace on the server;
  - the renamed call's PDFs;
  - the email's "With" row.
- Visual rig (page screenshots): the offer in the call window and the overlay, Rename, and the session page rename.
- Evaluation: no paid evaluation was run. Prompts without a name are unchanged, so no baseline moves. A targeted check of named calls (`answers` group with a contact name) is offered to the developer with its cost estimate.
