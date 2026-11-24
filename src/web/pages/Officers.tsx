import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  ArrowDownWideNarrow,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  ListRestart,
  Lock,
  LockOpen,
  LogOut,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  Undo2,
  Users,
  X,
} from "lucide-react";

import { compactFans, parseFans } from "../lib/format.ts";
import { Button, ClubChip, ErrorNote, Ribbon, Spinner } from "../components/Bits.tsx";

interface Officer {
  id: number;
  username: string;
  display_name: string;
  role: string;
}

interface OfficerRow extends Officer {
  is_active: number;
  created_at: string;
  last_login_at: string | null;
}

interface RosterEntry {
  friend_viewer_id: number;
  circle_id: number | null;
  position: number;
  source: "projected" | "manual";
  projected_circle_id: number | null;
  name: string;
  mtd_avg: number | null;
  /** Where chrono has them today — the plan does not move anyone. */
  actual_circle_id: number | null;
  /** 1 = in the Leaving column (D042): a decided kick, not an undecided unplaced. */
  leaving: number;
  /** Chrono's club role today: 1 member, 2 officer, 3 leader (D044). */
  chrono_role: number | null;
  /** An officer's fans/day estimate, for members chrono has no data on (D043). */
  est_mtd_avg: number | null;
}

interface RosterClub {
  circle_id: number;
  name: string;
  slot_order: number;
  capacity: number;
  in_pool: number;
}

interface PublicClub {
  circle_id: number;
  name: string;
  slot_order: number;
  leader_viewer_id: number | null;
  leader_name: string | null;
}

interface PinRow {
  friend_viewer_id: number;
  circle_id: number;
  kind: string;
  name: string | null;
}

interface SearchHit {
  friend_viewer_id: number;
  current_name: string;
  matchedAlias: string | null;
}

interface Notice {
  id: number;
  body: string;
  circle_id: number | null;
  created_at: string;
  done_at: string | null;
  author: string | null;
  done_by_name: string | null;
}

