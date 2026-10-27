// Looks books up so readers never type titles by hand.
//   { isbn: "978..." }  → finds the book (Open Library, then Google Books), saves it, returns it
//   { q: "piranesi" }   → returns up to 12 matches to pick from (nothing is saved)
// Only this server function writes book titles, so one reader can't rename a
// book for everyone else.
import { endpoint, HttpError, json, readJson } from "../_shared/http.ts";
import { adminClient, dbError, requireUser } from "../_shared/supabase.ts";

type Book = { isbn: string; title: string; author: string; year: number | null; genre: string | null; cover: string | null };
// A lookup service that's down or rate-limiting us, as opposed to one that answered "no such book".
const UNAVAILABLE = Symbol("unavailable");
type Lookup = Book | null | typeof UNAVAILABLE;

const GENRES: [RegExp, string][] = [
  [/science fiction|fantasy|dystopia|speculative/i, "Sci-fi & Fantasy"],
  [/mystery|thriller|crime|detective|suspense/i, "Mystery"],
  [/romance|love stor/i, "Romance"],
  [/historical/i, "Historical"],
  [/biography|memoir|history|science|self-help|business|nature|psychology|philosophy|essays|cooking|travel|politics/i, "Nonfiction"],
  [/fiction|literary|novel/i, "Literary"],
];
const genreOf = (subjects: string[]) => {
  const text = subjects.join(" | ");
  return GENRES.find(([re]) => re.test(text))?.[1] ?? null;
};

// Accepts ISBN-10 or ISBN-13 (spaces and dashes are fine). Returns a checked ISBN-13 or null.
export function toIsbn13(raw: string): string | null {
  const s = String(raw ?? "").toUpperCase().replace(/[^0-9X]/g, "");
  if (/^\d{9}[\dX]$/.test(s)) {
    const sum = [...s].reduce((acc, ch, i) => acc + (ch === "X" ? 10 : Number(ch)) * (10 - i), 0);
    if (sum % 11 !== 0) return null;
    const body = "978" + s.slice(0, 9);
    return body + check13(body);
  }
  if (/^97[89]\d{10}$/.test(s)) return check13(s.slice(0, 12)) === s[12] ? s : null;
  return null;
}
function check13(twelve: string): string {
  const sum = [...twelve].reduce((acc, ch, i) => acc + Number(ch) * (i % 2 ? 3 : 1), 0);
  return String((10 - (sum % 10)) % 10);
}

const httpsOnly = (u?: string | null) => (u ? u.replace(/^http:\/\//, "https://") : null);
const yearOf = (s?: string) => {
  const m = String(s ?? "").match(/\d{4}/);
  return m ? Number(m[0]) : null;
};

async function fromOpenLibrary(isbn: string): Promise<Lookup> {
  try {
    const res = await fetch(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return UNAVAILABLE;
    const d = (await res.json())[`ISBN:${isbn}`];
    if (!d?.title) return null;
    return {
      isbn,
      title: d.title,
      author: (d.authors ?? []).map((a: { name: string }) => a.name).join(", ") || "Unknown author",
      year: yearOf(d.publish_date),
      genre: genreOf((d.subjects ?? []).map((x: { name: string }) => x.name)),
      cover: d.cover?.medium ? httpsOnly(d.cover.medium) : null,
    };
  } catch {
    return UNAVAILABLE;
  }
}

function googleKey() {
  const k = Deno.env.get("GOOGLE_BOOKS_API_KEY");
  return k ? `&key=${encodeURIComponent(k)}` : "";
}

type GoogleVolume = {
  volumeInfo: {
    title?: string; subtitle?: string; authors?: string[]; publishedDate?: string; categories?: string[];
    industryIdentifiers?: { type: string; identifier: string }[]; imageLinks?: { thumbnail?: string };
  };
};
function fromGoogleVolume(v: GoogleVolume, isbn?: string): Book | null {
  const info = v.volumeInfo ?? {};
  const id13 = isbn ?? info.industryIdentifiers?.find((x) => x.type === "ISBN_13")?.identifier;
  if (!id13 || !toIsbn13(id13) || !info.title) return null;
  return {
    isbn: toIsbn13(id13)!,
    title: info.title,
    author: (info.authors ?? []).join(", ") || "Unknown author",
    year: yearOf(info.publishedDate),
    genre: genreOf(info.categories ?? []),
    cover: httpsOnly(info.imageLinks?.thumbnail),
  };
}

async function fromGoogle(isbn: string): Promise<Lookup> {
  try {
    const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&maxResults=1${googleKey()}`, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) {
      console.warn("Google Books lookup failed", res.status);
      return UNAVAILABLE;
    }
    const item = (await res.json()).items?.[0];
    return item ? fromGoogleVolume(item, isbn) : null;
  } catch {
    return UNAVAILABLE;
  }
}

async function search(q: string): Promise<Book[] | typeof UNAVAILABLE> {
  try {
    const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=20&printType=books${googleKey()}`, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) {
      console.warn("Google Books search failed", res.status);
      return UNAVAILABLE;
    }
    const seen = new Set<string>();
    const out: Book[] = [];
    for (const item of (await res.json()).items ?? []) {
      const b = fromGoogleVolume(item);
      if (b && !seen.has(b.isbn)) {
        seen.add(b.isbn);
        out.push(b);
      }
    }
    return out.slice(0, 12);
  } catch {
    return UNAVAILABLE;
  }
}

const busy = () => new HttpError(503, "Book lookup is busy right now. Try again in a minute.");

export const handler = endpoint(async (req) => {
  await requireUser(req);
  const body = await readJson<{ isbn?: string; q?: string }>(req);

  if (typeof body.q === "string") {
    const q = body.q.trim();
    if (q.length < 2 || q.length > 100) throw new HttpError(400, "Type at least 2 characters.");
    const results = await search(q);
    if (results === UNAVAILABLE) throw busy();
    return json(req, { results });
  }

  const isbn = toIsbn13(body.isbn ?? "");
  if (!isbn) throw new HttpError(400, "That doesn't look like an ISBN. It's the 10 or 13 digits above the barcode.");
  const admin = adminClient();
  const existing = await admin.rpc("get_book", { p_isbn: isbn });
  dbError(existing.error);
  if (existing.data) return json(req, { book: existing.data });

  const ol = await fromOpenLibrary(isbn);
  const found = ol && ol !== UNAVAILABLE ? ol : await fromGoogle(isbn);
  if (found === UNAVAILABLE || (!found && ol === UNAVAILABLE)) throw busy();
  if (!found) throw new HttpError(404, "We couldn't find that ISBN. Try searching by title instead.");
  const saved = await admin.rpc("upsert_book", {
    p_isbn: found.isbn, p_title: found.title, p_author: found.author, p_year: found.year,
    p_genre: found.genre, p_cover_url: found.cover, p_source: "lookup",
  });
  dbError(saved.error);
  return json(req, { book: saved.data });
});
