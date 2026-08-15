import { useCallback, useEffect, useMemo, useState } from "react";
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
import { Check, Copy, LogOut, RefreshCw, RotateCcw, Undo2 } from "lucide-react";

import { compactFans } from "../lib/format.ts";
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
      <ClubLeaders />
      <Noticeboard />
      <RosterEditor />
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
  const [hits, setHits] = useState<SearchHit[]>([]);

  const reload = useCallback(() => {
    fetch("/api/clubs")
      .then((r) => r.json() as Promise<{ clubs: PublicClub[] }>)
      .then((r) => setClubs(r.clubs));
    api<{ pins: PinRow[] }>("pins").then((r) => setPins(r.pins));
  }, []);

  useEffect(reload, [reload]);

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
  const [yearMonth, setYearMonth] = useState(0);
  const [dataYmd, setDataYmd] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<RosterEntry | null>(null);

  const reload = useCallback(() => {
    api<{
      plan: { id: number; status: string };
      entries: RosterEntry[];
      clubs: RosterClub[];
      yearMonth: number;
      dataYmd: number;
    }>("roster")
      .then((r) => {
        setPlanId(r.plan.id);
        setStatus(r.plan.status);
        setEntries(r.entries);
        setClubs(r.clubs);
        setYearMonth(r.yearMonth);
        setDataYmd(r.dataYmd);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(reload, [reload]);

  const sensors = useSensors(
    // A small threshold so a tap on a member still reads as a click.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const byClub = useMemo(() => {
    const map = new Map<number | null, RosterEntry[]>();
    for (const club of clubs) map.set(club.circle_id, []);
    map.set(null, []);
    for (const entry of entries) {
      const list = map.get(entry.circle_id) ?? map.get(null)!;
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

  /**
   * A finalised plan is only a record of intent — the reshuffle is executed by
   * hand in-game and nothing here writes back to chrono. Once the month it
   * covers has started, chrono is the evidence of what actually happened, so
   * the two are compared and any divergence is flagged.
   *
   * Only after the 1st: before then everyone is still in last month's club and
   * every planned move would read as a mismatch.
   */
  const monthStarted = status === "final" && dataYmd >= yearMonth * 100 + 1;
  const offPlan = useMemo(
    () =>
      monthStarted
        ? entries.filter((e) => e.actual_circle_id !== e.circle_id)
        : [],
    [monthStarted, entries],
  );
  const offPlanIds = useMemo(
    () => new Set(offPlan.map((e) => e.friend_viewer_id)),
    [offPlan],
  );

  function onDragStart(event: DragStartEvent) {
    setDragging(entries.find((e) => e.friend_viewer_id === Number(event.active.id)) ?? null);
  }

  async function onDragEnd(event: DragEndEvent) {
    setDragging(null);
    const memberId = Number(event.active.id);
    const overId = event.over?.id;
    if (overId === undefined || overId === null) return;

    const targetClub = String(overId).startsWith("club-")
      ? Number(String(overId).slice(5))
      : null;

    const entry = entries.find((e) => e.friend_viewer_id === memberId);
    if (!entry || entry.circle_id === targetClub) return;

    const next = entries.map((e) =>
      e.friend_viewer_id === memberId
        ? { ...e, circle_id: targetClub, source: "manual" as const }
        : e,
    );
    setEntries(next);

    setSaving(true);
    try {
      await api("roster", {
        method: "PUT",
        body: JSON.stringify({
          planId,
          moves: [{ friendViewerId: memberId, circleId: targetClub, position: 999 }],
        }),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      reload();
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
          {changed > 0 ? `${changed} moved by hand` : "straight from the projection"}
        </span>
        {saving && <span className="text-xs text-teal-700">saving…</span>}

        <div className="ml-auto flex gap-2">
          <Button
            tone="quiet"
            title="Rebuild the plan from today's numbers, discarding every hand edit"
            onClick={async () => {
              if (
                changed > 0 &&
                !confirm(`Rebuild the plan? ${changed} hand-placed members will be reset.`)
              ) {
                return;
              }
              await api("roster", { method: "POST", body: JSON.stringify({ action: "reset" }) });
              reload();
            }}
          >
            <span className="flex items-center gap-1.5">
              <RotateCcw size={13} /> Redo projection
            </span>
          </Button>
          <Button
            onClick={async () => {
              await api("roster", { method: "POST", body: JSON.stringify({ action: "finalise" }) });
              reload();
            }}
          >
            Finalise
          </Button>
        </div>
      </div>

      <p className="text-sm text-ink-500">
        Drag anyone into any club. Finalising records the plan — the reshuffle is still done
        by hand in-game.
      </p>

      {monthStarted && (
        <div
          className={`card px-4 py-3 text-sm ${
            offPlan.length > 0
              ? "border-coral-300 bg-coral-100 text-coral-700"
              : "border-teal-400 bg-teal-100 text-ink-700"
          }`}
        >
          {offPlan.length === 0 ? (
            <span className="font-semibold">
              Chrono matches the plan — all {entries.length} in their planned club.
            </span>
          ) : (
            <>
              <div className="font-semibold">
                {offPlan.length} of {entries.length} are not where the plan puts them.
              </div>
              <ul className="mt-1.5 space-y-0.5 text-xs">
                {offPlan.map((entry) => (
                  <li key={entry.friend_viewer_id}>
                    <span className="font-semibold">{entry.name}</span> — planned{" "}
                    {clubName(entry.circle_id)}, chrono has {clubName(entry.actual_circle_id)}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {clubs.map((club) => (
            <ClubColumn
              key={club.circle_id}
              club={club}
              entries={byClub.get(club.circle_id) ?? []}
              offPlanIds={offPlanIds}
            />
          ))}
          <ClubColumn club={null} entries={byClub.get(null) ?? []} offPlanIds={offPlanIds} />
        </div>

        {/* Follows the cursor across columns; without it the card stays clipped
            inside its own scrolling column. */}
        <DragOverlay>{dragging ? <MemberChip entry={dragging} /> : null}</DragOverlay>
      </DndContext>
    </section>
  );
}

function ClubColumn({
  club,
  entries,
  offPlanIds,
}: {
  club: RosterClub | null;
  entries: RosterEntry[];
  offPlanIds: Set<number>;
}) {
  const id = club ? `club-${club.circle_id}` : "club-none";
  const { setNodeRef, isOver } = useDroppable({ id });
  const over = club ? entries.length > club.capacity : false;

  return (
    <div
      ref={setNodeRef}
      className={`card p-2 transition-colors ${isOver ? "border-teal-400 bg-teal-50" : ""}`}
    >
      <div className="mb-2 flex items-center gap-2 px-1">
        {club ? (
          <ClubChip name={club.name} slotOrder={club.slot_order} />
        ) : (
          <span className="capsule bg-cream-300 px-2.5 py-0.5 text-xs font-semibold text-ink-700">
            Unplaced
          </span>
        )}
        <span className={`tnum ml-auto text-xs ${over ? "font-bold text-coral-700" : "text-ink-400"}`}>
          {entries.length}
          {club ? `/${club.capacity}` : ""}
        </span>
      </div>

      {/* A warning, not a block: officers may knowingly overfill. */}
      {over && (
        <p className="mb-2 px-1 text-[11px] font-semibold text-coral-700">
          over capacity by {entries.length - club!.capacity}
        </p>
      )}

      <ul className="space-y-1">
        {entries.map((entry) => (
          <MemberCard
            key={entry.friend_viewer_id}
            entry={entry}
            offPlan={offPlanIds.has(entry.friend_viewer_id)}
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
 * Draggable, not sortable: members move between clubs, and order within a club
 * carries no meaning — it is rebuilt from rank. `useSortable` would also need a
 * SortableContext wrapper it never had.
 */
function MemberCard({ entry, offPlan }: { entry: RosterEntry; offPlan: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: entry.friend_viewer_id,
  });

  return (
    <li
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{ opacity: isDragging ? 0.35 : 1 }}
      className="cursor-grab active:cursor-grabbing"
    >
      <MemberChip entry={entry} offPlan={offPlan} />
    </li>
  );
}

function MemberChip({ entry, offPlan = false }: { entry: RosterEntry; offPlan?: boolean }) {
  const moved = entry.source === "manual" && entry.circle_id !== entry.projected_circle_id;

  return (
    <span
      className={`capsule flex items-center gap-2 px-3 py-1.5 text-sm ${
        offPlan ? "bg-coral-100 ring-1 ring-coral-300" : moved ? "bg-lav-200" : "bg-cream-200"
      }`}
      title={
        offPlan
          ? "Chrono has them in a different club than the plan"
          : moved
            ? "Moved by hand from the projection"
            : undefined
      }
    >
      <span className="min-w-0 flex-1 truncate font-semibold text-ink-900">{entry.name}</span>
      <span className="tnum text-xs text-ink-500">
        {entry.mtd_avg ? compactFans(entry.mtd_avg) : "—"}
      </span>
    </span>
  );
}