/** Name search across current and past names, debounced. Needs 2+ characters. */
function useMemberSearch(query: string): SearchHit[] {
  const [hits, setHits] = useState<SearchHit[]>([]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setHits([]);
      return;
    }
    const id = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(query.trim())}`)
        .then((r) => r.json() as Promise<{ results: SearchHit[] }>)
        .then((r) => setHits(r.results));
    }, 200);
    return () => clearTimeout(id);
  }, [query]);

  return hits;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/admin/${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await res.json();
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `${res.status}`);
  return body as T;
}

export function Officers() {
  const [officer, setOfficer] = useState<Officer | null>(null);
  const [checking, setChecking] = useState(true);
  // Bumped when the club order changes, so sections showing clubs reload.
  const [clubsRev, setClubsRev] = useState(0);

  useEffect(() => {
    api<{ officer: Officer }>("me")
      .then((r) => setOfficer(r.officer))
      .catch(() => setOfficer(null))
      .finally(() => setChecking(false));
  }, []);

  if (checking) return <Spinner label="Checking session" />;
  if (!officer) return <LoginForm onSignedIn={setOfficer} />;

  return (
    <div className="space-y-8">
      <header className="flex items-center gap-3">
        <h1 className="font-display text-2xl font-extrabold text-ink-900">Officers</h1>
        <span className="capsule bg-lav-300 px-2.5 py-0.5 text-xs font-semibold text-ink-900">
          {officer.display_name}
        </span>
        <button
          onClick={async () => {
            await api("logout", { method: "POST" });
            setOfficer(null);
          }}
          className="capsule ml-auto flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-ink-600 hover:bg-cream-200"
        >
          <LogOut size={14} /> Sign out
        </button>
      </header>

      <RefreshData />
      <ClubLeaders key={`leads-${clubsRev}`} />
      <ClubOrder onSaved={() => setClubsRev((n) => n + 1)} />
      <Noticeboard />
      <RosterEditor key={`roster-${clubsRev}`} />
      <DiscordNames />
      <ManageOfficers me={officer} />
      <ChangePassword onSignedOut={() => setOfficer(null)} />
    </div>
  );
}

function LoginForm({ onSignedIn }: { onSignedIn: (officer: Officer) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="mx-auto max-w-sm space-y-3"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const r = await api<{ officer: Officer }>("login", {
            method: "POST",
            body: JSON.stringify({ username, password }),
          });
          onSignedIn(r.officer);
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <h1 className="font-display text-2xl font-extrabold text-ink-900">Officer sign in</h1>
      <p className="text-sm text-ink-500">Members don't need an account — this is for officers.</p>

      <input
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        placeholder="Username"
        autoComplete="username"
        className="card w-full bg-cream-50 px-4 py-2.5 outline-none focus:border-teal-400"
      />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        autoComplete="current-password"
        className="card w-full bg-cream-50 px-4 py-2.5 outline-none focus:border-teal-400"
      />

      {error && <ErrorNote message={error} />}

      <Button type="submit" disabled={busy} className="w-full py-2.5">
        {busy ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}

interface DiscordRow {
  friend_viewer_id: number;
  name: string;
  club_name: string | null;
  slot_order: number | null;
  discord_username: string | null;
  note: string | null;
  set_by_name: string | null;
}

/**
 * Map members to their Discord handles, by hand — nothing upstream carries it.
 *
 * The whole roster is listed rather than a search box: the job is working down
 * the list until nothing is missing, and "who have we not done yet" is the
 * question being asked. Each field saves on blur, so it can be typed straight
 * down without reaching for a button.
 */
function DiscordNames() {
  const [rows, setRows] = useState<DiscordRow[]>([]);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [saved, setSaved] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [filter, setFilter] = useState("");

  const reload = useCallback(() => {
    api<{ members: DiscordRow[] }>("discord")
      .then((r) => {
        setRows(r.members);
        setDrafts({});
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(reload, [reload]);

  async function save(row: DiscordRow, value: string) {
    if (value.trim() === (row.discord_username ?? "")) return;
    setError(null);
    try {
      await api("discord", {
        method: "POST",
        body: JSON.stringify({
          friendViewerId: row.friend_viewer_id,
          discordUsername: value.trim(),
        }),
      });
      setRows((current) =>
        current.map((r) =>
          r.friend_viewer_id === row.friend_viewer_id
            ? { ...r, discord_username: value.trim() || null }
            : r,
        ),
      );
      setSaved(row.friend_viewer_id);
      setTimeout(() => setSaved(null), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const query = filter.trim().toLowerCase();
  const shown = rows.filter((row) => {
    if (onlyMissing && row.discord_username) return false;
    if (!query) return true;
    return (
      row.name.toLowerCase().includes(query) ||
      (row.discord_username ?? "").toLowerCase().includes(query)
    );
  });

  const mapped = rows.filter((r) => r.discord_username).length;

  return (
    <details className="space-y-3">
      <summary className="cursor-pointer">
        <span className="inline-flex items-center gap-3 align-middle">
          <Ribbon>Discord names</Ribbon>
          <span className="tnum text-xs text-ink-500">
            {mapped}/{rows.length} mapped
          </span>
        </span>
      </summary>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by name"
          className="card min-w-48 flex-1 bg-cream-50 px-3 py-2 text-sm outline-none focus:border-teal-400"
        />
        <label className="flex items-center gap-1.5 text-xs font-semibold text-ink-600">
          <input
            type="checkbox"
            checked={onlyMissing}
            onChange={(e) => setOnlyMissing(e.target.checked)}
          />
          Only missing
        </label>
      </div>

      {error && <ErrorNote message={error} />}

      <div className="card mt-2 overflow-hidden">
        {shown.map((row) => (
          <div
            key={row.friend_viewer_id}
            className="grid grid-cols-[1fr_1fr] items-center gap-2 border-b border-cream-200 px-3 py-1.5 last:border-0"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-semibold text-ink-900">{row.name}</span>
              {row.club_name && (
                <ClubChip name={row.club_name} slotOrder={row.slot_order ?? 0} />
              )}
            </span>

            <span className="flex items-center gap-2">
              <input
                value={drafts[row.friend_viewer_id] ?? row.discord_username ?? ""}
                onChange={(e) =>
                  setDrafts((d) => ({ ...d, [row.friend_viewer_id]: e.target.value }))
                }
                onBlur={(e) => save(row, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
                placeholder="discord username"
                autoComplete="off"
                spellCheck={false}
                className="card w-full bg-cream-50 px-2.5 py-1 text-sm outline-none focus:border-teal-400"
              />
              {saved === row.friend_viewer_id && (
                <Check size={14} className="shrink-0 text-teal-700" />
              )}
            </span>
          </div>
        ))}
        {shown.length === 0 && (
          <div className="px-3 py-6 text-center text-xs text-ink-400">nothing to show</div>
        )}
      </div>
    </details>
  );
}

/** 12 is the server's minimum; 20 because nobody has to type this from memory. */
function generatePassword(): string {
  const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

/**
 * Create officer accounts.
 *
 * There is no self-signup (D012), so before this the only way in was the
 * seed-admin script — a laptop with the repo, wrangler and D1 access. Every
 * officer can see the roster; only an admin can add to it.
 */
function ManageOfficers({ me }: { me: Officer }) {
  const [rows, setRows] = useState<OfficerRow[]>([]);
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("officer");
  const [handover, setHandover] = useState<{ username: string; password: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    api<{ officers: OfficerRow[] }>("officers")
      .then((r) => setRows(r.officers))
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(reload, [reload]);

  const isAdmin = me.role === "admin";

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-3">
        <Ribbon>Officer accounts</Ribbon>
        {isAdmin && (
          <Button
            tone="quiet"
            className="ml-auto !py-1.5 text-xs"
            onClick={() => {
              setOpen(!open);
              setError(null);
            }}
          >
            {open ? "Cancel" : "Add officer"}
          </Button>
        )}
      </div>

      {open && isAdmin && (
        <form
          className="card space-y-2 px-4 py-3"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await api("officers", {
                method: "POST",
                body: JSON.stringify({ username, displayName, password, role }),
              });
              // Held on screen until dismissed: the password is not recoverable
              // afterwards, only replaceable.
              setHandover({ username: username.trim().toLowerCase(), password });
              setUsername("");
              setDisplayName("");
              setPassword("");
              setRole("officer");
              setOpen(false);
              reload();
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="flex flex-wrap gap-2">
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Username"
              autoComplete="off"
              className="card min-w-40 flex-1 bg-cream-50 px-3 py-2 text-sm outline-none focus:border-teal-400"
            />
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Display name"
              autoComplete="off"
              className="card min-w-40 flex-1 bg-cream-50 px-3 py-2 text-sm outline-none focus:border-teal-400"
            />
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="card bg-cream-50 px-3 py-2 text-sm outline-none focus:border-teal-400"
            >
              <option value="officer">Officer</option>
              <option value="admin">Admin — can add officers</option>
            </select>
          </div>

          <div className="flex flex-wrap gap-2">
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password (12+ characters)"
              autoComplete="off"
              spellCheck={false}
              className="card tnum min-w-56 flex-1 bg-cream-50 px-3 py-2 text-sm outline-none focus:border-teal-400"
            />
            <Button tone="quiet" onClick={() => setPassword(generatePassword())}>
              Generate
            </Button>
            <Button type="submit" disabled={busy || password.length < 12 || !username.trim()}>
              {busy ? "Creating…" : "Create"}
            </Button>
          </div>

          {error && <ErrorNote message={error} />}
        </form>
      )}

      {handover && (
        <div className="card border-teal-400 bg-teal-100 px-4 py-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-ink-900">{handover.username}</span>
            <code className="capsule bg-cream-50 px-2 py-0.5 text-xs">{handover.password}</code>
            <button
              onClick={() => navigator.clipboard?.writeText(handover.password)}
              className="capsule flex items-center gap-1 px-2 py-0.5 text-xs font-semibold text-ink-600 hover:bg-cream-200"
            >
              <Copy size={12} /> Copy
            </button>
            <button
              onClick={() => setHandover(null)}
              className="ml-auto text-xs font-semibold text-ink-500 hover:text-ink-900"
            >
              Dismiss
            </button>
          </div>
          <p className="mt-1.5 text-xs text-ink-600">Shown once. Send it privately.</p>
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((row) => (
          <div key={row.id} className="card px-3 py-2.5">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-ink-900">{row.display_name}</span>
              {row.role === "admin" && (
                <span className="capsule bg-lav-300 px-2 py-0.5 text-[11px] font-semibold text-ink-900">
                  admin
                </span>
              )}
              {row.is_active !== 1 && (
                <span className="capsule bg-cream-300 px-2 py-0.5 text-[11px] font-semibold text-ink-600">
                  disabled
                </span>
              )}
            </div>
            <div className="mt-1 text-xs text-ink-500">
              {row.username} ·{" "}
              {row.last_login_at
                ? `last in ${row.last_login_at.slice(0, 10)}`
                : "never signed in"}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Rotate your own password. The first admin's password is necessarily created
 * outside the app, so without this it could never be changed.
 */
function ChangePassword({ onSignedOut }: { onSignedOut: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <details className="card px-4 py-3">
      <summary className="cursor-pointer text-sm font-semibold text-ink-700">
        Change my password
      </summary>

      <form
        className="mt-3 flex flex-wrap items-start gap-2"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await api("password", {
              method: "POST",
              body: JSON.stringify({ current, next }),
            });
            // Every session is revoked server-side, including this one.
            onSignedOut();
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <input
          type="password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          placeholder="Current password"
          autoComplete="current-password"
          className="card bg-cream-50 px-3 py-2 text-sm outline-none focus:border-teal-400"
        />
        <input
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          placeholder="New password (12+ characters)"
          autoComplete="new-password"
          className="card bg-cream-50 px-3 py-2 text-sm outline-none focus:border-teal-400"
        />
        <Button type="submit" disabled={busy}>
          {busy ? "Changing…" : "Change"}
        </Button>
        <p className="w-full text-xs text-ink-400">
          Changing it signs out every device, including this one.
        </p>
        {error && <ErrorNote message={error} />}
      </form>
    </details>
  );
}

/**
 * Set each club's leader.
 *
 * Stored as a `leader` pin, so the reshuffle holds them in place while still
 * counting them against the club's slots (D006). Chronogenesis has its own idea
 * of the leader, which is used as the fallback but is often out of date.
 */
function ClubLeaders() {
  const [clubs, setClubs] = useState<PublicClub[]>([]);
  const [pins, setPins] = useState<PinRow[]>([]);
  const [editing, setEditing] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const hits = useMemberSearch(query);

  const reload = useCallback(() => {
    fetch("/api/clubs")
      .then((r) => r.json() as Promise<{ clubs: PublicClub[] }>)
      .then((r) => setClubs(r.clubs));
    api<{ pins: PinRow[] }>("pins").then((r) => setPins(r.pins));
  }, []);

  useEffect(reload, [reload]);

  const leaderPin = (circleId: number) =>
    pins.find((p) => p.circle_id === circleId && p.kind === "leader");

  async function setLeader(circleId: number, friendViewerId: number) {
    await api("pins", {
      method: "POST",
      body: JSON.stringify({ friendViewerId, circleId, kind: "leader" }),
    });
    setEditing(null);
    setQuery("");
    reload();
  }

  return (
    <section className="space-y-3">
      <Ribbon>Club leads</Ribbon>
      <p className="text-sm text-ink-500">
        Leads come from chrono. Setting one here is a proposal for the next reshuffle — it
        does not hold them.
      </p>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {clubs.map((club) => {
          const pin = leaderPin(club.circle_id);
          const isEditing = editing === club.circle_id;

          return (
            <div key={club.circle_id} className="card px-3 py-2.5">
              <div className="flex items-center gap-2">
                <ClubChip name={club.name} slotOrder={club.slot_order} />
                <Button
                  tone="quiet"
                  className="ml-auto !px-2 !py-1 text-xs"
                  onClick={() => {
                    setEditing(isEditing ? null : club.circle_id);
                    setQuery("");
                  }}
                >
                  {isEditing ? "Cancel" : "Change"}
                </Button>
              </div>

              {/* Chrono is the lead of record and the one the projection holds
                  (D027); the pin below is only who officers want next. */}
              <div className="mt-1.5 text-sm">
                {club.leader_name ? (
                  <span className="font-semibold text-ink-900">{club.leader_name}</span>
                ) : (
                  <span className="text-ink-400">chrono has no lead</span>
                )}
              </div>

              {pin && pin.friend_viewer_id !== club.leader_viewer_id && (
                <div className="mt-1 text-xs text-ink-500">
                  proposed: <span className="font-semibold text-ink-700">{pin.name}</span>
                </div>
              )}

              {isEditing && (
                <div className="mt-2">
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search a member"
                    className="card w-full bg-cream-50 px-3 py-1.5 text-sm outline-none focus:border-teal-400"
                  />
                  <ul className="mt-1 max-h-44 overflow-y-auto">
                    {hits.map((hit) => (
                      <li key={hit.friend_viewer_id}>
                        <button
                          onClick={() => setLeader(club.circle_id, hit.friend_viewer_id)}
                          className="w-full rounded-[6px] px-2 py-1 text-left text-sm hover:bg-teal-50"
                        >
                          {hit.current_name}
                          {hit.matchedAlias && (
                            <span className="ml-1 text-[11px] text-ink-400">
                              was {hit.matchedAlias}
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                    {query.trim().length >= 2 && hits.length === 0 && (
                      <li className="px-2 py-1 text-xs text-ink-400">no match</li>
                    )}
                  </ul>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

interface OrderClub {
  circle_id: number;
  name: string;
  slot_order: number;
  in_pool: number;
  is_active: number;
  avg_daily_gain: number | null;
  club_rank: number | null;
}

/**
 * The clubs' running order (D020, D039): which club is "above" which, and so
 * where the reshuffle cascades.
 *
 * Officers can sort by each club's fans per day this month — chrono's own
 * daily club gain, averaged — or arrange by hand. Nothing reorders itself: the
 * order decides where people are projected, so it changes only on Save.
 */
function ClubOrder({ onSaved }: { onSaved: () => void }) {
  const [clubs, setClubs] = useState<OrderClub[]>([]);
  const [draft, setDraft] = useState<number[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const reload = useCallback(() => {
    api<{ clubs: OrderClub[] }>("clubs")
      .then((r) => {
        setClubs(r.clubs);
        setDraft(null);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(reload, [reload]);

  const byId = useMemo(() => new Map(clubs.map((c) => [c.circle_id, c])), [clubs]);
  const active = useMemo(() => clubs.filter((c) => c.is_active === 1), [clubs]);
  const order = draft ?? active.map((c) => c.circle_id);
  const dirty = draft !== null && draft.some((id, i) => id !== active[i]?.circle_id);

  const byGain = useMemo(
    () =>
      [...active]
        .sort((a, b) => (b.avg_daily_gain ?? -1) - (a.avg_daily_gain ?? -1))
        .map((c) => c.circle_id),
    [active],
  );
  const matchesGain = order.every((id, i) => id === byGain[i]);

  function move(index: number, delta: number) {
    const next = [...order];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    setDraft(next);
    setSaved(false);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      // Inactive clubs keep their relative order, after the active ones.
      const inactive = clubs.filter((c) => c.is_active !== 1).map((c) => c.circle_id);
      await api("clubs", { method: "PUT", body: JSON.stringify({ order: [...order, ...inactive] }) });
      setSaved(true);
      reload();
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Ribbon>Club order</Ribbon>
        {!matchesGain && !dirty && (
          <span className="text-xs text-coral-700">not in fans/day order</span>
        )}
        <div className="ml-auto flex gap-2">
          <Button
            tone="quiet"
            disabled={matchesGain}
            title="Order clubs by their average daily fan gain this month"
            onClick={() => {
              setDraft(byGain);
              setSaved(false);
            }}
          >
            <span className="flex items-center gap-1.5">
              <ArrowDownWideNarrow size={13} /> Sort by fans/day
            </span>
          </Button>
          {dirty && (
            <Button tone="quiet" onClick={() => setDraft(null)}>
              Discard
            </Button>
          )}
          <Button disabled={!dirty || busy} onClick={save}>
            {busy ? "Saving…" : "Save order"}
          </Button>
        </div>
      </div>

      <p className="text-sm text-ink-500">
        Top to bottom is best to worst: the reshuffle fills the top club first. Fans/day is each
        club's total daily gain, averaged over this month.
        {saved && (
          <span className="text-teal-700">
            {" "}
            Saved — press Fill clubs or Redo projection to re-deal the plan.
          </span>
        )}
      </p>

      {error && <ErrorNote message={error} />}

      <ol className="card overflow-hidden">
        {order.map((id, index) => {
          const club = byId.get(id);
          if (!club) return null;
          return (
            <li
              key={id}
              className="grid grid-cols-[1.5rem_1fr_auto_auto_auto] items-center gap-3 border-b border-cream-200 px-3 py-1.5 last:border-0"
            >
              <span className="tnum text-xs text-ink-400">{index + 1}</span>
              <span className="flex min-w-0 items-center gap-2">
                {/* Tinted by its slot as it will be once saved. */}
                <ClubChip name={club.name} slotOrder={index + 1} />
                {club.in_pool !== 1 && (
                  <span className="text-[11px] text-ink-400">not reshuffled</span>
                )}
              </span>
              <span className="tnum text-right text-sm text-ink-700" title="Average daily fan gain this month">
                {club.avg_daily_gain !== null ? `${compactFans(club.avg_daily_gain)}/day` : "—"}
              </span>
              <span className="tnum w-14 text-right text-xs text-ink-400" title="Chrono club rank">
                {club.club_rank !== null ? `#${club.club_rank}` : ""}
              </span>
              <span className="flex">
                <button
                  title="Move up"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  className="rounded-[6px] p-1 text-ink-500 hover:bg-cream-200 disabled:opacity-25"
                >
                  <ChevronUp size={14} />
                </button>
                <button
                  title="Move down"
                  disabled={index === order.length - 1}
                  onClick={() => move(index, 1)}
                  className="rounded-[6px] p-1 text-ink-500 hover:bg-cream-200 disabled:opacity-25"
                >
                  <ChevronDown size={14} />
                </button>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Force a data pull without waiting for the daily cron. */
