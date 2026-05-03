from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class BibleBookSeed:
    name: str
    abbreviation: str
    testament: str
    sort_order: int
    aliases: tuple[str, ...] = ()


BIBLE_BOOKS: tuple[BibleBookSeed, ...] = (
    BibleBookSeed("Genesis", "Gen", "old", 1, ("Ge", "Gn")),
    BibleBookSeed("Exodus", "Exod", "old", 2, ("Ex", "Exo")),
    BibleBookSeed("Leviticus", "Lev", "old", 3, ("Le", "Lv")),
    BibleBookSeed("Numbers", "Num", "old", 4, ("Nu", "Nm", "Nb")),
    BibleBookSeed("Deuteronomy", "Deut", "old", 5, ("Dt",)),
    BibleBookSeed("Joshua", "Josh", "old", 6, ("Jos",)),
    BibleBookSeed("Judges", "Judg", "old", 7, ("Jdg", "Jg", "Jdgs")),
    BibleBookSeed("Ruth", "Ruth", "old", 8, ("Ru",)),
    BibleBookSeed("1 Samuel", "1 Sam", "old", 9, ("1Sa", "1Sm", "I Samuel")),
    BibleBookSeed("2 Samuel", "2 Sam", "old", 10, ("2Sa", "2Sm", "II Samuel")),
    BibleBookSeed("1 Kings", "1 Kgs", "old", 11, ("1Ki", "I Kings")),
    BibleBookSeed("2 Kings", "2 Kgs", "old", 12, ("2Ki", "II Kings")),
    BibleBookSeed("1 Chronicles", "1 Chr", "old", 13, ("1Ch", "I Chronicles")),
    BibleBookSeed("2 Chronicles", "2 Chr", "old", 14, ("2Ch", "II Chronicles")),
    BibleBookSeed("Ezra", "Ezra", "old", 15, ("Ezr",)),
    BibleBookSeed("Nehemiah", "Neh", "old", 16, ("Ne",)),
    BibleBookSeed("Esther", "Esth", "old", 17, ("Es",)),
    BibleBookSeed("Job", "Job", "old", 18, ("Jb",)),
    BibleBookSeed("Psalms", "Ps", "old", 19, ("Psa", "Psalm", "Psm")),
    BibleBookSeed("Proverbs", "Prov", "old", 20, ("Pr", "Pro")),
    BibleBookSeed("Ecclesiastes", "Eccl", "old", 21, ("Ecc", "Qoheleth")),
    BibleBookSeed("Song of Solomon", "Song", "old", 22, ("Song of Songs", "SOS", "Canticles")),
    BibleBookSeed("Isaiah", "Isa", "old", 23, ("Is",)),
    BibleBookSeed("Jeremiah", "Jer", "old", 24, ("Je", "Jr")),
    BibleBookSeed("Lamentations", "Lam", "old", 25, ("La",)),
    BibleBookSeed("Ezekiel", "Ezek", "old", 26, ("Eze", "Ezk")),
    BibleBookSeed("Daniel", "Dan", "old", 27, ("Da", "Dn")),
    BibleBookSeed("Hosea", "Hos", "old", 28, ("Ho",)),
    BibleBookSeed("Joel", "Joel", "old", 29, ("Joe", "Jl")),
    BibleBookSeed("Amos", "Amos", "old", 30, ("Am",)),
    BibleBookSeed("Obadiah", "Obad", "old", 31, ("Ob",)),
    BibleBookSeed("Jonah", "Jonah", "old", 32, ("Jon", "Jnh")),
    BibleBookSeed("Micah", "Mic", "old", 33, ("Mc",)),
    BibleBookSeed("Nahum", "Nah", "old", 34, ("Na",)),
    BibleBookSeed("Habakkuk", "Hab", "old", 35, ("Hb",)),
    BibleBookSeed("Zephaniah", "Zeph", "old", 36, ("Zep", "Zp")),
    BibleBookSeed("Haggai", "Hag", "old", 37, ("Hg",)),
    BibleBookSeed("Zechariah", "Zech", "old", 38, ("Zec", "Zc")),
    BibleBookSeed("Malachi", "Mal", "old", 39, ("Ml",)),
    BibleBookSeed("Matthew", "Matt", "new", 40, ("Mt",)),
    BibleBookSeed("Mark", "Mark", "new", 41, ("Mr", "Mrk", "Mk")),
    BibleBookSeed("Luke", "Luke", "new", 42, ("Lk",)),
    BibleBookSeed("John", "John", "new", 43, ("Jn",)),
    BibleBookSeed("Acts", "Acts", "new", 44, ("Ac",)),
    BibleBookSeed("Romans", "Rom", "new", 45, ("Ro", "Rm")),
    BibleBookSeed("1 Corinthians", "1 Cor", "new", 46, ("1Co", "I Corinthians")),
    BibleBookSeed("2 Corinthians", "2 Cor", "new", 47, ("2Co", "II Corinthians")),
    BibleBookSeed("Galatians", "Gal", "new", 48, ("Ga",)),
    BibleBookSeed("Ephesians", "Eph", "new", 49, ("Ep",)),
    BibleBookSeed("Philippians", "Phil", "new", 50, ("Php", "Pp")),
    BibleBookSeed("Colossians", "Col", "new", 51, ("Co",)),
    BibleBookSeed("1 Thessalonians", "1 Thess", "new", 52, ("1Th", "I Thessalonians")),
    BibleBookSeed("2 Thessalonians", "2 Thess", "new", 53, ("2Th", "II Thessalonians")),
    BibleBookSeed("1 Timothy", "1 Tim", "new", 54, ("1Ti", "I Timothy")),
    BibleBookSeed("2 Timothy", "2 Tim", "new", 55, ("2Ti", "II Timothy")),
    BibleBookSeed("Titus", "Titus", "new", 56, ("Tit",)),
    BibleBookSeed("Philemon", "Phlm", "new", 57, ("Phm",)),
    BibleBookSeed("Hebrews", "Heb", "new", 58, ("He",)),
    BibleBookSeed("James", "Jas", "new", 59, ("Jm",)),
    BibleBookSeed("1 Peter", "1 Pet", "new", 60, ("1Pe", "I Peter")),
    BibleBookSeed("2 Peter", "2 Pet", "new", 61, ("2Pe", "II Peter")),
    BibleBookSeed("1 John", "1 John", "new", 62, ("1Jn", "I John")),
    BibleBookSeed("2 John", "2 John", "new", 63, ("2Jn", "II John")),
    BibleBookSeed("3 John", "3 John", "new", 64, ("3Jn", "III John")),
    BibleBookSeed("Jude", "Jude", "new", 65, ("Jud",)),
    BibleBookSeed("Revelation", "Rev", "new", 66, ("Re", "The Revelation")),
)

BOOK_LOOKUP = {
    alias.lower(): book.name
    for book in BIBLE_BOOKS
    for alias in (book.name, book.abbreviation, *book.aliases)
}


def normalize_book_name(raw: str) -> str | None:
    return BOOK_LOOKUP.get(" ".join(raw.lower().split()))
