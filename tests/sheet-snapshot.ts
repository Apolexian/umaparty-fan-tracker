/**
 * The UmaParty column of the tracking sheet, transcribed from the screenshot
 * dated 2026/08/06. This is ground truth: the numbers the clubs have been
 * running on, produced by a process independent of this codebase.
 *
 * `sheetName` is the name as it appeared in that screenshot. `currentName` is
 * the member's name in the API today. Where they differ, the member renamed —
 * which is the whole evidence base for D004 (identity is `friend_viewer_id`,
 * never name). A name-keyed process silently loses these people.
 *
 * Resolution is by exact match on `currentName` against the club's *current*
 * roster. No fuzzy matching: a loose matcher was tried first and quietly
 * resolved several names to ex-members, which is exactly the class of bug this
 * fixture exists to catch.
 */
export interface SheetEntry {
  /** Rank in the sheet, 1-based. */
  rank: number;
  sheetName: string;
  /** Current API name; equal to sheetName when they never renamed. */
  currentName: string;
  avg: number;
  change: number;
}

export const SHEET_UMAPARTY_20260806: SheetEntry[] = [
  { rank: 1, sheetName: "Haru no Owari", currentName: "Haru no Owari", avg: 15367325, change: 278884 },
  { rank: 2, sheetName: "Jin", currentName: "Jin", avg: 14474373, change: 344851 },
  { rank: 3, sheetName: "Miner", currentName: "Miner", avg: 13044679, change: 57567 },
  { rank: 4, sheetName: "cluegi", currentName: "cluegi", avg: 13020431, change: 109405 },
  { rank: 5, sheetName: "catbmb", currentName: "catbmb", avg: 12881368, change: 117126 },
  { rank: 6, sheetName: "Mallagrim", currentName: "Mallagrim", avg: 12817745, change: 146606 },
  { rank: 7, sheetName: "Sheepy", currentName: "Sheepy", avg: 12595229, change: 831174 },
  { rank: 8, sheetName: "yp loves curren", currentName: "YPurren Chan", avg: 11862799, change: -1187992 },
  { rank: 9, sheetName: "PepegaMagica", currentName: "PepegaMagica", avg: 11846228, change: 9077 },
  { rank: 10, sheetName: "Universeman42", currentName: "Universeman42", avg: 11718752, change: 919969 },
  { rank: 11, sheetName: "Vaan", currentName: "Vaan＠9oft", avg: 11595834, change: 124023 },
  { rank: 12, sheetName: "Hugh Jass", currentName: "Hugh Jass", avg: 11090877, change: 377251 },
  { rank: 13, sheetName: "J＿", currentName: "J＿＠Velocity", avg: 11038997, change: -610845 },
  { rank: 14, sheetName: "Kashou", currentName: "Kashou", avg: 10824088, change: 80562 },
  { rank: 15, sheetName: "rennnnnnnnnnnko", currentName: "rennnnnnnnnnnko", avg: 10487430, change: 123588 },
  { rank: 16, sheetName: "Arthur", currentName: "Arthur", avg: 10047898, change: 482166 },
  { rank: 17, sheetName: "tsol", currentName: "tsol", avg: 10004664, change: 143552 },
  { rank: 18, sheetName: "Kontrol", currentName: "Kontrol", avg: 9469445, change: 225513 },
  { rank: 19, sheetName: "Aclone", currentName: "FineMo＠Aclone", avg: 9353269, change: -1452760 },
  { rank: 20, sheetName: "NINJAT＠VF", currentName: "NINJAT＠VF", avg: 9040934, change: 160784 },
  { rank: 21, sheetName: "vae", currentName: "vae", avg: 8560860, change: 216959 },
  { rank: 22, sheetName: "Apol", currentName: "Apol", avg: 8418038, change: 1084876 },
  { rank: 23, sheetName: "MTG Adept ◎", currentName: "MTG Adept ◎", avg: 8130500, change: 37941 },
  { rank: 24, sheetName: "Lumi＠UrWall", currentName: "P＠Ball", avg: 8092535, change: 532159 },
  { rank: 25, sheetName: "KoYu1", currentName: "KoYu1＠VF", avg: 7914976, change: 109895 },
  { rank: 26, sheetName: "Sky＠loopa", currentName: "Sky＠loopa", avg: 7557170, change: 294195 },
  { rank: 27, sheetName: "SpadeZ", currentName: "spadez", avg: 6959307, change: 288968 },
  { rank: 28, sheetName: "mega444＠VF", currentName: "mega444", avg: 6916940, change: 335108 },
  { rank: 29, sheetName: "Laco", currentName: "Laco", avg: 6211000, change: 1057316 },
  { rank: 30, sheetName: "Lia", currentName: "Lia", avg: 5825542, change: 423883 },
];

/**
 * Members who moved into UmaParty during the first days of August 2026. These
 * are the only members for whom the days-active denominator differs from the
 * day-of-month, so they are where D016 is actually load-bearing.
 */
export const AUGUST_MOVERS = ["cluegi", "rennnnnnnnnnnko", "vae", "spadez", "Lia", "YPurren Chan"];
