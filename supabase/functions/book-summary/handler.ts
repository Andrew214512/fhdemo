// Writes the short "About this book" note on a book's page, with Claude.
//   { isbn: "978..." } → { summary: "..." }, or { summary: null } when there isn't one
// Each book gets one summary. It's written the first time someone opens the book and saved,
// so everyone sees the same text and each book costs about a cent, once.
//
// Staying clear of copyright: Claude gets only the title, author and year, never the book's
// text or its publisher's description, and writes two or three sentences of its own about
// what the book is about. No quotes, no spoilers. If it doesn't know the book, it says so and
// the page simply shows no summary.
import Anthropic from "npm:@anthropic-ai/sdk@0.133.0";
import { endpoint, HttpError, json, readJson } from "../_shared/http.ts";
import { adminClient, dbError, rateLimit, requireUser } from "../_shared/supabase.ts";

const MODEL = "claude-opus-5-5";
// How long to wait before asking again about a book the model didn't know.
const RETRY_UNKNOWN_MS = 30 * 24 * 60 * 60 * 1000;

const SYSTEM = `You write the short "About this book" note in Wormy, an app where readers swap used books.

Write two or three sentences, under 70 words, in your own words: what the book is about and what kind of read it is.
- Describe it from what is generally known about it. Never quote the book, and never reuse wording from its jacket copy, publisher description or reviews.
- No spoilers. Stay with the opening premise.
- Plain and specific. No title line, no rating, no preamble.
- If you aren't confident which book this is, or don't know enough about it to describe it accurately, reply with exactly UNKNOWN and nothing else.`;

type BookRow = { isbn: string; title: string; author: string; year: number | null; summary: string | null; checkedAt: number | null };

export const handler = endpoint(async (req) => {
  const { user } = await requireUser(req);
  const { isbn } = await readJson<{ isbn?: string }>(req);
  if (!/^97[89]\d{10}$/.test(String(isbn ?? ""))) throw new HttpError(400, "Send a 13-digit ISBN.");

  const admin = adminClient();
  const { data, error } = await admin.rpc("get_book_summary", { p_isbn: isbn });
  dbError(error);
  const book = data as BookRow | null;
  if (!book) throw new HttpError(404, "We don't have that book yet.");
  if (book.summary) return json(req, { summary: book.summary });
  if (book.checkedAt && Date.now() - book.checkedAt < RETRY_UNKNOWN_MS) return json(req, { summary: null });
  // Summaries are optional: without a key, book pages just don't show one.
  if (!Deno.env.get("ANTHROPIC_API_KEY")) return json(req, { summary: null });

  await rateLimit(user.id, "summary");
  const written = await write(book);
  if (written === undefined) return json(req, { summary: null }); // couldn't answer now; the next visit tries again
  const saved = await admin.rpc("set_book_summary", { p_isbn: isbn, p_summary: written ?? "", p_model: MODEL });
  dbError(saved.error);
  return json(req, { summary: (saved.data as BookRow).summary });
});

// The summary; null when the model doesn't know the book; undefined when it couldn't answer right now.
async function write(book: BookRow): Promise<string | null | undefined> {
  const client = new Anthropic();
  let res: Anthropic.Beta.BetaMessage;
  try {
    res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: "low" },
      // If a safety check declines, the API retries on the model it recommends for that case.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      messages: [{
        role: "user",
        content: [`Title: ${book.title}`, `Author: ${book.author}`, book.year ? `First published: ${book.year}` : "", `ISBN: ${book.isbn}`]
          .filter(Boolean).join("\n"),
      }],
    });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError || e instanceof Anthropic.InternalServerError || e instanceof Anthropic.APIConnectionError) {
      console.error("book-summary: Claude unavailable", e.message);
      return undefined;
    }
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
      console.error("book-summary: check ANTHROPIC_API_KEY", e.message);
      return undefined;
    }
    throw e;
  }
  if (res.stop_reason !== "end_turn") return undefined;
  const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").replace(/\s+/g, " ").trim();
  if (!text || /^UNKNOWN\b/.test(text) || text.length < 40) return null;
  return trimToSentence(text.replace(/^["“]|["”]$/g, ""), 600);
}

// Keeps the note short, ending on a full sentence.
function trimToSentence(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return end > 0 ? cut.slice(0, end + 1) : cut.trimEnd() + "…";
}