function RefreshData() {
  const [state, setState] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <section className="card flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink-900">Refresh the numbers</p>
        <p className="text-xs text-ink-500">
          {state ?? "Runs automatically after 10:15 UTC daily. Pull early after a reshuffle."}
        </p>
      </div>
      <Button
        tone="quiet"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setState("Pulling from chronogenesis…");
          try {
            const r = await api<{ ok: boolean; summaries: { status: string }[] }>("ingest", {
              method: "POST",
            });
            const ok = r.summaries.filter((s) => s.status === "ok").length;
            setState(`Done — ${ok} of ${r.summaries.length} clubs updated. Reload to see it.`);
          } catch (e) {
            setState(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <span className="flex items-center gap-1.5">
          <RefreshCw size={13} /> {busy ? "Working…" : "Refresh now"}
        </span>
      </Button>
    </section>
  );
}

function Noticeboard() {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [draft, setDraft] = useState("");
  const [showArchive, setShowArchive] = useState(false);

  const reload = useCallback(() => {
    api<{ notices: Notice[] }>("notices").then((r) => setNotices(r.notices));
  }, []);

  useEffect(reload, [reload]);

  const open = notices.filter((n) => !n.done_at);
  const archived = notices.filter((n) => n.done_at);

  return (
    <section className="space-y-3">
      <Ribbon>Noticeboard</Ribbon>

      <form
        className="flex gap-2"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!draft.trim()) return;
          await api("notices", { method: "POST", body: JSON.stringify({ body: draft }) });
          setDraft("");
          reload();
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Leave a note for the other officers"
          className="card flex-1 bg-cream-50 px-4 py-2.5 text-sm outline-none focus:border-teal-400"
        />
        <Button type="submit">Post</Button>
      </form>

      <ul className="space-y-2">
        {open.length === 0 && <li className="text-sm text-ink-400">Nothing outstanding.</li>}
        {open.map((notice) => (
          <li key={notice.id} className="card flex items-start gap-3 px-4 py-3">
            <button
              onClick={async () => {
                await api("notices", {
                  method: "PATCH",
                  body: JSON.stringify({ id: notice.id, done: true }),
                });
                reload();
              }}
              title="Mark done"
              className="capsule mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center border border-cream-300 hover:bg-teal-100"
            >
              <Check size={13} className="text-teal-700" />
            </button>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-ink-900">{notice.body}</p>
              <p className="mt-0.5 text-[11px] text-ink-400">
                {notice.author} · {new Date(notice.created_at).toLocaleDateString()}
              </p>
            </div>
          </li>
        ))}
      </ul>

      {archived.length > 0 && (
        <div>
          <button
            onClick={() => setShowArchive((v) => !v)}
            className="text-sm font-semibold text-teal-700 hover:underline"
          >
            {showArchive ? "Hide" : "Show"} archive ({archived.length})
          </button>

          {showArchive && (
            <ul className="mt-2 space-y-1">
              {archived.map((notice) => (
                <li
                  key={notice.id}
                  className="card flex items-start gap-3 bg-cream-100 px-4 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-ink-500 line-through">{notice.body}</p>
                    <p className="text-[11px] text-ink-400">
                      done by {notice.done_by_name} ·{" "}
                      {notice.done_at && new Date(notice.done_at).toLocaleDateString()}
                    </p>
                  </div>
                  <button
                    onClick={async () => {
                      await api("notices", {
                        method: "PATCH",
                        body: JSON.stringify({ id: notice.id, done: false }),
                      });
                      reload();
                    }}
                    title="Reopen"
                    className="capsule px-2 py-1 text-ink-400 hover:bg-cream-200"
                  >
                    <Undo2 size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * Drag-and-drop roster editor (D022).
 *
 * The projection seeds the plan; officers move anyone anywhere. Capacity is
 * shown and warned about but never enforced — the game is the real constraint
 * and officers may knowingly overfill a club mid-negotiation.
 */
function RosterEditor() {
  const [planId, setPlanId] = useState<number | null>(null);
  const [entries, setEntries] = useState<RosterEntry[]>([]);
  const [clubs, setClubs] = useState<RosterClub[]>([]);
  const [status, setStatus] = useState<string>("draft");
  const [baseline, setBaseline] = useState<string>("projection");
  const [report, setReport] = useState<ReshuffleReport | null>(null);
  const [checks, setChecks] = useState<ReportCheck[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ entry: RosterEntry; x: number; y: number } | null>(null);
  const [yearMonth, setYearMonth] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<RosterEntry | null>(null);
  const [filled, setFilled] = useState<number | null>(null);
  const [pins, setPins] = useState<PinRow[]>([]);

  const reloadPins = useCallback(() => {
    api<{ pins: PinRow[] }>("pins")
      .then((r) => setPins(r.pins))
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(reloadPins, [reloadPins]);

  /** viewer id → the club they are locked into. Leader pins are proposals (D027). */
  const locks = useMemo(
    () =>
      new Map(pins.filter((p) => p.kind === "manual").map((p) => [p.friend_viewer_id, p.circle_id])),
    [pins],
  );

  async function setLock(friendViewerId: number, circleId: number | null) {
    setSaving(true);
    try {
      await api("pins", {
        method: circleId === null ? "DELETE" : "POST",
        body: JSON.stringify({ friendViewerId, circleId, kind: "manual" }),
      });
      reloadPins();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const reload = useCallback(() => {
    api<{
      plan: { id: number; status: string; baseline: string };
      report: ReshuffleReport | null;
      checks: ReportCheck[];
      entries: RosterEntry[];
      clubs: RosterClub[];
      yearMonth: number;
      dataYmd: number;
    }>("roster")
      .then((r) => {
        setPlanId(r.plan.id);
        setStatus(r.plan.status);
        setBaseline(r.plan.baseline);
        setReport(r.report);
        setChecks(r.checks);
        setEntries(r.entries);
        setClubs(r.clubs);
        setYearMonth(r.yearMonth);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(reload, [reload]);

  const sensors = useSensors(
    // A small threshold so a tap on a member still reads as a click.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  /** Keyed by club id, plus `null` for Unplaced and `"leaving"` for Leaving. */
  const byClub = useMemo(() => {
    const map = new Map<number | null | "leaving", RosterEntry[]>();
    for (const club of clubs) map.set(club.circle_id, []);
    map.set(null, []);
    map.set("leaving", []);
    for (const entry of entries) {
      const list =
        entry.leaving === 1 ? map.get("leaving")! : (map.get(entry.circle_id) ?? map.get(null)!);
      list.push(entry);
    }
    for (const list of map.values()) list.sort((a, b) => a.position - b.position);
    return map;
  }, [entries, clubs]);

  const changed = entries.filter((e) => e.source === "manual").length;

  const clubName = useCallback(
    (circleId: number | null) =>
      circleId === null ? "Unplaced" : (clubs.find((c) => c.circle_id === circleId)?.name ?? `Club ${circleId}`),
    [clubs],
  );

  function onDragStart(event: DragStartEvent) {
    setDragging(entries.find((e) => e.friend_viewer_id === Number(event.active.id)) ?? null);
  }

  function onDragEnd(event: DragEndEvent) {
    setDragging(null);
    const overId = event.over?.id;
    if (overId === undefined || overId === null) return;

    // Drop zones: "club-<id>", "club-none" (Unplaced), "club-leaving" (D042).
    const zone = String(overId).slice(5);
    void moveEntry(
      Number(event.active.id),
      zone === "leaving" ? "leaving" : zone === "none" ? null : Number(zone),
    );
  }

  /** Move one member — from a drag or the right-click menu. */
  async function moveEntry(memberId: number, target: MoveTarget) {
    const leaving = target === "leaving";
    const targetClub = leaving ? null : target;

    const entry = entries.find((e) => e.friend_viewer_id === memberId);
    if (!entry) return;
    if (entry.circle_id === targetClub && (entry.leaving === 1) === leaving) return;

    // Chrono's club leads stay in their club (D044). The server refuses too;
    // this just says why without a round trip.
    if (isHeld(entry) && (leaving || targetClub !== entry.actual_circle_id)) {
      flashNotice(`${entry.name} is a ${roleLabel(entry)} and stays in ${clubName(entry.actual_circle_id)}.`);
      return;
    }

    setEntries((list) =>
      list.map((e) =>
        e.friend_viewer_id === memberId
          ? { ...e, circle_id: targetClub, leaving: leaving ? 1 : 0, source: "manual" as const }
          : e,
      ),
    );

    setSaving(true);
    try {
      await api("roster", {
        method: "PUT",
        body: JSON.stringify({
          planId,
          moves: [{ friendViewerId: memberId, circleId: targetClub, position: 999, leaving }],
        }),
      });
    } catch (e) {
      // A refused move is not a broken editor: say why and put them back.
      flashNotice(e instanceof Error ? e.message : String(e));
      reload();
    } finally {
      setSaving(false);
    }
  }

  function flashNotice(message: string) {
    setNotice(message);
    setTimeout(() => setNotice((current) => (current === message ? null : current)), 4000);
  }

  /** Set or clear an officer's fans/day estimate (D043). */
  const editEstimate = useCallback(
    async (entry: RosterEntry) => {
      const current = entry.est_mtd_avg !== null ? compactFans(entry.est_mtd_avg) : "";
      const answer = prompt(
        `Fans/day for ${entry.name} — e.g. 12.5M or 800k. Leave empty to clear.`,
        current,
      );
      if (answer === null) return;
      const est = parseFans(answer);
      if (est === undefined) {
        alert("Not understood — try 12.5M, 800k or 12500000.");
        return;
      }
      setEntries((list) =>
        list.map((e) => (e.friend_viewer_id === entry.friend_viewer_id ? { ...e, est_mtd_avg: est } : e)),
      );
      try {
        await api("roster", {
          method: "POST",
          body: JSON.stringify({ action: "estimate", friendViewerId: entry.friend_viewer_id, estMtdAvg: est }),
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        reload();
      }
    },
    [reload],
  );

  /** Remove a leaver from the plan. The server refuses anyone not in Leaving. */
  async function removeFromPlan(friendViewerId: number) {
    setSaving(true);
    try {
      await api("roster", { method: "POST", body: JSON.stringify({ action: "remove", friendViewerId }) });
      setEntries((current) => current.filter((e) => e.friend_viewer_id !== friendViewerId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      reload();
    } finally {
      setSaving(false);
    }
  }

  /** Tick a checklist line. Optimistic; reverts by reloading if the save fails. */
  async function toggleCheck(line: Omit<ReportCheck, "checked_by_name">, checked: boolean) {
    const same = (c: ReportCheck) =>
      c.friend_viewer_id === line.friend_viewer_id &&
      c.circle_id === line.circle_id &&
      c.kind === line.kind;
    setChecks((current) =>
      checked
        ? [...current.filter((c) => !same(c)), { ...line, checked_by_name: null }]
        : current.filter((c) => !same(c)),
    );
    try {
      await api("roster", {
        method: "POST",
        body: JSON.stringify({
          action: "check",
          friendViewerId: line.friend_viewer_id,
          circleId: line.circle_id,
          kind: line.kind,
          checked,
        }),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      reload();
    }
  }

  /** Rebuild the whole plan. Confirms first only when it would discard hand edits. */
  async function rebuild(action: "reset" | "chrono", question: string) {
    if (saving) return; // a second click while the first is running
    if (changed > 0 && !confirm(question)) return;
    setSaving(true);
    try {
      await api("roster", { method: "POST", body: JSON.stringify({ action }) });
      setFilled(null);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (error) return <ErrorNote message={error} />;
  if (!planId) return <Spinner label="Building the proposed roster" />;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Ribbon>Proposed roster</Ribbon>
        {status === "final" && (
          <span className="capsule bg-teal-500 px-2.5 py-0.5 text-xs font-semibold text-white">
            finalised
          </span>
        )}
        <span className="text-xs text-ink-400">
          {baseline === "chrono" ? "built from chrono's current clubs" : "built from the projection"}
          {changed > 0 && ` · ${changed} moved by hand`}
        </span>
        {saving && <span className="text-xs text-teal-700">saving…</span>}
        {notice && <span className="text-xs font-semibold text-coral-700">{notice}</span>}
        {filled !== null && !saving && (
          <span className="text-xs text-ink-400">
            {filled === 0 ? "already full" : `filled ${filled}`}
          </span>
        )}

        <div className="ml-auto flex gap-2">
          <Button
            tone="quiet"
            title="Fill every club to capacity by rank, keeping hand-placed members where they are"
            onClick={async () => {
              setSaving(true);
              try {
                const r = await api<{ moved: number }>("roster", {
                  method: "POST",
                  body: JSON.stringify({ action: "fill" }),
                });
                setFilled(r.moved);
                reload();
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              } finally {
                setSaving(false);
              }
            }}
          >
            <span className="flex items-center gap-1.5">
              <Users size={13} /> Fill clubs
            </span>
          </Button>
          <Button
            tone="quiet"
            title="Rebuild the plan from today's numbers, discarding every hand edit"
            onClick={() =>
              rebuild(
                "reset",
                `Rebuild the plan from the projection? ${changed} hand-placed members will be reset.`,
              )
            }
          >
            <span className="flex items-center gap-1.5">
              <RotateCcw size={13} /> Redo projection
            </span>
          </Button>
          <Button
            tone="quiet"
            title="Put everyone back in the club chrono has them in today, discarding every hand edit"
            onClick={() =>
              rebuild(
                "chrono",
                `Reset the plan to chrono's current clubs? ${changed} hand-placed members will be reset.`,
              )
            }
          >
            <span className="flex items-center gap-1.5">
              <ListRestart size={13} /> Match chrono
            </span>
          </Button>
          <Button
            title="Record the plan and generate each club's kick/invite list"
            onClick={async () => {
              if (
                status === "final" &&
                !confirm("Finalise again? The kick/invite report will be regenerated from today's chrono data.")
              ) {
                return;
              }
              setSaving(true);
              try {
                await api("roster", { method: "POST", body: JSON.stringify({ action: "finalise" }) });
                reload();
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              } finally {
                setSaving(false);
              }
            }}
          >
            {status === "final" ? "Finalise again" : "Finalise"}
          </Button>
        </div>
      </div>

      <p className="text-sm text-ink-500">
        Drag anyone (or right click a user) into any club. Finalising records the plan and lists who each club has to
        kick and invite — the reshuffle is still done by hand in-game.
      </p>

      {status === "final" && report && (
        <ReshuffleReportView
          report={report}
          entries={entries}
          yearMonth={yearMonth}
          checks={checks}
          onCheck={toggleCheck}
        />
      )}

      <MenuContext.Provider value={(entry, x, y) => setMenu({ entry, x, y })}>
      <EstimateContext.Provider value={editEstimate}>
      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {clubs.map((club) => (
            <ClubColumn
              key={club.circle_id}
              club={club}
              entries={byClub.get(club.circle_id) ?? []}
              locks={locks}
              clubName={clubName}
              onLock={setLock}
            />
          ))}
          <ClubColumn
            club={null}
            entries={byClub.get(null) ?? []}
            locks={locks}
            clubName={clubName}
            onLock={setLock}
          />
          <ClubColumn
            club="leaving"
            entries={byClub.get("leaving") ?? []}
            locks={locks}
            clubName={clubName}
            onLock={setLock}
            onRemove={removeFromPlan}
          />
        </div>

        {/* Follows the cursor across columns; without it the card stays clipped
            inside its own scrolling column. */}
        <DragOverlay>
          {dragging ? (
            <MemberChip entry={dragging} lockedTo={locks.get(dragging.friend_viewer_id)} />
          ) : null}
        </DragOverlay>
      </DndContext>
      </EstimateContext.Provider>
      </MenuContext.Provider>

      {menu && (
        <RosterMenu
          entry={entries.find((e) => e.friend_viewer_id === menu.entry.friend_viewer_id) ?? menu.entry}
          x={menu.x}
          y={menu.y}
          clubs={clubs}
          lockedTo={locks.get(menu.entry.friend_viewer_id)}
          clubName={clubName}
          onMove={(target) => void moveEntry(menu.entry.friend_viewer_id, target)}
          onLock={(circleId) => void setLock(menu.entry.friend_viewer_id, circleId)}
          onEstimate={() => void editEstimate(menu.entry)}
          onRemove={() => void removeFromPlan(menu.entry.friend_viewer_id)}
          onClose={() => setMenu(null)}
        />
      )}

      <AddMember clubs={clubs} onAdded={reload} />

      <LockedMembers clubs={clubs} pins={pins} entries={entries} onLock={setLock} />
    </section>
  );
}

interface ReportMember {
  friendViewerId: number;
  name: string;
  /** Kick: where they are going. Invite: where they are coming from. */
  otherClub: string | null;
}

interface ReportCheck {
  friend_viewer_id: number;
  circle_id: number;
  kind: "kick" | "invite";
  checked_by_name: string | null;
}

interface ReshuffleReport {
  generatedAt: string;
  dataYmd: number;
  clubs: { circleId: number; name: string; kick: ReportMember[]; invite: ReportMember[] }[];
  unplaced: (ReportMember & { otherCircleId: number | null })[];
  notInPlan: ReportMember[];
}

function monthLabel(yearMonth: number): string {
  return new Date(Date.UTC(Math.floor(yearMonth / 100), (yearMonth % 100) - 1, 1)).toLocaleDateString(
    undefined,
    { month: "long", year: "numeric", timeZone: "UTC" },
  );
}

/** Where a member can be moved: a club id, Unplaced (null) or Leaving. */
type MoveTarget = number | null | "leaving";

/** Chrono's club lead keeps their club through a reshuffle (D044). Officers do not. */
function isHeld(entry: RosterEntry): boolean {
  return entry.chrono_role === 3 && entry.actual_circle_id !== null;
}

function roleLabel(_entry: RosterEntry): string {
  return "club lead";
}

/** One club's section as plain text, for pasting to that club's officer in Discord. */
function clubReportText(club: ReshuffleReport["clubs"][number], yearMonth: number): string {
  const line = (m: ReportMember, arrow: string, fallback: string) =>
    `- ${m.name} (${m.friendViewerId}) ${arrow} ${m.otherClub ?? fallback}`;
  const lines = [`**${club.name}** — reshuffle ${monthLabel(yearMonth)}`];
  if (club.kick.length === 0 && club.invite.length === 0) {
    lines.push("No changes.");
    return lines.join("\n");
  }
  lines.push(`Kick (${club.kick.length}):`);
  lines.push(...(club.kick.length ? club.kick.map((m) => line(m, "→", "leaving")) : ["- nobody"]));
  lines.push(`Invite (${club.invite.length}):`);
  lines.push(...(club.invite.length ? club.invite.map((m) => line(m, "←", "new")) : ["- nobody"]));
  return lines.join("\n");
}

/**
 * The finalised plan as instructions (D041): for each club, who to kick and
 * who to invite, with trainer IDs. Stored at finalise time, so it stays the
 * list officers were given; each line ticks off once chrono shows the move
 * done, which lags the game by up to a day.
 */
function ReshuffleReportView({
  report,
  entries,
  yearMonth,
  checks,
  onCheck,
}: {
  report: ReshuffleReport;
  entries: RosterEntry[];
  yearMonth: number;
  checks: ReportCheck[];
  onCheck: (line: Omit<ReportCheck, "checked_by_name">, checked: boolean) => void;
}) {
  const [copied, setCopied] = useState<number | "all" | null>(null);
  const actual = useMemo(
    () => new Map(entries.map((e) => [e.friend_viewer_id, e.actual_circle_id])),
    [entries],
  );
  const ticked = useMemo(
    () => new Map(checks.map((c) => [`${c.kind}:${c.circle_id}:${c.friend_viewer_id}`, c])),
    [checks],
  );

  function copy(key: number | "all", text: string) {
    navigator.clipboard?.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  }

  const total = report.clubs.reduce((n, c) => n + c.kick.length + c.invite.length, 0);

  return (
    <div className="card space-y-3 px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-display text-lg font-bold text-ink-900">Kick &amp; invite list</span>
        <span className="text-xs text-ink-400">
          generated {new Date(report.generatedAt).toLocaleString()} against chrono's{" "}
          {String(report.dataYmd).replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3")}
        </span>
        <Button
          tone="quiet"
          className="ml-auto !py-1.5 text-xs"
          onClick={() =>
            copy("all", report.clubs.map((c) => clubReportText(c, yearMonth)).join("\n\n"))
          }
        >
          <span className="flex items-center gap-1.5">
            {copied === "all" ? <Check size={12} /> : <Copy size={12} />} Copy all
          </span>
        </Button>
      </div>

      <p className="text-xs text-ink-500">
        Tick each line as you do it — every officer sees the same ticks. Kicks first: a full club
        cannot accept an invite. Lines chrono already shows as done tick themselves, after the
        next daily refresh.
      </p>

      {total === 0 && (
        <p className="text-sm font-semibold text-teal-700">Nobody moves — chrono already matches the plan.</p>
      )}

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {report.clubs.map((club) => (
          <div key={club.circleId} className="rounded-[10px] border border-cream-300 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-ink-900">{club.name}</span>
              <span className="tnum text-xs text-ink-400">
                −{club.kick.length} / +{club.invite.length}
              </span>
              <button
                title="Copy this club's list"
                onClick={() => copy(club.circleId, clubReportText(club, yearMonth))}
                className="capsule ml-auto flex items-center gap-1 px-2 py-0.5 text-xs font-semibold text-ink-600 hover:bg-cream-200"
              >
                {copied === club.circleId ? <Check size={12} /> : <Copy size={12} />} Copy
              </button>
            </div>

            {(["kick", "invite"] as const).map((kind) => (
              <ReportList
                key={kind}
                title={kind === "kick" ? "Kick" : "Invite"}
                tone={kind === "kick" ? "text-coral-700" : "text-teal-700"}
                members={club[kind]}
                arrow={kind === "kick" ? "→" : "←"}
                fallback={kind === "kick" ? "leaving" : "new"}
                byChrono={(m) =>
                  kind === "kick"
                    ? actual.get(m.friendViewerId) !== club.circleId
                    : actual.get(m.friendViewerId) === club.circleId
                }
                tickedBy={(m) => ticked.get(`${kind}:${club.circleId}:${m.friendViewerId}`)}
                onToggle={(m, checked) =>
                  onCheck({ friend_viewer_id: m.friendViewerId, circle_id: club.circleId, kind }, checked)
                }
              />
            ))}
          </div>
        ))}
      </div>

      {(report.unplaced.length > 0 || report.notInPlan.length > 0) && (
        <div className="space-y-1 text-xs text-ink-600">
          {report.unplaced.length > 0 && (
            <p>
              <span className="font-semibold text-coral-700">
                Unplaced, no action listed ({report.unplaced.length}):
              </span>{" "}
              {report.unplaced.map((m) => `${m.name} (${m.friendViewerId}, in ${m.otherClub})`).join(", ")}
            </p>
          )}
          {report.notInPlan.length > 0 && (
            <p>
              <span className="font-semibold text-coral-700">
                In a club but not in the plan ({report.notInPlan.length}):
              </span>{" "}
              {report.notInPlan.map((m) => `${m.name} (${m.friendViewerId}, in ${m.otherClub})`).join(", ")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function ReportList({
  title,
  tone,
  members,
  arrow,
  fallback,
  byChrono,
  tickedBy,
  onToggle,
}: {
  title: string;
  tone: string;
  members: ReportMember[];
  arrow: string;
  fallback: string;
  /** Chrono already shows this move done — ticked without anyone clicking. */
  byChrono: (m: ReportMember) => boolean;
  tickedBy: (m: ReportMember) => ReportCheck | undefined;
  onToggle: (m: ReportMember, checked: boolean) => void;
}) {
  if (members.length === 0) return null;
  const isDone = (m: ReportMember) => byChrono(m) || tickedBy(m) !== undefined;
  const done = members.filter(isDone).length;

  return (
    <div className="mt-2">
      <div className={`text-[11px] font-bold uppercase tracking-wide ${tone}`}>
        {title} {done}/{members.length}
      </div>
      <ul className="mt-0.5 space-y-0.5">
        {members.map((m) => {
          const chrono = byChrono(m);
          const tick = tickedBy(m);
          const finished = chrono || tick !== undefined;
          return (
            <li key={m.friendViewerId}>
              <label
                className={`flex cursor-pointer items-center gap-1.5 rounded-[6px] px-1 text-sm hover:bg-cream-100 ${
                  finished ? "text-ink-400" : "text-ink-900"
                }`}
                title={
                  chrono
                    ? "Chrono shows this done"
                    : tick?.checked_by_name
                      ? `Ticked by ${tick.checked_by_name}`
                      : undefined
                }
              >
                <input
                  type="checkbox"
                  checked={finished}
                  disabled={chrono}
                  onChange={(e) => onToggle(m, e.target.checked)}
                  className="shrink-0 accent-teal-500"
                />
                <span className={`min-w-0 truncate font-semibold ${finished ? "line-through" : ""}`}>
                  {m.name}
                </span>
                <span className={finished ? "line-through" : ""}>
                  <UidTag id={m.friendViewerId} />
                </span>
                <span className={`ml-auto shrink-0 text-[11px] text-ink-400 ${finished ? "line-through" : ""}`}>
                  {arrow} {m.otherClub ?? fallback}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Standing locks (D021): members held in a club by every projection and every
 * fill, month after month, until someone unlocks them. The fix for regulars
 * who drift out of their club on rank each reshuffle and have to be dragged
 * back by hand.
 *
 * A lock does not move anyone in the current plan by itself — "Fill clubs"
 * applies it, unless an officer has already dragged that member this month
 * (a hand placement beats a lock, D029).
 */
function LockedMembers({
  clubs,
  pins,
  entries,
  onLock,
}: {
  clubs: RosterClub[];
  pins: PinRow[];
  entries: RosterEntry[];
  onLock: (friendViewerId: number, circleId: number | null) => Promise<void>;
}) {
  const [adding, setAdding] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const hits = useMemberSearch(query);

  const locked = pins.filter((p) => p.kind === "manual");
  const planned = new Map(entries.map((e) => [e.friend_viewer_id, e.circle_id]));

  return (
    <div className="space-y-3 pt-2">
      <div className="flex flex-wrap items-center gap-3">
        <Ribbon>Locked members</Ribbon>
        <span className="tnum text-xs text-ink-400">{locked.length} locked</span>
      </div>
      <p className="text-sm text-ink-500">
        Held in their club every month, whatever their rank, until unlocked. They still use one
        of the club's seats. Lock from here or with the padlock on a card above, then press{" "}
        <span className="font-semibold">Fill clubs</span> to apply it to this month's plan.
      </p>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {clubs.map((club) => {
          const members = locked.filter((p) => p.circle_id === club.circle_id);
          const isAdding = adding === club.circle_id;

          return (
            <div key={club.circle_id} className="card px-3 py-2.5">
              <div className="flex items-center gap-2">
                <ClubChip name={club.name} slotOrder={club.slot_order} />
                <span className="tnum text-xs text-ink-400">{members.length}</span>
                <Button
                  tone="quiet"
                  className="ml-auto !px-2 !py-1 text-xs"
                  onClick={() => {
                    setAdding(isAdding ? null : club.circle_id);
                    setQuery("");
                  }}
                >
                  {isAdding ? "Done" : "Lock someone"}
                </Button>
              </div>

              <ul className="mt-1.5 space-y-0.5">
                {members.map((pin) => {
                  const elsewhere = planned.has(pin.friend_viewer_id)
                    && planned.get(pin.friend_viewer_id) !== club.circle_id;
                  return (
                    <li key={pin.friend_viewer_id} className="flex items-center gap-2 text-sm">
                      <Lock size={12} className="shrink-0 text-teal-700" />
                      <span className="min-w-0 flex-1 truncate font-semibold text-ink-900">
                        {pin.name ?? pin.friend_viewer_id}
                      </span>
                      {elsewhere && (
                        <span
                          className="text-[11px] text-coral-700"
                          title="The plan has them in another club. Fill clubs moves them here, unless they were dragged by hand."
                        >
                          not here in plan
                        </span>
                      )}
                      <button
                        title="Unlock"
                        onClick={() => onLock(pin.friend_viewer_id, null)}
                        className="capsule px-1.5 py-0.5 text-ink-400 hover:bg-cream-200 hover:text-coral-700"
                      >
                        <X size={12} />
                      </button>
                    </li>
                  );
                })}
                {members.length === 0 && !isAdding && (
                  <li className="text-xs text-ink-400">nobody locked</li>
                )}
              </ul>

              {isAdding && (
                <div className="mt-2">
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search a member"
                    className="card w-full bg-cream-50 px-3 py-1.5 text-sm outline-none focus:border-teal-400"
                  />
                  <ul className="mt-1 max-h-44 overflow-y-auto">
                    {hits.map((hit) => (
                      <li key={hit.friend_viewer_id}>
                        <button
                          onClick={async () => {
                            await onLock(hit.friend_viewer_id, club.circle_id);
                            setQuery("");
                          }}
                          className="w-full rounded-[6px] px-2 py-1 text-left text-sm hover:bg-teal-50"
                        >
                          {hit.current_name}
                          {hit.matchedAlias && (
                            <span className="ml-1 text-[11px] text-ink-400">
                              was {hit.matchedAlias}
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                    {query.trim().length >= 2 && hits.length === 0 && (
                      <li className="px-2 py-1 text-xs text-ink-400">no match</li>
                    )}
                  </ul>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Add someone to the plan by trainer ID.
 *
 * Chrono has no working per-member lookup, so the name comes from what the
 * ingest has already stored and is typed by hand when that misses (D030). They
 * land unplaced, with no average until the next ingest picks them up.
 */
function AddMember({ clubs, onAdded }: { clubs: RosterClub[]; onAdded: () => void }) {
  const [uid, setUid] = useState("");
  const [name, setName] = useState("");
  const [circleId, setCircleId] = useState<string>("");
  const [estimate, setEstimate] = useState("");
  const [needsName, setNeedsName] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const estMtdAvg = parseFans(estimate);
    if (estMtdAvg === undefined) {
      setError("Fans/day not understood — try 12.5M, 800k or 12500000.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ name: string }>("roster", {
        method: "POST",
        body: JSON.stringify({
          action: "add",
          friendViewerId: Number(uid),
          name: name.trim() || undefined,
          circleId: circleId === "" ? null : Number(circleId),
          estMtdAvg,
        }),
      });
      setAdded(r.name);
      setTimeout(() => setAdded(null), 2500);
      setUid("");
      setName("");
      setEstimate("");
      setNeedsName(false);
      onAdded();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // The id is not one the ingest has seen — take a name and retry.
      if (message.includes("a name is required")) {
        setNeedsName(true);
        setError("Not in our data — type their name to add them anyway.");
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
      <input
        value={uid}
        onChange={(e) => {
          setUid(e.target.value.replace(/\D/g, ""));
          setNeedsName(false);
        }}
        inputMode="numeric"
        placeholder="Trainer ID"
        className="card tnum w-40 bg-cream-50 px-3 py-1.5 text-sm outline-none focus:border-teal-400"
      />

      {needsName && (
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          autoFocus
          className="card w-44 bg-cream-50 px-3 py-1.5 text-sm outline-none focus:border-teal-400"
        />
      )}

      <input
        value={estimate}
        onChange={(e) => setEstimate(e.target.value)}
        placeholder="Fans/day (optional)"
        title="Their fans per day, as best you know it — e.g. 12.5M. Used to place them until chrono has real data."
        className="card tnum w-40 bg-cream-50 px-3 py-1.5 text-sm outline-none focus:border-teal-400"
      />

      <select
        value={circleId}
        onChange={(e) => setCircleId(e.target.value)}
        className="card bg-cream-50 px-3 py-1.5 text-sm outline-none focus:border-teal-400"
      >
        <option value="">Unplaced</option>
        {clubs.map((club) => (
          <option key={club.circle_id} value={club.circle_id}>
            {club.name}
          </option>
        ))}
      </select>

      <Button type="submit" tone="quiet" disabled={busy || uid === ""}>
        <span className="flex items-center gap-1.5">
          <Plus size={13} /> Add member
        </span>
      </Button>

      {added && <span className="text-xs text-teal-700">added {added}</span>}
      {error && <span className="text-xs text-coral-700">{error}</span>}
    </form>
  );
}

/**
 * One drop zone: a club, Unplaced (`null`, not decided yet) or Leaving
 * (`"leaving"`, decided — kicked at the reshuffle, D042). Leaving is the only
 * zone whose cards can be removed from the plan.
 */
function ClubColumn({
  club,
  entries,
  locks,
  clubName,
  onLock,
  onRemove,
}: {
  club: RosterClub | null | "leaving";
  entries: RosterEntry[];
  locks: Map<number, number>;
  clubName: (circleId: number | null) => string;
  onLock: (friendViewerId: number, circleId: number | null) => Promise<void>;
  onRemove?: (friendViewerId: number) => Promise<void>;
}) {
  const real = club !== null && club !== "leaving" ? club : null;
  const id = real ? `club-${real.circle_id}` : club === "leaving" ? "club-leaving" : "club-none";
  const { setNodeRef, isOver } = useDroppable({ id });
  const over = real ? entries.length > real.capacity : false;

  return (
    <div
      ref={setNodeRef}
      className={`card p-2 transition-colors ${
        isOver ? (club === "leaving" ? "border-coral-300 bg-coral-100" : "border-teal-400 bg-teal-50") : ""
      }`}
    >
      <div className="mb-2 flex items-center gap-2 px-1">
        {real ? (
          <ClubChip name={real.name} slotOrder={real.slot_order} />
        ) : club === "leaving" ? (
          <span className="capsule bg-coral-100 px-2.5 py-0.5 text-xs font-semibold text-coral-700">
            Leaving club
          </span>
        ) : (
          <span className="capsule bg-cream-300 px-2.5 py-0.5 text-xs font-semibold text-ink-700">
            Unplaced
          </span>
        )}
        <span className={`tnum ml-auto text-xs ${over ? "font-bold text-coral-700" : "text-ink-400"}`}>
          {entries.length}
          {real ? `/${real.capacity}` : ""}
        </span>
      </div>

      {/* A warning, not a block: officers may knowingly overfill. */}
      {over && real && (
        <p className="mb-2 px-1 text-[11px] font-semibold text-coral-700">
          over capacity by {entries.length - real.capacity}
        </p>
      )}

      {club === "leaving" && (
        <p className="mb-2 px-1 text-[11px] text-ink-500">
          Kicked at the reshuffle. Members can only be removed from the plan from here.
        </p>
      )}

      <ul className="space-y-1">
        {entries.map((entry) => (
          <MemberCard
            key={entry.friend_viewer_id}
            entry={entry}
            lockedTo={locks.get(entry.friend_viewer_id)}
            clubName={clubName}
            onLock={onLock}
            onRemove={onRemove}
          />
        ))}
        {entries.length === 0 && (
          <li className="px-1 py-3 text-center text-xs text-ink-400">drop here</li>
        )}
      </ul>
    </div>
  );
}

/**
 * Remove from plan, behind a second click. Only rendered in Leaving, and the
 * server refuses anyone not in Leaving as well.
 */
function RemoveButton({ onConfirm }: { onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(id);
  }, [armed]);

  return (
    <button
      type="button"
      title={armed ? "Click again to remove from the plan" : "Remove from the plan"}
      // The card itself is a drag handle; without this the click starts a drag.
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        if (armed) onConfirm();
        else setArmed(true);
      }}
      className={`shrink-0 rounded-[6px] px-1 py-0.5 text-[11px] font-semibold ${
        armed ? "bg-coral-700 text-white" : "text-ink-400 hover:bg-cream-50 hover:text-coral-700"
      }`}
    >
      {armed ? "Remove?" : <Trash2 size={13} />}
    </button>
  );
}

/**
 * Draggable, not sortable: members move between clubs, and order within a club
 * carries no meaning — it is rebuilt from rank. `useSortable` would also need a
 * SortableContext wrapper it never had.
 */
function MemberCard({
  entry,
  lockedTo,
  clubName,
  onLock,
  onRemove,
}: {
  entry: RosterEntry;
  lockedTo: number | undefined;
  clubName: (circleId: number | null) => string;
  onLock: (friendViewerId: number, circleId: number | null) => Promise<void>;
  onRemove?: (friendViewerId: number) => Promise<void>;
}) {
  const held = isHeld(entry);
  const openMenu = useContext(MenuContext);
  // Chrono's club leads cannot be dragged at all (D044).
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: entry.friend_viewer_id,
    disabled: held,
  });

  // A leaver gets the remove button instead of a padlock: locking someone who
  // is leaving means nothing. A club lead is already held, so gets a badge
  // saying so.
  const action = held ? (
    <span
      className="capsule shrink-0 bg-cream-300 px-1.5 text-[10px] font-semibold text-ink-600"
      title={`Chrono's ${roleLabel(entry)} — stays in ${clubName(entry.actual_circle_id)}`}
    >
      lead
    </span>
  ) : entry.leaving === 1 && onRemove ? (
    <RemoveButton onConfirm={() => void onRemove(entry.friend_viewer_id)} />
  ) : (
    <LockToggle entry={entry} lockedTo={lockedTo} clubName={clubName} onLock={onLock} />
  );

  return (
    <li
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{ opacity: isDragging ? 0.35 : 1 }}
      className={held ? "cursor-default" : "cursor-grab active:cursor-grabbing"}
      onContextMenu={(e) => {
        e.preventDefault();
        openMenu?.(entry, e.clientX, e.clientY);
      }}
    >
      <MemberChip
        entry={entry}
        lockedTo={lockedTo}
        lockButton={action}
      />
    </li>
  );
}

/**
 * Padlock on a roster card. Locks the member into the club the plan has them
 * in now; an unplaced member has no club to lock into, so gets no button.
 */
function LockToggle({
  entry,
  lockedTo,
  clubName,
  onLock,
}: {
  entry: RosterEntry;
  lockedTo: number | undefined;
  clubName: (circleId: number | null) => string;
  onLock: (friendViewerId: number, circleId: number | null) => Promise<void>;
}) {
  if (lockedTo === undefined && entry.circle_id === null) return null;

  const locked = lockedTo !== undefined;
  const elsewhere = locked && lockedTo !== entry.circle_id;

  return (
    <button
      type="button"
      title={
        locked
          ? `Locked to ${clubName(lockedTo)}${elsewhere ? " — not where the plan has them" : ""}. Click to unlock.`
          : `Lock into ${clubName(entry.circle_id)} every month`
      }
      // The card itself is a drag handle; without this the click starts a drag.
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        void onLock(entry.friend_viewer_id, locked ? null : entry.circle_id);
      }}
      className={`shrink-0 rounded-[6px] p-1 hover:bg-cream-50 ${
        elsewhere
          ? "text-coral-700"
          : locked
            ? "text-teal-700"
            : "text-ink-400 opacity-0 group-hover:opacity-100 focus:opacity-100"
      }`}
    >
      {locked ? <Lock size={13} /> : <LockOpen size={13} />}
    </button>
  );
}

function MemberChip({
  entry,
  lockedTo,
  lockButton,
}: {
  entry: RosterEntry;
  lockedTo?: number;
  lockButton?: React.ReactNode;
}) {
  const moved = entry.source === "manual" && entry.circle_id !== entry.projected_circle_id;

  return (
    <span
      className={`group capsule flex items-center gap-2 px-3 py-1.5 text-sm ${
        moved ? "bg-lav-200" : "bg-cream-200"
      }`}
      title={moved ? "Moved by hand from where the plan started" : undefined}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold text-ink-900">{entry.name}</span>
        <UidTag id={entry.friend_viewer_id} />
      </span>
      <FansValue entry={entry} />
      {lockButton ?? (lockedTo !== undefined && <Lock size={13} className="shrink-0 text-teal-700" />)}
    </span>
  );
}

/** Opens the right-click menu for an entry; provided by the roster editor. */
const MenuContext = createContext<((entry: RosterEntry, x: number, y: number) => void) | null>(null);

/**
 * Right-click menu on a roster card: everything a drag does, plus the card's
 * other actions, without needing to drag across a wide board.
 */
function RosterMenu({
  entry,
  x,
  y,
  clubs,
  lockedTo,
  clubName,
  onMove,
  onLock,
  onEstimate,
  onRemove,
  onClose,
}: {
  entry: RosterEntry;
  x: number;
  y: number;
  clubs: RosterClub[];
  lockedTo: number | undefined;
  clubName: (circleId: number | null) => string;
  onMove: (target: MoveTarget) => void;
  onLock: (circleId: number | null) => void;
  onEstimate: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const held = isHeld(entry);

  // Close on outside click, Escape, scroll or resize — anything that means
  // the menu's position or subject is no longer what the officer is looking at.
  useEffect(() => {
    const close = (e: Event) => {
      if (e instanceof MouseEvent && box?.contains(e.target as Node)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", close);
    window.addEventListener("contextmenu", close, true);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("contextmenu", close, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [box, onClose]);

  // Keep it on screen near the right and bottom edges.
  const width = 224;
  const height = box?.offsetHeight ?? 0;
  const left = Math.max(8, Math.min(x, window.innerWidth - width - 8));
  const top = Math.max(8, Math.min(y, window.innerHeight - height - 8));

  const here = (target: MoveTarget) =>
    target === "leaving"
      ? entry.leaving === 1
      : entry.leaving !== 1 && entry.circle_id === target;

  const act = (fn: () => void) => () => {
    fn();
    onClose();
  };

  const item = (label: React.ReactNode, onClick: () => void, opts: { disabled?: boolean; current?: boolean; danger?: boolean; title?: string } = {}) => (
    <button
      type="button"
      disabled={opts.disabled}
      title={opts.title}
      onClick={act(onClick)}
      className={`flex w-full items-center gap-2 rounded-[6px] px-2 py-1 text-left text-sm disabled:cursor-default disabled:opacity-40 ${
        opts.danger ? "text-coral-700 hover:bg-coral-100" : "text-ink-900 hover:bg-teal-50"
      }`}
    >
      <span className="w-3.5 shrink-0">{opts.current && <Check size={13} className="text-teal-700" />}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );

  const destinations: { target: MoveTarget; label: React.ReactNode }[] = [
    ...clubs.map((c) => ({ target: c.circle_id as MoveTarget, label: c.name })),
    { target: null, label: "Unplaced" },
    { target: "leaving", label: <span className="text-coral-700">Leaving club</span> },
  ];

  return (
    <div
      ref={setBox}
      role="menu"
      style={{ left, top, width, visibility: box ? "visible" : "hidden" }}
      className="card fixed z-50 p-1.5 shadow-lg"
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="border-b border-cream-200 px-2 pb-1.5 pt-0.5">
        <div className="truncate text-sm font-bold text-ink-900">{entry.name}</div>
        <div className="tnum text-[11px] text-ink-400">{entry.friend_viewer_id}</div>
        {held && (
          <div className="mt-0.5 text-[11px] font-semibold text-ink-600">
            {roleLabel(entry)} — stays in {clubName(entry.actual_circle_id)}
          </div>
        )}
      </div>

      <div className="py-1">
        <div className="px-2 pb-0.5 text-[10px] font-bold uppercase tracking-wide text-ink-400">Move to</div>
        {destinations.map((d) =>
          item(d.label, () => onMove(d.target), {
            current: here(d.target),
            disabled: here(d.target) || (held && d.target !== entry.actual_circle_id),
          }),
        )}
      </div>

      <div className="border-t border-cream-200 pt-1">
        {!held && lockedTo !== undefined &&
          item(`Unlock from ${clubName(lockedTo)}`, () => onLock(null))}
        {!held && lockedTo === undefined && entry.circle_id !== null && entry.leaving !== 1 &&
          item(`Lock into ${clubName(entry.circle_id)}`, () => onLock(entry.circle_id))}
        {!entry.mtd_avg &&
          item(entry.est_mtd_avg !== null ? "Change fans/day estimate…" : "Set fans/day estimate…", onEstimate)}
        {item("Copy trainer ID", () => navigator.clipboard?.writeText(String(entry.friend_viewer_id)))}
        {entry.leaving === 1 &&
          item("Remove from plan…", () => {
            if (confirm(`Remove ${entry.name} from this month's plan?`)) onRemove();
          }, { danger: true })}
      </div>
    </div>
  );
}

/** Opens the estimate prompt for an entry; provided by the roster editor. */
const EstimateContext = createContext<((entry: RosterEntry) => void) | null>(null);

/**
 * A card's fans/day. Chrono's figure when there is one; otherwise the
 * officer's estimate shown as "~12.50M" (D043), clickable to set or change.
 */
function FansValue({ entry }: { entry: RosterEntry }) {
  const editEstimate = useContext(EstimateContext);

  if (entry.mtd_avg) {
    return <span className="tnum text-xs text-ink-500">{compactFans(entry.mtd_avg)}</span>;
  }

  const label = entry.est_mtd_avg !== null ? `~${compactFans(entry.est_mtd_avg)}` : "—";
  if (!editEstimate) return <span className="tnum text-xs italic text-ink-500">{label}</span>;

  return (
    <button
      type="button"
      title={
        entry.est_mtd_avg !== null
          ? "Officer's estimate — chrono has no data on them yet. Click to change."
          : "No data from chrono. Click to enter their fans/day."
      }
      // The card itself is a drag handle; without this the click starts a drag.
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        editEstimate(entry);
      }}
      className="tnum rounded-[6px] px-1 text-xs italic text-ink-500 underline decoration-dotted underline-offset-2 hover:bg-cream-50 hover:text-ink-900"
    >
      {label}
    </button>
  );
}

/** The in-game trainer id, so officers can find someone to move them. */
function UidTag({ id }: { id: number }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      title="Copy trainer ID"
      // The card itself is a drag handle; without this the click starts a drag.
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard?.writeText(String(id));
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className="tnum flex items-center gap-1 text-[11px] text-ink-400 hover:text-ink-700"
    >
      {id}
      {copied ? <Check size={9} /> : <Copy size={9} className="opacity-0 group-hover:opacity-60" />}
    </button>
  );
}
